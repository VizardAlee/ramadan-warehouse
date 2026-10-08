import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { db } from "../admin.js";
import { accountingPeriodReference, assertAccountingPeriodOpen } from "../accounting/period-lock.js";
import { resolveSettlementAccount } from "../accounting/settlement-account.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { requireAccess, requireBranchScope } from "../auth/authorize.js";
import { uniquenessDocumentId } from "../inventory/calculations.js";
import { assertBalancedJournal } from "./calculations.js";
import { correlationId } from "../utils/callable.js";
import { approveSaleReturnInput } from "../validation/sales.js";

export async function followUpSaleReturn(actor: Awaited<ReturnType<typeof requireAccess>>, input: z.infer<typeof approveSaleReturnInput>) {
  const returnRef = db.doc(`saleReturns/${input.returnId}`);
  const op = db.doc(`idempotencyKeys/${actor.organizationId}_${input.action}_${input.idempotencyKey}`);
  const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const cid = correlationId();
  return db.runTransaction(async (tx) => {
    const snapshots = await tx.getAll(returnRef, op);
    const record = snapshots[0]!, previous = snapshots[1]!;
    if (!record.exists || record.get("organizationId") !== actor.organizationId)
      throw new HttpsError("not-found", "Return not found.");
    requireBranchScope(actor, String(record.get("branchId")));
    if (previous.exists) {
      if (previous.get("fingerprint") !== fingerprint) throw new HttpsError("already-exists", "This retry reference belongs to different instructions.");
      return previous.get("result");
    }
    const now = FieldValue.serverTimestamp();
    if (input.action === "inspect") {
      if (record.get("status") !== "submitted" || record.get("kind") === "reservation_cancellation" || record.get("inspectionStatus") === "completed")
        throw new HttpsError("failed-precondition", "Only uninspected submitted goods returns can be inspected.");
      const items = await tx.get(db.collection("saleReturnItems").where("returnId", "==", record.id).limit(51));
      const decisions = input.inspection!.lines;
      if (items.size > 50 || decisions.length !== items.size || new Set(decisions.map(x => x.returnItemId)).size !== items.size || decisions.some(x => !items.docs.some(d => d.id === x.returnItemId)))
        throw new HttpsError("invalid-argument", "Inspect every returned item exactly once.");
      let restockCostMinor = 0;
      for (const item of items.docs) {
        if (item.get("organizationId") !== actor.organizationId) throw new HttpsError("failed-precondition", "Return item scope mismatch.");
        const disposition = decisions.find(x => x.returnItemId === item.id)!.disposition;
        if (disposition === "resellable") restockCostMinor += Number(item.get("costAmountMinor"));
        tx.update(item.ref, { disposition, condition: disposition === "resellable" ? "restockable" : "non_restockable", inspectionStatus: "completed", inspectedAt: now, inspectedBy: actor.userId, inspectionNotes: input.inspection!.notes });
      }
      tx.update(returnRef, { inspectionStatus: "completed", inspectionVersion: 1, inspectionNotes: input.inspection!.notes, inspectedAt: now, inspectedBy: actor.userId, restockCostMinor, updatedAt: now });
      const result = { returnId: record.id, inspectionRecorded: true, approved: false, creditId: null };
      tx.create(op, { organizationId: actor.organizationId, fingerprint, result, createdAt: now, createdBy: actor.userId });
      writeAuditLog(tx, actor, { action: "sale_return.inspected", entityType: "saleReturn", entityId: record.id, sourceFunction: "approveSaleReturn", correlationId: cid, reason: input.inspection!.notes, before: { inspectionStatus: record.get("inspectionStatus") ?? "required" }, after: { lines: decisions, restockCostMinor } });
      return result;
    }
    const request = input.refund!;
    if (record.get("status") !== "approved" || record.get("resolution") !== "exchange_credit" || !record.get("exchangeCreditId"))
      throw new HttpsError("failed-precondition", "This return has no posted exchange credit to refund.");
    const creditRef = db.doc(`salesCredits/${record.get("exchangeCreditId")}`);
    const shiftRef = db.doc(`posShifts/${request.shiftId ?? "no-refund-till"}`);
    const bankRef = db.doc(`bankAccounts/${request.bankAccountId ?? "no-refund-bank"}`);
    const counterRef = db.doc(`journalCounters/${uniquenessDocumentId(actor.organizationId, "general")}`);
    const effectiveAt = Timestamp.now();
    const financialSnapshots = await tx.getAll(creditRef, shiftRef, bankRef, counterRef, accountingPeriodReference(actor.organizationId, effectiveAt));
    const credit = financialSnapshots[0]!, shift = financialSnapshots[1]!, bank = financialSnapshots[2]!, counter = financialSnapshots[3]!, period = financialSnapshots[4]!;
    assertAccountingPeriodOpen(period);
    const remaining = Number(credit.get("remainingAmountMinor") ?? 0);
    if (!credit.exists || credit.get("organizationId") !== actor.organizationId || credit.get("branchId") !== record.get("branchId") || credit.get("returnId") !== record.id || credit.get("status") !== "active" || request.amountMinor > remaining)
      throw new HttpsError("failed-precondition", "The unused exchange credit is unavailable or insufficient. Refresh before refunding.");
    if (request.method === "cash" && (!shift.exists || shift.get("organizationId") !== actor.organizationId || shift.get("branchId") !== record.get("branchId") || shift.get("status") !== "open"))
      throw new HttpsError("failed-precondition", "Select an open till in the return's store.");
    const account = request.method === "cash" ? { accountCode: "1010", accountName: "Cash on hand", bankAccountId: null } : resolveSettlementAccount(actor.organizationId, request.method, request.bankAccountId, bank);
    const journal = db.collection("journalEntries").doc(), refund = db.collection("saleRefunds").doc();
    const sequence = Number(counter.get("value") ?? 0) + 1;
    const journalNumber = `JRN-${new Date().getUTCFullYear()}-${String(sequence).padStart(6, "0")}`;
    const journalLines = [{ accountCode: "2200", accountName: "Customer exchange credits", debitMinor: request.amountMinor, creditMinor: 0 }, { accountCode: account.accountCode, accountName: account.accountName, debitMinor: 0, creditMinor: request.amountMinor }];
    assertBalancedJournal(journalLines);
    tx.set(counterRef, { organizationId: actor.organizationId, kind: "journalEntry", value: sequence, updatedAt: now }, { merge: true });
    tx.update(creditRef, { remainingAmountMinor: remaining - request.amountMinor, refundedAmountMinor: Number(credit.get("refundedAmountMinor") ?? 0) + request.amountMinor, status: remaining === request.amountMinor ? "refunded" : "active", updatedAt: now, updatedBy: actor.userId });
    if (request.method === "cash") tx.update(shiftRef, { cashRefundsMinor: Number(shift.get("cashRefundsMinor") ?? 0) + request.amountMinor, updatedAt: now });
    tx.create(refund, { organizationId: actor.organizationId, branchId: record.get("branchId"), returnId: record.id, saleId: record.get("saleId"), exchangeCreditId: credit.id, replacementSaleId: credit.get("lastRedeemedSaleId") ?? null, refundNumber: `RFD-EXC-${refund.id.slice(0, 8).toUpperCase()}`, method: request.method, amountMinor: request.amountMinor, bankAccountId: account.bankAccountId ?? null, ledgerAccountCode: account.accountCode, shiftId: request.method === "cash" ? shift.id : null, reason: request.reason, journalEntryId: journal.id, status: "recorded", currency: "NGN", recordedAt: effectiveAt, recordedBy: actor.userId, createdAt: now });
    tx.create(journal, { organizationId: actor.organizationId, branchId: record.get("branchId"), journalNumber, journalType: "exchange_credit_refund", status: "posted", referenceType: "saleRefund", referenceId: refund.id, referenceNumber: record.get("returnNumber"), description: request.reason, totalDebitMinor: request.amountMinor, totalCreditMinor: request.amountMinor, currency: "NGN", effectiveAt, postedAt: now, postedBy: actor.userId, createdAt: now });
    for (const line of journalLines) {
      const chart = db.doc(`chartOfAccounts/${uniquenessDocumentId(actor.organizationId, line.accountCode)}`);
      tx.set(chart, { organizationId: actor.organizationId, code: line.accountCode, name: line.accountName, active: true, systemManaged: true, currency: "NGN", updatedAt: now }, { merge: true });
      tx.create(db.collection("journalLines").doc(), { organizationId: actor.organizationId, branchId: record.get("branchId"), journalEntryId: journal.id, journalNumber, accountId: chart.id, ...line, currency: "NGN", effectiveAt, createdAt: now });
    }
    const result = { returnId: record.id, approved: false, creditId: credit.id, refundId: refund.id, refundedAmountMinor: request.amountMinor };
    tx.create(op, { organizationId: actor.organizationId, fingerprint, result, createdAt: now, createdBy: actor.userId });
    writeAuditLog(tx, actor, { action: "sale_return.exchange_credit_refunded", entityType: "saleReturn", entityId: record.id, sourceFunction: "approveSaleReturn", correlationId: cid, reason: request.reason, before: { remainingCreditMinor: remaining }, after: { remainingCreditMinor: remaining - request.amountMinor, refundId: refund.id, journalEntryId: journal.id, amountMinor: request.amountMinor, bankAccountId: account.bankAccountId ?? null } });
    return result;
  });
}
