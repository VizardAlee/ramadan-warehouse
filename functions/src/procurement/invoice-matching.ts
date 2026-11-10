import type { Query, QuerySnapshot, Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import { requestFingerprint } from "../utils/request-fingerprint.js";
import { normalizeInventoryIdentifier } from "../inventory/calculations.js";

// The caller checks order scope before reading. Single-field queries need no new
// composite indexes. Limits fail closed rather than silently undercounting.
type Reader = Pick<Transaction, "get">;
async function read(query: Query, transaction?: Reader): Promise<QuerySnapshot> {
  return transaction ? transaction.get(query) : query.get();
}
export async function submittedOrderInvoices(organizationId: string, purchaseOrderId: string, transaction?: Reader) {
  const result = await read(db.collection("supplierInvoices").where("purchaseOrderId", "==", purchaseOrderId).limit(1001), transaction);
  if (result.size > 1000) throw new HttpsError("resource-exhausted", "This order's invoice history requires reconciliation before matching more goods.");
  return result.docs.filter(invoice => invoice.get("organizationId") === organizationId && invoice.get("status") === "submitted");
}
export async function invoiceMatchingLines(organizationId: string, purchaseOrderId: string, supplierInvoiceId: string, transaction?: Reader) {
  const result = await read(db.collection("supplierInvoiceItems").where("supplierInvoiceId", "==", supplierInvoiceId).limit(101), transaction);
  if (result.empty || result.size > 100 || result.docs.some(line => line.get("organizationId") !== organizationId || line.get("purchaseOrderId") !== purchaseOrderId || !Number.isSafeInteger(line.get("quantity")) || line.get("quantity") <= 0 || typeof line.get("purchaseOrderItemId") !== "string"))
    throw new HttpsError("failed-precondition", "A submitted invoice's quantities require reconciliation before matching more goods.");
  return result.docs;
}
export async function pendingOrderMatches(organizationId: string, purchaseOrderId: string, transaction?: Reader) {
  const invoices = await submittedOrderInvoices(organizationId, purchaseOrderId, transaction);
  const quantities = new Map<string, number>();
  for (const invoice of invoices) {
    for (const line of await invoiceMatchingLines(organizationId, purchaseOrderId, invoice.id, transaction)) {
      const item = String(line.get("purchaseOrderItemId"));
      const total = (quantities.get(item) ?? 0) + Number(line.get("quantity"));
      if (!Number.isSafeInteger(total)) throw new HttpsError("failed-precondition", "Pending invoice quantities require reconciliation.");
      quantities.set(item, total);
    }
  }
  return { invoices, quantities };
}
export function matchingFingerprint(input: {
  purchaseOrderId: string; supplierInvoiceNumber: string; invoiceDate: string;
  dueDate?: string; notes?: string;
  lines: Array<{ purchaseOrderItemId: string; quantity: number }>;
}) {
  return requestFingerprint({ purchaseOrderId: input.purchaseOrderId,
    supplierInvoiceNumber: normalizeInventoryIdentifier(input.supplierInvoiceNumber),
    invoiceDate: input.invoiceDate, dueDate: input.dueDate || undefined, notes: input.notes || undefined,
    lines: [...input.lines].sort((a, b) => a.purchaseOrderItemId.localeCompare(b.purchaseOrderItemId)) });
}
export function matchableQuantity(received: number, approved: number, pending: number) {
  if (![received, approved, pending].every(value => Number.isSafeInteger(value) && value >= 0))
    throw new HttpsError("failed-precondition", "Invoice quantities require reconciliation before matching.");
  // Historical repeated submissions can exceed received quantities. Preserve
  // every original record and show no new availability until they are resolved.
  return Math.max(0, received - approved - pending);
}
