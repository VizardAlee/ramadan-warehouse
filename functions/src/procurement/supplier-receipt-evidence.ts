import { FieldPath } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import type { AccountReceiptEvidence } from "../accounting/account-receipt.js";
import { requireProcurementScope, type ProcurementAccess } from "./authorize.js";

const fail = (): never => { throw new HttpsError("failed-precondition", "Historical supplier receipt evidence requires reconciliation. No current balances have been substituted."); };
const scope = (row: FirebaseFirestore.DocumentSnapshot) => ({ branchId: row.get("branchId") || undefined, warehouseId: row.get("warehouseId") || undefined });
const scopeKey = (row: FirebaseFirestore.DocumentSnapshot) => JSON.stringify(scope(row));
function totals(rows: Array<Record<string, unknown>>) {
  const result = new Map<string, number>();
  for (const row of rows) {
    const id = row.supplierInvoiceId, amount = row.amountMinor;
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,180}$/.test(id) || typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) fail();
    const next = (result.get(id as string) ?? 0) + (amount as number);
    if (!Number.isSafeInteger(next)) fail();
    result.set(id as string, next);
  }
  return result;
}

/** Read immutable original evidence, never repair records or use today's debt. */
export async function supplierReceiptEvidence(actor: ProcurementAccess, payment: FirebaseFirestore.DocumentSnapshot): Promise<AccountReceiptEvidence | undefined> {
  if (!payment.exists || payment.get("organizationId") !== actor.organizationId || payment.get("status") !== "recorded") fail();
  requireProcurementScope(actor, scope(payment), "payables.read");
  if (Array.isArray(payment.get("invoiceAllocations"))) return undefined;
  if (payment.get("invoiceAllocations") != null) fail();
  const supplierId = payment.get("supplierId");
  if (typeof supplierId !== "string" || !/^[A-Za-z0-9_-]{1,180}$/.test(supplierId)) fail();
  const [allocations, entries] = await Promise.all([
    db.collection("supplierPaymentAllocations").where("organizationId", "==", actor.organizationId).where("supplierId", "==", supplierId).where("supplierPaymentId", "==", payment.id).orderBy(FieldPath.documentId()).limit(201).get(),
    db.collection("supplierAccountEntries").where("organizationId", "==", actor.organizationId).where("supplierId", "==", supplierId).where("referenceType", "==", "supplierPayment").where("referenceId", "==", payment.id).orderBy(FieldPath.documentId()).limit(2).get(),
  ]);
  if (allocations.size > 200 || entries.size > 1) fail();
  for (const row of allocations.docs) {
    if (row.get("organizationId") !== actor.organizationId || row.get("supplierId") !== supplierId || row.get("supplierPaymentId") !== payment.id) fail();
    if ((row.get("branchId") || row.get("warehouseId")) && scopeKey(row) !== scopeKey(payment)) fail();
  }
  const entry = entries.docs[0];
  if (entry) {
    if (entry.get("organizationId") !== actor.organizationId || entry.get("supplierId") !== supplierId || entry.get("referenceType") !== "supplierPayment" || entry.get("referenceId") !== payment.id || scopeKey(entry) !== scopeKey(payment) || (payment.get("journalEntryId") && entry.get("journalEntryId") !== payment.get("journalEntryId"))) fail();
    requireProcurementScope(actor, scope(entry), "payables.read");
    const purpose = payment.get("purpose") ?? "payment";
    const expected = purpose === "advance" ? "supplier_advance" : purpose === "advance_refund" ? "supplier_advance_refund" : payment.get("source") === "advance_balance" || payment.get("method") === "supplier_advance" ? "supplier_advance_applied" : "supplier_payment";
    if (entry.get("entryType") !== undefined && entry.get("entryType") !== expected) fail();
  }
  const saved = allocations.docs.map(row => row.data()), ledger = entry?.get("allocations");
  if (ledger !== undefined && !Array.isArray(ledger)) fail();
  const rows: Array<Record<string, unknown>> = saved.length ? saved : ledger ?? [];
  const amounts = totals(rows);
  if (saved.length && Array.isArray(ledger)) {
    const canonical = (items: Map<string, number>) => JSON.stringify([...items].sort(([a], [b]) => a.localeCompare(b)));
    if (canonical(amounts) !== canonical(totals(ledger))) fail();
  }
  const sum = [...amounts.values()].reduce((total, amount) => total + amount, 0);
  if (!Number.isSafeInteger(sum) || (rows.length && ((payment.get("purpose") ?? "payment") !== "payment" || sum !== payment.get("amountMinor")))) fail();
  const ids = [...amounts.keys()], invoices = ids.length ? await db.getAll(...ids.map(id => db.doc(`supplierInvoices/${id}`))) : [];
  const invoiceAllocations = invoices.map((invoice, index) => {
    if (!invoice.exists || invoice.id !== ids[index] || invoice.get("organizationId") !== actor.organizationId || invoice.get("supplierId") !== supplierId) fail();
    requireProcurementScope(actor, scope(invoice), "payables.read");
    const original = rows.filter(row => row.supplierInvoiceId === invoice.id);
    return { supplierInvoiceId: invoice.id, invoiceNumber: original[0]?.invoiceNumber ?? invoice.get("supplierInvoiceNumber") ?? invoice.id, amountMinor: amounts.get(ids[index]!)!, outstandingAfterMinor: original.length === 1 ? original[0]?.outstandingAfterMinor ?? null : null };
  });
  return { invoiceAllocations, outstandingAfterMinor: entry?.get("balanceAfterMinor"), advanceAfterMinor: entry?.get("advanceBalanceAfterMinor") };
}
