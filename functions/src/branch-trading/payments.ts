import { internalTradeBalanceId } from "./identity.js";
import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { db } from "../admin.js";
import type { AccessProfile } from "../auth/authorize.js";
import { scopedAccess, hasOrganizationPermission, requirePermissionScope } from "../auth/permission-scope.js";
import { accountingPeriodReference, assertAccountingPeriodOpen } from "../accounting/period-lock.js";
import { resolveSettlementAccount } from "../accounting/settlement-account.js";
import { writeJournal } from "../accounting/write-journal.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { uniquenessDocumentId } from "../inventory/calculations.js";

const id = z.string().trim().min(1).max(180).refine(value => !value.includes("/") && value !== "." && value !== "..");
export const internalTradePaymentSchema = z.object({
  action: z.literal("record_payment"),
  invoiceId: id,
  amountMinor: z.number().int().positive().safe(),
  sourceMethod: z.enum(["cash", "bank_transfer"]).default("bank_transfer"),
  destinationMethod: z.enum(["cash", "bank_transfer"]).default("bank_transfer"),
  sourceBankAccountId: id.optional(),
  destinationBankAccountId: id.optional(),
  existingFundsTransferId: id.optional(),
  paymentDate: z.string().datetime(),
  reference: z.string().trim().min(2).max(160),
  confirmedCompleted: z.literal(true),
  idempotencyKey: z.string().uuid(),
});
export type InternalTradePaymentInput = z.infer<typeof internalTradePaymentSchema>;
export async function canRecordInternalTradePayment(actor: AccessProfile) {
  return hasOrganizationPermission(await scopedAccess(actor), "banking.transfer");
}
const fail = (message: string): never => { throw new HttpsError("failed-precondition", message); };
function safe(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) fail(`${label} requires reconciliation.`);
  return value as number;
}

