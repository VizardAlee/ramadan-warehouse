import { pendingOrderMatches, submittedOrderInvoices, matchableQuantity } from "./invoice-matching.js";
import { createHash } from "node:crypto";
import { FieldPath, Filter, Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { db } from "../admin.js";
import { requirePermission } from "../auth/authorize.js";
import { withRecordActors } from "../audit/record-actors.js";
import { hasOrganizationProcurementPermission, hasAllBranchProcurementPermission, hasProcurementScope, requireProcurementScope, type ProcurementAccess } from "./authorize.js";
import { visitQueryPages } from "../utils/query-pages.js";

const id = z.string().trim().min(1).max(128).refine(value => !value.includes("/"), "Invalid reference.");
export const purchasingPageInput = z.object({
  branchId: id.optional(), warehouseId: id.optional(), supplierId: id.optional(),
  search: z.string().trim().max(160).optional(), status: z.string().trim().max(40).optional(),
  startDate: z.string().date().optional(), endDate: z.string().date().optional(),
  view: z.enum(["needs_action", "history", "all"]).default("needs_action"),
  pageSize: z.number().int().min(1).max(100).default(25), cursor: z.string().max(2048).optional(),
}).superRefine((value, ctx) => {
  if (value.branchId && value.warehouseId) ctx.addIssue({ code: "custom", message: "Choose one operating location." });
  if (value.startDate && value.endDate && value.startDate > value.endDate) ctx.addIssue({ code: "custom", message: "End date must not precede start date." });
});
export const purchasingInvoiceDetailInput = z.object({ supplierInvoiceId: id, branchId: id.optional(), warehouseId: id.optional() });
export const purchasingDetailInput = z.object({ purchaseOrderId: id, branchId: id.optional(), warehouseId: id.optional() });
type Input = z.infer<typeof purchasingPageInput>;
type Scope = { branchId?: string; warehouseId?: string };
const scopeOf = (row: FirebaseFirestore.DocumentSnapshot): Scope => ({ branchId: row.get("branchId") || undefined, warehouseId: row.get("warehouseId") || undefined });
const inside = (row: FirebaseFirestore.DocumentSnapshot, scope: Scope) => (!scope.branchId || row.get("branchId") === scope.branchId) && (!scope.warehouseId || row.get("warehouseId") === scope.warehouseId);
const invalidCursor = (): never => { throw new HttpsError("invalid-argument", "Restart the list after changing filters or location."); };
/** Received orders still need action until all received goods have an approved invoice. */
export function purchasingNeedsAction(kind: "orders" | "invoices", data: Record<string, unknown>) {
  if (kind === "invoices") return !["paid", "cancelled", "rejected", "void"].includes(String(data.status));
  if (["cancelled", "rejected", "closed"].includes(String(data.status))) return false;
  if (data.status !== "received") return true;
  const received = data.receivedNetAmountMinor, invoiced = data.invoicedNetAmountMinor;
  return typeof received !== "number" || typeof invoiced !== "number" || !Number.isSafeInteger(received) || !Number.isSafeInteger(invoiced) || invoiced < received;
}

export async function purchasingPage(actor: ProcurementAccess, input: Input, kind: "orders" | "invoices"): Promise<{ orders?: Record<string, unknown>[]; invoices?: Record<string, unknown>[]; nextCursor: string | null; hasMore: boolean; scanned: number; note: string }> {
  const permission = kind === "invoices" ? "payables.read" : "procurement.read";
  requirePermission(actor, "procurement.read"); requirePermission(actor, permission);
  if (input.branchId || input.warehouseId) requireProcurementScope(actor, input, ["procurement.read", permission]);
  const scope: Scope = actor.operatingContext ? actor.operatingContext.type === "branch" ? { branchId: actor.operatingContext.id } : { warehouseId: actor.operatingContext.id } : { branchId: input.branchId, warehouseId: input.warehouseId };
  if (!scope.branchId && !scope.warehouseId && hasAllBranchProcurementPermission(actor, "procurement.read") && !hasOrganizationProcurementPermission(actor, "procurement.read"))
    throw new HttpsError("failed-precondition", "Choose a branch to view purchasing. Every branch, including head office, is available.", { code: "PURCHASING_BRANCH_REQUIRED" });
  const collection = kind === "orders" ? "purchaseOrders" : "supplierInvoices";
  let query: FirebaseFirestore.Query = db.collection(collection).where("organizationId", "==", actor.organizationId);
  if (scope.branchId) query = query.where("branchId", "==", scope.branchId);
  else if (scope.warehouseId) query = query.where("warehouseId", "==", scope.warehouseId);
  else if (!hasOrganizationProcurementPermission(actor, "procurement.read") || !hasOrganizationProcurementPermission(actor, permission)) {
    const branches = [...new Set(actor.branchIds)], warehouses = [...new Set(actor.warehouseIds)];
    if (!branches.length && !warehouses.length) throw new HttpsError("permission-denied", "No purchasing locations are assigned.");
    if (branches.length + warehouses.length > 30) throw new HttpsError("resource-exhausted", "Select one location to read this register.");
    const filters = [...(branches.length ? [Filter.where("branchId", "in", branches)] : []), ...(warehouses.length ? [Filter.where("warehouseId", "in", warehouses)] : [])];
    query = query.where(filters.length === 1 ? filters[0]! : Filter.or(...filters));
  }
  if (input.supplierId) query = query.where("supplierId", "==", input.supplierId);
  if (input.status) query = query.where("status", "==", input.status);
  if (input.startDate) query = query.where("createdAt", ">=", Timestamp.fromDate(new Date(`${input.startDate}T00:00:00+01:00`)));
  if (input.endDate) query = query.where("createdAt", "<", Timestamp.fromMillis(Date.parse(`${input.endDate}T00:00:00+01:00`) + 86400000));
  // Legacy records remain discoverable without a date filter, including missing createdAt.
  if (input.startDate || input.endDate) query = query.orderBy("createdAt", "desc");
  query = query.orderBy(FieldPath.documentId());
  const fingerprint = createHash("sha256").update(JSON.stringify({ ...input, cursor: undefined, userId: actor.userId, organizationId: actor.organizationId, scope, kind, branches: actor.branchIds, warehouses: actor.warehouseIds, authorizationVersion: actor.authorizationVersion })).digest("hex");
  const visible = (row: FirebaseFirestore.DocumentSnapshot) => inside(row, scope) && inside(row, input) && hasProcurementScope(actor, scopeOf(row), "procurement.read") && hasProcurementScope(actor, scopeOf(row), permission);
  if (input.cursor) {
    let decoded: { id?: string; fingerprint?: string; checksum?: string };
    try { decoded = JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")); } catch { invalidCursor(); }
    if (!decoded! || decoded!.fingerprint !== fingerprint || !decoded!.id || !/^[^/]{1,128}$/.test(decoded!.id)) invalidCursor();
    if (decoded!.checksum !== createHash("sha256").update(`${fingerprint}:${decoded!.id}`).digest("hex")) invalidCursor();
    const anchor = await db.doc(`${collection}/${decoded!.id}`).get();
    if (!anchor.exists || anchor.get("organizationId") !== actor.organizationId || !visible(anchor) ||
      (input.supplierId && anchor.get("supplierId") !== input.supplierId) || (input.status && anchor.get("status") !== input.status)) invalidCursor();
    query = query.startAfter(anchor);
  }
  const needle = (input.search ?? "").toLocaleLowerCase("en-NG");
  const from = input.startDate ? Date.parse(`${input.startDate}T00:00:00+01:00`) : -Infinity;
  const through = input.endDate ? Date.parse(`${input.endDate}T00:00:00+01:00`) + 86400000 : Infinity;
  const rows: Record<string, unknown>[] = [];
  let scanned = 0, last: FirebaseFirestore.QueryDocumentSnapshot | undefined, more = false;
  while (rows.length < input.pageSize && scanned < 500) {
    const size = Math.min(100, 500 - scanned);
    const batch = await query.limit(size + 1).get();
    if (batch.empty) { more = false; break; }
    const documents = batch.docs.slice(0, size);
    for (let i = 0; i < documents.length; i++) {
      const row = documents[i]!; last = row; scanned++;
      more = i < documents.length - 1 || batch.size > size;
      if (!visible(row)) continue;
      const data = row.data();
      if (input.supplierId && data.supplierId !== input.supplierId) continue;
      if (input.status && data.status !== input.status) continue;
      let action = purchasingNeedsAction(kind, data);
      if (kind === "orders" && data.status === "received" &&
        (typeof data.receivedNetAmountMinor !== "number" || typeof data.invoicedNetAmountMinor !== "number" || data.receivedNetAmountMinor === 0)) {
        // Older headers can lack monetary counters. Inspect only this order's authoritative lines.
        let count = 0, incomplete = false;
        await visitQueryPages(db.collection("purchaseOrderItems").where("organizationId", "==", actor.organizationId).where("purchaseOrderId", "==", row.id), docs => {
          for (const line of docs) {
            count++;
            const received = line.get("receivedQuantity"), invoiced = line.get("invoicedQuantity"), ordered = line.get("orderedQuantity");
            if (!Number.isSafeInteger(received) || !Number.isSafeInteger(invoiced) || !Number.isSafeInteger(ordered) || received < ordered || invoiced < received) incomplete = true;
          }
          if (count > 10000) throw new HttpsError("resource-exhausted", "A historical order exceeds the reconciliation limit; no partial page was returned.");
        });
        action = count === 0 || incomplete;
      }
      if ((input.view === "needs_action" && !action) || (input.view === "history" && action)) continue;
      if (needle && ![row.id, data.purchaseOrderNumber, data.supplierInvoiceNumber, data.supplierName, data.supplierReference].some(value => String(value ?? "").toLocaleLowerCase("en-NG").includes(needle))) continue;
      if (input.startDate || input.endDate) {
        const at = data.createdAt?.toMillis?.();
        if (typeof at !== "number" || at < from || at >= through) continue;
      }
      const awaitingApproval = kind === "orders" && ["received", "partially_received"].includes(String(data.status)) && (await submittedOrderInvoices(actor.organizationId, row.id)).length > 0;
      const nextAction = kind === "orders" ? awaitingApproval ? "Review invoice approval" : data.status === "received" ? action ? "Match invoice" : "Review invoices" : data.status === "draft" ? "Submit order" : data.status === "submitted" ? "Approve order" : ["approved", "partially_received"].includes(String(data.status)) ? "Receive goods" : "View details" : data.status === "submitted" ? "Approve invoice" : ["approved", "partially_paid"].includes(String(data.status)) ? "Record payment" : "View details";
      rows.push({ ...data, id: row.id, needsAction: action, nextAction });
      if (rows.length === input.pageSize) break;
    }
    if (!more || rows.length === input.pageSize || scanned === 500) break;
    query = query.startAfter(last!);
  }
  const nextCursor = more && last ? Buffer.from(JSON.stringify({ id: last.id, fingerprint, checksum: createHash("sha256").update(`${fingerprint}:${last.id}`).digest("hex") })).toString("base64url") : null;
  const records = await withRecordActors(actor.organizationId, rows);
  return { ...(kind === "orders" ? { orders: records } : { invoices: records }), nextCursor, hasMore: Boolean(nextCursor), scanned,
    note: "Stable record order. Search and filters check up to 500 records per page; continue with Next even when a page is empty. Dates use the record creation date in Nigeria." };
}

export async function purchasingOrderDetail(actor: ProcurementAccess, input: z.infer<typeof purchasingDetailInput>) {
  requirePermission(actor, "procurement.read");
  const order = await db.doc(`purchaseOrders/${input.purchaseOrderId}`).get();
  if (!order.exists || order.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Purchase order not found.");
  requireProcurementScope(actor, scopeOf(order), "procurement.read");
  if (!inside(order, input)) throw new HttpsError("permission-denied", "Purchase order belongs to another location.");
  const items: Record<string, unknown>[] = [];
  await visitQueryPages(db.collection("purchaseOrderItems").where("organizationId", "==", actor.organizationId).where("purchaseOrderId", "==", order.id), docs => {
    for (const row of docs) {
      if (!inside(row, scopeOf(order)) || !hasProcurementScope(actor, scopeOf(row), "procurement.read")) throw new HttpsError("failed-precondition", "Order item location requires reconciliation.");
      items.push({ ...row.data(), id: row.id });
    }
    if (items.length > 10000) throw new HttpsError("resource-exhausted", "This order exceeds the detail limit; no partial order was returned.");
  }, { pageSize: 500 });
  const pending = await pendingOrderMatches(actor.organizationId, order.id);
  return { order: (await withRecordActors(actor.organizationId, [{ ...order.data(), id: order.id, revision: order.get("revision") ?? 0, expectedAt: order.get("expectedAt")?.toDate?.().toISOString() ?? null }]))[0],
    items: items.map(item => ({ ...item, pendingInvoiceQuantity: pending.quantities.get(String(item.id)) ?? 0,
      matchableQuantity: matchableQuantity(Number(item.receivedQuantity ?? 0), Number(item.invoicedQuantity ?? 0), pending.quantities.get(String(item.id)) ?? 0) })),
    pendingInvoiceCount: pending.invoices.length,
  };
}

export async function purchasingInvoiceDetail(actor: ProcurementAccess, input: z.infer<typeof purchasingInvoiceDetailInput>) {
  requirePermission(actor, "payables.read");
  const invoice = await db.doc(`supplierInvoices/${input.supplierInvoiceId}`).get();
  if (!invoice.exists || invoice.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Supplier invoice not found.");
  requireProcurementScope(actor, scopeOf(invoice), "payables.read");
  if (!inside(invoice, input)) throw new HttpsError("permission-denied", "Supplier invoice belongs to another location.");
  return { invoice: (await withRecordActors(actor.organizationId, [{ ...invoice.data(), id: invoice.id }]))[0] };
}
