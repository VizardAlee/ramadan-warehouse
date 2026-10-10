import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import { db } from "../admin.js";
import { hasServerPermission, requireAccess, requireBranchScope, requirePermission } from "../auth/authorize.js";
import { accountingPeriodReference, assertAccountingPeriodOpen } from "../accounting/period-lock.js";
import { resolveSettlementAccount } from "../accounting/settlement-account.js";
import { writeJournal } from "../accounting/write-journal.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { remainingCharge, validateBilling, type MixedBilling } from "../billing/allocations.js";
import { readBillingMapping } from "../billing/mappings.js";
import { enforceAppCheck } from "../config.js";
import { uniquenessDocumentId } from "../inventory/calculations.js";
import { correlationId, parseInput } from "../utils/callable.js";
import { visitQueryPages } from "../utils/query-pages.js";
const id = z.string().regex(/^[A-Za-z0-9_:-]{1,180}$/);
const payment = { saleId: id, componentId: id, method: z.enum(["cash", "card", "bank_transfer"]), bankAccountId: id.optional(), amountMinor: z.number().int().positive().safe(), reference: z.string().trim().min(3).max(160), reason: z.string().trim().min(5).max(500), idempotencyKey: z.string().uuid() };
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("workspace"), branchId: id.optional(), fromDate: z.iso.date(), toDate: z.iso.date(), cursorId: id.optional(), includeSummary: z.boolean().default(true) }),
  z.object({ action: z.literal("detail"), saleId: id }),
  z.object({ action: z.literal("settle"), ...payment }),
  z.object({ action: z.literal("recover"), ...payment, originalPaymentId: id }),
]);
const fail = (message: string): never => { throw new HttpsError("failed-precondition", message); };
export const providerFunds = onCall({ enforceAppCheck, timeoutSeconds: 300 }, async request => {
  const actor = await requireAccess(request), input = parseInput(schema, request.data);
  requirePermission(actor, input.action === "settle" || input.action === "recover" ? "expenses.pay" : "expenses.read");
  if (input.action === "recover") requirePermission(actor, "finance.journal.reverse");
  const scope = (sale: FirebaseFirestore.DocumentSnapshot) => {
    if (!sale.exists || sale.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Invoice not found.");
    requireBranchScope(actor, String(sale.get("branchId")));
  };
  const rows = (sale: FirebaseFirestore.DocumentSnapshot) => {
    const state = sale.get("billing") as MixedBilling | undefined; if (!state) return [];
    validateBilling(state);
    return state.components.filter(c => c.kind === "provider").map(c => ({ saleId: sale.id, saleNumber: sale.get("saleNumber"), branchId: sale.get("branchId"), componentId: c.id, supplierId: c.supplierId!, supplierName: c.supplierName!, originalMinor: c.grossMinor, creditedMinor: c.creditedGrossMinor, collectedMinor: c.paidMinor, settledMinor: c.settledMinor ?? 0, outstandingMinor: remainingCharge(c) - (c.settledMinor ?? 0), invoiceDate: sale.get("recordedAt").toDate().toISOString() }));
  };
  if (input.action === "workspace") {
    if (input.fromDate > input.toDate) throw new HttpsError("invalid-argument", "Choose a valid date range.");
    let branchId = input.branchId;
    if (!hasServerPermission(actor, "sales.read.all")) { branchId ??= actor.branchIds.length === 1 ? actor.branchIds[0] : undefined; if (!branchId) throw new HttpsError("invalid-argument", "Select an assigned store."); }
    if (branchId) requireBranchScope(actor, branchId);
    const start = Timestamp.fromDate(new Date(`${input.fromDate}T00:00:00+01:00`)), end = Timestamp.fromMillis(Date.parse(`${input.toDate}T00:00:00+01:00`) + 86_400_000);
    let base: FirebaseFirestore.Query = db.collection("sales").where("organizationId", "==", actor.organizationId).where("recordedAt", ">=", start).where("recordedAt", "<", end);
    if (branchId) base = base.where("branchId", "==", branchId);
    let pageQuery = base.orderBy("recordedAt").orderBy("__name__");
    if (input.cursorId) { const cursor = await db.doc(`sales/${input.cursorId}`).get(); const date = cursor.get("recordedAt"); if (!cursor.exists || cursor.get("organizationId") !== actor.organizationId || (branchId && cursor.get("branchId") !== branchId) || !(date instanceof Timestamp) || date.valueOf() < start.valueOf() || date.valueOf() >= end.valueOf()) throw new HttpsError("invalid-argument", "This page cursor does not belong to the selected register."); pageQuery = pageQuery.startAfter(cursor); }
    const page = await pageQuery.limit(51).get(), selected = page.docs.slice(0, 50);
    const summary = { originalMinor: 0, creditedMinor: 0, collectedMinor: 0, settledMinor: 0, outstandingMinor: 0 };
    if (input.includeSummary) await visitQueryPages(base, docs => { for (const sale of docs) for (const row of rows(sale)) for (const key of Object.keys(summary) as Array<keyof typeof summary>) { summary[key] += row[key]; if (!Number.isSafeInteger(summary[key])) fail("Provider totals exceed safe minor-unit arithmetic."); } }, { orderField: "recordedAt", pageSize: 100 });
    return { rows: selected.flatMap(rows), nextCursorId: page.size > 50 ? selected.at(-1)!.id : null, summary: input.includeSummary ? summary : null, branchId: branchId ?? null, scannedInvoices: selected.length, basis: "Invoices issued in range; current credits, collections and provider settlements" };
  }
  const saleRef = db.doc(`sales/${input.saleId}`);
  if (input.action === "detail") {
    const sale = await saleRef.get(); scope(sale);
    const payments = await db.collection("providerFundPayments").where("saleId", "==", sale.id).limit(201).get();
    if (payments.size > 200) fail("This invoice needs paged provider payment history; no records were silently omitted.");
    if (payments.docs.some(doc => doc.get("organizationId") !== actor.organizationId)) fail("Provider payment evidence requires reconciliation.");
    return { rows: rows(sale), payments: payments.docs.map(doc => ({ id: doc.id, ...doc.data(), paidAt: doc.get("paidAt").toDate().toISOString() })) };
  }
  if (input.method !== "cash" && !input.bankAccountId) throw new HttpsError("invalid-argument", "Select the company financial account.");
  if (input.method === "cash" && input.bankAccountId) throw new HttpsError("invalid-argument", "Company cash cannot use a bank account.");
  const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex"), op = db.doc(`idempotencyOperations/${uniquenessDocumentId(actor.organizationId, "providerFunds", input.idempotencyKey)}`), paymentRef = db.collection("providerFundPayments").doc(), journal = db.collection("journalEntries").doc(), counter = db.doc(`journalCounters/${uniquenessDocumentId(actor.organizationId, "general")}`), effectiveAt = Timestamp.now();
  return db.runTransaction(async tx => {
    const previous = await tx.get(op);
    if (previous.exists) { if (previous.get("fingerprint") !== fingerprint || previous.get("organizationId") !== actor.organizationId) fail("This retry key belongs to different provider instructions."); return previous.get("result"); }
    const [sale, sequence, period, bank] = await tx.getAll(saleRef, counter, accountingPeriodReference(actor.organizationId, effectiveAt), db.doc(`bankAccounts/${input.bankAccountId ?? "no-bank-account"}`)); scope(sale!); assertAccountingPeriodOpen(period!);
    const state = sale!.get("billing") as MixedBilling | undefined; if (!state) fail("This invoice has no provider-funds obligation."); validateBilling(state!); await readBillingMapping(tx, actor.organizationId, state!.mapping);
    const after = structuredClone(state!), component = after.components.find(c => c.id === input.componentId && c.kind === "provider"); if (!component) fail("Provider obligation not found on this invoice.");
    let original: FirebaseFirestore.DocumentSnapshot | null = null;
    if (input.action === "recover") {
      original = await tx.get(db.doc(`providerFundPayments/${input.originalPaymentId}`));
      if (!original.exists || original.get("organizationId") !== actor.organizationId || original.get("saleId") !== sale!.id || original.get("componentId") !== component!.id || original.get("entryType") !== "settlement" || !Number.isSafeInteger(original.get("amountMinor")) || !Number.isSafeInteger(original.get("recoveredMinor") ?? 0) || input.amountMinor > Number(original.get("amountMinor")) - Number(original.get("recoveredMinor") ?? 0) || input.amountMinor > (component!.settledMinor ?? 0)) fail("The recovery exceeds the original provider settlement.");
      component!.settledMinor = (component!.settledMinor ?? 0) - input.amountMinor;
    } else { if (input.amountMinor > remainingCharge(component!) - (component!.settledMinor ?? 0)) fail("The payment exceeds this provider obligation."); component!.settledMinor = (component!.settledMinor ?? 0) + input.amountMinor; }
    const settlement = resolveSettlementAccount(actor.organizationId, input.method, input.bankAccountId, bank!), control = state!.mapping.providerPayable;
    const lines = [{ accountCode: control.code, accountId: control.id, accountName: control.name, debitMinor: input.action === "settle" ? input.amountMinor : 0, creditMinor: input.action === "recover" ? input.amountMinor : 0 }, { accountCode: settlement.accountCode, accountName: settlement.accountName, bankAccountId: settlement.bankAccountId, debitMinor: input.action === "recover" ? input.amountMinor : 0, creditMinor: input.action === "settle" ? input.amountMinor : 0 }];
    const journalNumber = writeJournal(tx, actor, { journal, journalCounter: counter, journalCounterValue: Number(sequence!.get("value") ?? 0) + 1, journalType: input.action === "settle" ? "provider_funds_settlement" : "provider_funds_recovery", referenceType: "providerFundPayment", referenceId: paymentRef.id, referenceNumber: String(sale!.get("saleNumber")), description: input.reason, branchId: sale!.get("branchId"), effectiveAt, lines });
    tx.update(saleRef, { billing: validateBilling(after), billingUpdatedAt: FieldValue.serverTimestamp() });
    tx.create(paymentRef, { organizationId: actor.organizationId, branchId: sale!.get("branchId"), saleId: sale!.id, componentId: component!.id, supplierId: component!.supplierId!, supplierName: component!.supplierName!, entryType: input.action === "settle" ? "settlement" : "recovery", amountMinor: input.amountMinor, recoveredMinor: 0, originalPaymentId: input.action === "recover" ? input.originalPaymentId : null, method: input.method, bankAccountId: settlement.bankAccountId ?? null, ledgerAccountCode: settlement.accountCode, reference: input.reference, reason: input.reason, journalEntryId: journal.id, journalNumber, currency: "NGN", paidAt: effectiveAt, createdAt: FieldValue.serverTimestamp(), createdBy: actor.userId });
    if (original) tx.update(original.ref, { recoveredMinor: Number(original.get("recoveredMinor") ?? 0) + input.amountMinor });
    const result = { paymentId: paymentRef.id, journalEntryId: journal.id, recorded: true }; tx.create(op, { organizationId: actor.organizationId, fingerprint, result, createdAt: FieldValue.serverTimestamp() });
    writeAuditLog(tx, actor, { action: `billing.provider_${input.action}`, entityType: "providerFundPayment", entityId: paymentRef.id, sourceFunction: "providerFunds", correlationId: correlationId(), reason: input.reason, after: { saleId: sale!.id, supplierId: component!.supplierId!, componentId: component!.id, amountMinor: input.amountMinor, journalEntryId: journal.id } }); return result;
  });
});