/** Records an already completed movement. Never initiates or schedules a bank payment. */
export async function recordInternalTradePayment(access: AccessProfile, raw: InternalTradePaymentInput) {
  const actor = await scopedAccess(access);
  requirePermissionScope(actor, {}, "banking.transfer");
  const input = internalTradePaymentSchema.parse(raw);
  const effectiveAt = Timestamp.fromDate(new Date(input.paymentDate));
  if (effectiveAt.toMillis() > Date.now() + 300_000) throw new HttpsError("invalid-argument", "The payment date cannot be in the future.");
  if (!input.existingFundsTransferId) {
    if (input.sourceMethod === "bank_transfer" && !input.sourceBankAccountId || input.destinationMethod === "bank_transfer" && !input.destinationBankAccountId)
      fail("Select each company bank account used for the completed payment.");
    if (input.sourceMethod === "cash" && input.sourceBankAccountId || input.destinationMethod === "cash" && input.destinationBankAccountId)
      fail("Cash payments must not specify a bank account.");
    if (input.sourceBankAccountId && input.sourceBankAccountId === input.destinationBankAccountId)
      fail("Choose different source and destination bank accounts.");
  }
  const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const operation = db.doc(`idempotencyOperations/${uniquenessDocumentId(actor.organizationId, "internalTradePayment", input.idempotencyKey)}`);
  const journal = db.collection("journalEntries").doc();
  const destinationJournal = db.collection("journalEntries").doc();
  const counter = db.doc(`journalCounters/${uniquenessDocumentId(actor.organizationId, "general")}`);
  const referenceNumber = `ITP-${input.idempotencyKey.replaceAll("-", "").slice(0, 16).toUpperCase()}`;
  return db.runTransaction(async tx => {
    const previous = await tx.get(operation);
    if (previous.exists) {
      if (previous.get("organizationId") !== actor.organizationId || previous.get("actorUserId") !== actor.userId || previous.get("fingerprint") !== fingerprint)
        fail("This payment retry key belongs to different instructions.");
      return { invoiceId: input.invoiceId, paymentId: String(previous.get("paymentId")), journalEntryId: String(previous.get("journalEntryId")), repeated: true };
    }
    const invoice = await tx.get(db.doc(`internalTradeInvoices/${input.invoiceId}`));
    if (!invoice.exists || invoice.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Internal invoice not found.");
    const branchId = String(invoice.get("branchId")), headOfficeBranchId = String(invoice.get("headOfficeBranchId"));
    if (branchId === headOfficeBranchId) fail("The invoice must belong to a branch supplied by head office.");
    const [balance, period, branch, hq, sequence] = await tx.getAll(
      db.doc(`internalTradeBalances/${internalTradeBalanceId(actor.organizationId,headOfficeBranchId,branchId)}`),
      accountingPeriodReference(actor.organizationId, effectiveAt),
      db.doc(`branches/${branchId}`), db.doc(`branches/${headOfficeBranchId}`), counter,
    );
    assertAccountingPeriodOpen(period!);
    if ([branch!, hq!].some(row => !row.exists || row.get("organizationId") !== actor.organizationId || row.get("status") !== "active"))
      fail("Both the receiving branch and head office must be active.");
    if (!balance!.exists || balance!.get("organizationId") !== actor.organizationId || balance!.get("branchId") !== branchId || balance!.get("headOfficeBranchId") !== headOfficeBranchId)
      fail("The branch trading balance requires reconciliation.");
    const invoiceBalance = safe(invoice.get("balanceMinor"), "Invoice balance");
    const invoiceTotal = safe(invoice.get("totalMinor"), "Invoice total"), invoicePaid = safe(invoice.get("paidMinor"), "Invoice paid amount"), invoiceReturned = safe(invoice.get("returnedMinor"), "Invoice returns");
    const aggregateTotal = safe(balance!.get("invoicedMinor"), "Branch invoiced amount"), aggregatePaid = safe(balance!.get("paidMinor"), "Branch paid amount"), aggregateReturned = safe(balance!.get("returnedMinor"), "Branch returns");
    if (invoiceTotal < 0 || invoicePaid < 0 || invoiceReturned < 0 || invoiceReturned > invoiceTotal || safe(invoiceTotal - invoicePaid - invoiceReturned, "Invoice balance") !== invoiceBalance)
      fail("The invoice trading totals require reconciliation.");
    if (aggregateTotal < 0 || aggregatePaid < 0 || aggregateReturned < 0 || aggregateReturned > aggregateTotal || safe(aggregateTotal - aggregatePaid - aggregateReturned, "Branch balance") !== safe(balance!.get("balanceMinor"), "Branch balance"))
      fail("The branch trading totals require reconciliation.");
    if (input.amountMinor > invoiceBalance) fail("The payment exceeds this invoice's remaining balance.");
    const paidMinor = safe(safe(invoice.get("paidMinor"), "Invoice paid amount") + input.amountMinor, "Invoice paid amount");
    const balancePaid = safe(safe(balance!.get("paidMinor"), "Branch paid amount") + input.amountMinor, "Branch paid amount");
    const nextBalance = safe(safe(balance!.get("balanceMinor"), "Branch balance") - input.amountMinor, "Branch balance");
    let journalEntryId = journal.id;
    let writeMovement: () => void;
    if (input.existingFundsTransferId) {
      const existing = await tx.get(db.doc(`journalEntries/${input.existingFundsTransferId}`));
      const allocationRef = db.doc(`internalTradePaymentAllocations/${actor.organizationId}_${input.existingFundsTransferId}`);
      const allocation = await tx.get(allocationRef);
      const details = existing.get("details");
      if (!existing.exists || existing.get("organizationId") !== actor.organizationId || existing.get("journalType") !== "internal_funds_transfer" || existing.get("referenceType") !== "companyFundsTransfer" || existing.get("referenceId") !== existing.id || existing.get("status") !== "posted" || existing.get("reversalJournalEntryId") || details?.confirmedCompleted !== true || details?.sourceBranchId !== branchId || details?.destinationBranchId !== headOfficeBranchId)
        fail("Choose the original posted company funds transfer from this branch to head office.");
      // One-key query: no new index or new access grant is needed.
      const linked = await tx.get(db.collection("journalEntries").where("referenceId", "==", existing.id).limit(10));
      const counterpart = linked.docs.filter(row => row.id !== existing.id && row.get("organizationId") === actor.organizationId && row.get("branchId") === headOfficeBranchId && row.get("journalType") === "internal_funds_transfer" && row.get("referenceType") === "companyFundsTransfer" && row.get("status") === "posted" && !row.get("reversalJournalEntryId") && row.get("details")?.amountMinor === details.amountMinor);
      if (counterpart.length !== 1) fail("The matching head-office funds receipt requires reconciliation.");
      const recordedDate = existing.get("effectiveAt");
      if (!(recordedDate instanceof Timestamp) || recordedDate.toMillis() !== effectiveAt.toMillis()) fail("Use the completed funds transfer's original date and time.");
      const allocated = allocation.exists ? safe(allocation.get("allocatedMinor"), "Funds allocation") : 0;
      if (allocation.exists && (allocation.get("organizationId") !== actor.organizationId || allocation.get("branchId") !== branchId)) fail("This funds allocation belongs to another branch.");
      const total = safe(details.amountMinor, "Completed funds amount");
      if (allocated < 0 || total <= 0) fail("The completed funds allocation requires reconciliation.");
      if (safe(allocated + input.amountMinor, "Funds allocation") > total) fail("The completed funds transfer is already allocated to invoices.");
      journalEntryId = existing.id;
      writeMovement = () => tx.set(allocationRef, { organizationId: actor.organizationId, branchId, headOfficeBranchId, companyFundsTransferId: existing.id, allocatedMinor: allocated + input.amountMinor, updatedAt: FieldValue.serverTimestamp() });
    } else {
      const accountRefs = [input.sourceBankAccountId, input.destinationBankAccountId].filter((id): id is string => Boolean(id)).map(id => db.doc(`bankAccounts/${id}`));
      const accounts = accountRefs.length ? await tx.getAll(...accountRefs) : [];
      const from = resolveSettlementAccount(actor.organizationId, input.sourceMethod, input.sourceBankAccountId, accounts.find(row => row.id === input.sourceBankAccountId), { branchId });
      const to = resolveSettlementAccount(actor.organizationId, input.destinationMethod, input.destinationBankAccountId, accounts.find(row => row.id === input.destinationBankAccountId), { branchId: headOfficeBranchId });
      if (!/^10\d{2}$/.test(from.accountCode) || !/^10\d{2}$/.test(to.accountCode)) fail("Select configured company money accounts.");
      if (input.sourceMethod === "bank_transfer" && input.destinationMethod === "bank_transfer" && from.accountCode === to.accountCode) fail("The bank accounts must use distinct money-ledger codes.");
      const accountNames = new Map([["1380", "Interbranch funds clearing"], [from.accountCode, from.accountName], [to.accountCode, to.accountName]]);
      const registry = await tx.getAll(...[...accountNames.keys()].map(code => db.doc(`chartOfAccounts/${uniquenessDocumentId(actor.organizationId, code)}`)));
      registry.forEach((account, index) => {
        const code = [...accountNames.keys()][index]!;
        if (account.exists && (account.get("organizationId") !== actor.organizationId || account.get("code") !== code || account.get("active") === false || (account.get("currency") && account.get("currency") !== "NGN") || account.get("billingControlPurpose") || (code === "1380" && account.get("systemManaged") !== true)))
          fail(`Accounting account ${code} requires authorized reconciliation before this payment.`);
      });
      const sequenceNumber = safe(Number(sequence!.get("value") ?? 0) + 1, "Journal counter");
      const details = { sourceBranchId: branchId, destinationBranchId: headOfficeBranchId, sourceMethod: input.sourceMethod, destinationMethod: input.destinationMethod, sourceBankAccountId: input.sourceBankAccountId ?? null, destinationBankAccountId: input.destinationBankAccountId ?? null, sourceAccountName: from.accountName, destinationAccountName: to.accountName, amountMinor: input.amountMinor, bankReference: input.reference, confirmedCompleted: true, bankFeesExcludedFromThisTransfer: true, internalTradeInvoiceId: invoice.id };
      writeMovement = () => {
        for (const account of registry) if (!account.exists) {
          const code = [...accountNames.keys()][registry.indexOf(account)]!;
          tx.create(account.ref, { organizationId: actor.organizationId, code, name: accountNames.get(code), currency: "NGN", active: true, systemManaged: true, updatedAt: FieldValue.serverTimestamp() });
        }
        const common = { manageAccounts: false, journalCounter: counter, journalType: "internal_funds_transfer", referenceType: "companyFundsTransfer", referenceId: journal.id, referenceNumber, effectiveAt, details };
        writeJournal(tx, actor, { ...common, journal, journalCounterValue: sequenceNumber, branchId, description: `Internal supply payment · ${input.reference}`, lines: [
          { accountCode: "1380", accountName: "Interbranch funds clearing", debitMinor: input.amountMinor, creditMinor: 0 },
          { accountCode: from.accountCode, accountName: from.accountName, bankAccountId: input.sourceBankAccountId, debitMinor: 0, creditMinor: input.amountMinor },
        ] });
        writeJournal(tx, actor, { ...common, journal: destinationJournal, journalCounterValue: sequenceNumber + 1, branchId: headOfficeBranchId, description: `Internal supply payment received · ${input.reference}`, lines: [
          { accountCode: to.accountCode, accountName: to.accountName, bankAccountId: input.destinationBankAccountId, debitMinor: input.amountMinor, creditMinor: 0 },
          { accountCode: "1380", accountName: "Interbranch funds clearing", debitMinor: 0, creditMinor: input.amountMinor },
        ] });
        // Reserve all of this newly recorded transfer, so it cannot be allocated twice later.
        tx.create(db.doc(`internalTradePaymentAllocations/${actor.organizationId}_${journal.id}`), { organizationId: actor.organizationId, branchId, headOfficeBranchId, companyFundsTransferId: journal.id, allocatedMinor: input.amountMinor, updatedAt: FieldValue.serverTimestamp() });
      };
    }
    const invoiceVersion = safe(Number(invoice.get("version") ?? 0) + 1, "Invoice version");
    const balanceVersion = safe(Number(balance!.get("version") ?? 0) + 1, "Branch balance version");
    const entry = db.collection("internalTradeEntries").doc(`${invoice.id}_${String(invoiceVersion).padStart(12, "0")}`);
    writeMovement();
    tx.update(invoice.ref, { paidMinor, balanceMinor: invoiceBalance - input.amountMinor, version: invoiceVersion, updatedAt: FieldValue.serverTimestamp() });
    tx.update(balance!.ref, { paidMinor: balancePaid, balanceMinor: nextBalance, version: balanceVersion, updatedAt: FieldValue.serverTimestamp() });
    tx.create(entry, { organizationId: actor.organizationId, invoiceId: invoice.id, branchId, headOfficeBranchId, kind: "payment", amountMinor: input.amountMinor, signedAmountMinor: -input.amountMinor, currency: "NGN", journalEntryId, reference: input.reference, effectiveAt, createdAt: FieldValue.serverTimestamp(), actorUserId: actor.userId });
    tx.create(operation, { organizationId: actor.organizationId, fingerprint, paymentId: entry.id, invoiceId: invoice.id, journalEntryId, actorUserId: actor.userId, createdAt: FieldValue.serverTimestamp() });
    writeAuditLog(tx, actor, { action: "internal_trade.payment_recorded", entityType: "internalTradeInvoice", entityId: invoice.id, correlationId: input.idempotencyKey, sourceFunction: "stockTransfers", after: { paymentId: entry.id, amountMinor: input.amountMinor, branchId, headOfficeBranchId, journalEntryId, existingFundsTransfer: Boolean(input.existingFundsTransferId) } });
    return { invoiceId: invoice.id, paymentId: entry.id, journalEntryId, repeated: false };
  });
}
