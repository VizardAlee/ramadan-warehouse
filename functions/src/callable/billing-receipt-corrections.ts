import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import { db } from "../admin.js";
import { requireAccess, requireBranchScope, requirePermission } from "../auth/authorize.js";
import { accountingPeriodReference, assertAccountingPeriodOpen } from "../accounting/period-lock.js";
import { resolveSettlementAccount } from "../accounting/settlement-account.js";
import { writeJournal } from "../accounting/write-journal.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { creditBilling, remainingCharge, validateBilling, type MixedBilling } from "../billing/allocations.js";
import { prepareBillingTransition, writeBillingTransition } from "../billing/transitions.js";
import { enforceAppCheck } from "../config.js";
import { uniquenessDocumentId } from "../inventory/calculations.js";
import { changeArrangementBalance } from "../sales/customer-arrangements.js";
import { changeMoneyBalance } from "../sales/receivables.js";
import { correlationId, parseInput } from "../utils/callable.js";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("workspace"), saleId: id }),
  z.object({ action: z.literal("refund"), saleId: id, sourceType: z.enum(["salePayments", "customerPayments", "aftersalesPayments"]), sourceId: id, amountMinor: z.number().int().positive().safe(), method: z.enum(["cash", "card", "bank_transfer"]), bankAccountId: id.optional(), shiftId: id.optional(), reference: z.string().trim().min(3).max(160), reason: z.string().trim().min(5).max(500), idempotencyKey: z.string().uuid() }),
]);
const fail = (message: string): never => { throw new HttpsError("failed-precondition", message); };
function sourceAmount(source: FirebaseFirestore.DocumentSnapshot, type: string, sale: FirebaseFirestore.DocumentSnapshot, billing: MixedBilling) {
  if (source.get("organizationId") !== sale.get("organizationId") || (type !== "customerPayments" && source.get("branchId") !== sale.get("branchId")) || source.get("currency") !== "NGN" || !["cash", "card", "bank_transfer"].includes(source.get("method"))) return 0;
  // Commercial refunds do not identify which tender funded them. Earlier source
  // balances are therefore ambiguous even if a later repayment raises paidMinor.
  const cutoff = sale.get("billingRefundProvenanceCutoffAt"), recorded = source.get("createdAt") ?? source.get("recordedAt");
  if (cutoff instanceof Timestamp && (!(recorded instanceof Timestamp) || recorded.toMillis() <= cutoff.toMillis())) return 0;
  let gross = 0;
  if (type === "salePayments" && source.get("saleId") === sale.id && source.get("status") === "recorded") gross = source.get("amountMinor");
  if (type === "customerPayments" && source.get("customerId") === sale.get("customerId") && source.get("purpose") === "repayment" && source.get("status") === "recorded" && source.get("direction") === "inflow") gross = (source.get("invoiceAllocations") ?? []).filter((line: { saleId: string }) => line.saleId === sale.id).reduce((sum: number, line: { amountMinor: number }) => sum + line.amountMinor, 0);
  if (type === "aftersalesPayments" && source.get("entryType") === "receipt" && source.get("serviceBillingVersion") === 2 && billing.components.some(c => c.aftersalesCaseId === source.get("caseId"))) gross = Number(source.get("amountMinor")) - Number(source.get("refundedAmountMinor") ?? 0);
  const returned = Number((source.get("billingRefundsBySale") ?? {})[sale.id] ?? 0);
  if (![gross, returned].every(value => Number.isSafeInteger(value) && value >= 0) || returned > gross) fail("Receipt correction evidence requires reconciliation.");
  return gross - returned;
}
export const billingReceiptCorrections = onCall({ enforceAppCheck, timeoutSeconds: 300 }, async request => {
  const actor = await requireAccess(request), input = parseInput(schema, request.data);
  requirePermission(actor, "sales.returns.approve");
  const saleRef = db.doc(`sales/${input.saleId}`);
  function scope(sale: FirebaseFirestore.DocumentSnapshot) {
    if (!sale.exists || sale.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Invoice not found.");
    requireBranchScope(actor, String(sale.get("branchId")));
    if (!sale.get("customerId") || sale.get("receivableVersion") !== 1 || !sale.get("billing")) fail("Receipt corrections require a named customer's tracked mixed invoice. Use the original workflow for historical receipts.");
    return validateBilling(sale.get("billing") as MixedBilling);
  }
  if (input.action === "workspace") {
    const sale = await saleRef.get(), billing = scope(sale);
    const queries = [db.collection("salePayments").where("saleId", "==", sale.id), db.collection("customerPayments").where("customerId", "==", sale.get("customerId")), ...billing.components.filter(c => c.aftersalesCaseId).map(c => db.collection("aftersalesPayments").where("caseId", "==", c.aftersalesCaseId))];
    const pages = await Promise.all(queries.map(query => query.limit(201).get()));
    if (pages.some(page => page.size > 200)) fail("Receipt history exceeds this selector's 200-record source limit. No partial receipt list was returned.");
    return { saleId: sale.id, saleNumber: sale.get("saleNumber"), customerName: sale.get("customerName"), paidMinor: billing.paidMinor, outstandingMinor: sale.get("receivableOutstandingMinor"), provenanceNotice: sale.get("billingRefundProvenanceCutoffAt") ? "Earlier receipts require reconciliation after a commercial refund. Only later identifiable receipts are eligible for correction; later repayments do not make refunded original money eligible again." : null, receipts: pages.flatMap(page => page.docs.flatMap(source => { try { requireBranchScope(actor, String(source.get("branchId"))); } catch { return []; } const sourceType = source.ref.parent.id, remainingMinor = sourceAmount(source, sourceType, sale, billing); return remainingMinor ? [{ sourceType, id: source.id, method: source.get("method"), reference: source.get("reference") ?? source.get("paymentNumber") ?? source.id, remainingMinor }] : []; })) };
  }
  requirePermission(actor, "finance.journal.reverse");
  if ((input.method !== "cash" && (!input.bankAccountId || input.shiftId)) || (input.method === "cash" && (!input.shiftId || input.bankAccountId))) throw new HttpsError("invalid-argument", "Choose the actual funding account or open cash till.");
  const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex"), operation = db.doc(`idempotencyOperations/${uniquenessDocumentId(actor.organizationId, "billingReceiptCorrections", input.idempotencyKey)}`), sourceRef = db.doc(`${input.sourceType}/${input.sourceId}`), refund = db.collection("saleRefunds").doc(), journal = db.collection("journalEntries").doc(), counter = db.doc(`journalCounters/${uniquenessDocumentId(actor.organizationId, "general")}`), effectiveAt = Timestamp.now();
  return db.runTransaction(async tx => {
    const previous = await tx.get(operation);
    if (previous.exists) { if (previous.get("organizationId") !== actor.organizationId || previous.get("fingerprint") !== fingerprint) fail("This retry key belongs to different correction instructions."); return previous.get("result"); }
    const [sale, source, sequence, period, bank, shift] = await tx.getAll(saleRef, sourceRef, counter, accountingPeriodReference(actor.organizationId, effectiveAt), db.doc(`bankAccounts/${input.bankAccountId ?? "no-account"}`), db.doc(`posShifts/${input.shiftId ?? "no-shift"}`));
    const billing = scope(sale!); assertAccountingPeriodOpen(period!);
    const customer = await tx.get(db.doc(`customers/${sale!.get("customerId")}`));
    if (!customer.exists || customer.get("organizationId") !== actor.organizationId) fail("Customer balance evidence requires reconciliation.");
    if (input.amountMinor > sourceAmount(source!, input.sourceType, sale!, billing) || input.amountMinor > billing.paidMinor) fail("The correction exceeds this receipt or the invoice's remaining received funds.");
    requireBranchScope(actor, String(source!.get("branchId")));
    const originalJournalId = input.sourceType === "salePayments" ? sale!.get("journalEntryId") : source!.get("journalEntryId");
    if (typeof originalJournalId !== "string" || !originalJournalId) fail("Original receipt journal is missing.");
    const original = await tx.get(db.doc(`journalEntries/${originalJournalId}`));
    const expectedReference = input.sourceType === "salePayments" ? sale!.id : source!.id;
    if (!original.exists || original.get("organizationId") !== actor.organizationId || original.get("referenceId") !== expectedReference || original.get("referenceType") !== ({ salePayments: "sale", customerPayments: "customerPayment", aftersalesPayments: "aftersalesPayment" }[input.sourceType]) || original.get("journalType") !== ({ salePayments: "sale", customerPayments: "customer_payment", aftersalesPayments: "aftersales_payment" }[input.sourceType]) || original.get("branchId") !== source!.get("branchId") || original.get("currency") !== "NGN" || original.get("status") !== "posted" || original.get("reversedByJournalEntryId") || original.get("reversalJournalEntryId")) fail("Original receipt journal requires reconciliation before correction.");
    if (input.method === "cash" && (!shift!.exists || shift!.get("organizationId") !== actor.organizationId || shift!.get("branchId") !== sale!.get("branchId") || shift!.get("status") !== "open")) fail("Choose an open cash till at this invoice's store.");
    const after = creditBilling(billing, [], input.amountMinor), transition = await prepareBillingTransition(tx, sale!, after), settlement = resolveSettlementAccount(actor.organizationId, input.method, input.bankAccountId, bank!);
    if (!/^10\d{2}$/.test(settlement.accountCode)) fail("Select a company cash or bank ledger account.");
    const outstanding = Number(sale!.get("receivableOutstandingMinor")), customerOutstanding = Number(customer.get("outstandingBalanceMinor")), next = customerOutstanding + input.amountMinor, accountId = sale!.get("customerAccountId") ?? "general";
    if (![outstanding, customerOutstanding, next].every(value => Number.isSafeInteger(value) && value >= 0) || outstanding !== billing.components.reduce((sum, c) => sum + remainingCharge(c), 0) - billing.paidMinor || sale!.get("receivablePaidMinor") !== billing.paidMinor || !Number.isSafeInteger(outstanding + input.amountMinor)) fail("Invoice debt and receipt evidence requires reconciliation.");
    const arrangements = changeArrangementBalance(customer.data()!, [{ accountId, amountMinor: input.amountMinor }]), invoiceDebtByAccount = changeMoneyBalance(customer.get("invoiceDebtByAccount"), accountId, input.amountMinor);
    const lines = [{ accountCode: "1100", accountName: "Customer receivables", debitMinor: input.amountMinor, creditMinor: 0 }, { accountCode: settlement.accountCode, accountName: settlement.accountName, bankAccountId: settlement.bankAccountId, debitMinor: 0, creditMinor: input.amountMinor }, ...transition.lines];
    const journalNumber = writeJournal(tx, actor, { journal, journalCounter: counter, journalCounterValue: Number(sequence!.get("value") ?? 0) + 1, journalType: "invoice_receipt_correction", referenceType: "saleRefund", referenceId: refund.id, referenceNumber: String(sale!.get("saleNumber")), description: input.reason, branchId: sale!.get("branchId"), effectiveAt, lines });
    const now = FieldValue.serverTimestamp(); writeBillingTransition(tx, saleRef, transition, actor.userId);
    tx.update(saleRef, { receivablePaidMinor: after.paidMinor, receivableOutstandingMinor: outstanding + input.amountMinor, receivableStatus: "open", receivableUpdatedAt: now });
    tx.update(customer.ref, { outstandingBalanceMinor: next, arrangements, invoiceDebtByAccount, availableCreditMinor: customer.get("creditStatus") === "approved" ? Math.max(0, Number(customer.get("creditLimitMinor") ?? 0) - next) : 0, updatedAt: now, updatedBy: actor.userId });
    tx.update(sourceRef, { billingRefundsBySale: { ...(source!.get("billingRefundsBySale") ?? {}), [sale!.id]: Number((source!.get("billingRefundsBySale") ?? {})[sale!.id] ?? 0) + input.amountMinor } });
    if (input.method === "cash") tx.update(shift!.ref, { cashRefundsMinor: Number(shift!.get("cashRefundsMinor") ?? 0) + input.amountMinor, updatedAt: now });
    tx.create(refund, { organizationId: actor.organizationId, branchId: sale!.get("branchId"), saleId: sale!.id, entryType: "receipt_correction", refundNumber: `RCP-${refund.id}`, sourceType: input.sourceType, sourceId: source!.id, originalJournalEntryId: original.id, amountMinor: input.amountMinor, method: input.method, bankAccountId: settlement.bankAccountId ?? null, shiftId: input.shiftId ?? null, reference: input.reference, reason: input.reason, journalEntryId: journal.id, journalNumber, currency: "NGN", status: "recorded", recordedAt: effectiveAt, recordedBy: actor.userId, createdAt: now });
    tx.create(db.collection("customerAccountEntries").doc(), { organizationId: actor.organizationId, branchId: sale!.get("branchId"), customerId: customer.id, customerAccountId: accountId, customerAccountName: sale!.get("customerAccountName") ?? "General account", entryType: "receipt_refund", referenceType: "saleRefund", referenceId: refund.id, referenceNumber: `RCP-${refund.id}`, amountMinor: input.amountMinor, debtAmountMinor: input.amountMinor, advanceAmountMinor: 0, journalEntryId: journal.id, balanceAfterMinor: next, currency: "NGN", effectiveAt, createdAt: now, createdBy: actor.userId });
    const result = { refundId: refund.id, journalEntryId: journal.id, outstandingMinor: outstanding + input.amountMinor }; tx.create(operation, { organizationId: actor.organizationId, fingerprint, result, createdAt: now });
    writeAuditLog(tx, actor, { action: "billing.receipt_corrected", entityType: "saleRefund", entityId: refund.id, sourceFunction: "billingReceiptCorrections", correlationId: correlationId(), reason: input.reason, after: { saleId: sale!.id, sourceId: source!.id, amountMinor: input.amountMinor, journalEntryId: journal.id } }); return result;
  });
});
