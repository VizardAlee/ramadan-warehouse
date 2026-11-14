import { FieldPath } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { db } from "../admin.js";
import { hasRole, type AccessProfile } from "../auth/authorize.js";
import { canCollectPhysicalHandover } from "./handover-access.js";

const inputSchema = z.object({
  action: z.enum(["stock_collections", "stock_collection_detail"]),
  branchId: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/),
  saleId: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/).optional(),
  cursor: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/).optional(),
});

export function assertStockQueueBranch(actor: AccessProfile, branchId: string) {
  const administrator = hasRole(actor, "system_administrator") || hasRole(actor, "operations_administrator");
  if (!administrator && !actor.branchIds.includes(branchId)) throw new HttpsError("permission-denied", "This handover is outside your assigned branch.");
  if (!actor.operatingContext || actor.operatingContext.type !== "branch" || actor.operatingContext.id !== branchId) throw new HttpsError("failed-precondition", "Select this branch before viewing or recording handover.");
}

/** A deliberately non-financial projection; no prices, costs, payments or account data. */
export function stockHandoverItem(id: string, item: Record<string, unknown>) {
  const collected = Number(item.collectedQuantity ?? 0), cancelled = Number(item.cancelledQuantity ?? 0);
  const used = new Set([...(item.collectedSerialNumbers as string[] ?? []), ...(item.cancelledSerialNumbers as string[] ?? [])]);
  return { id, productName: item.productName, unitOfMeasure: item.unitOfMeasure ?? "unit", trackingType: item.trackingType,
    remaining: Math.max(0, Number(item.quantity) - collected - cancelled),
    serialNumbers: (item.serialNumbers as string[] ?? []).filter(serial => !used.has(serial)) };
}

export async function readStockCollection(actor: AccessProfile, data: unknown) {
  const input = inputSchema.parse(data);
  assertStockQueueBranch(actor, input.branchId);
  const branch = await db.doc(`branches/${input.branchId}`).get();
  if (!branch.exists || branch.get("organizationId") !== actor.organizationId || branch.get("status") !== "active" || !canCollectPhysicalHandover(actor, branch)) throw new HttpsError("permission-denied", "Branch handover access is not assigned.");
  if (input.action === "stock_collection_detail") {
    if (!input.saleId) throw new HttpsError("invalid-argument", "Select an invoice.");
    const sale = await db.doc(`sales/${input.saleId}`).get();
    if (!sale.exists || sale.get("organizationId") !== actor.organizationId || sale.get("branchId") !== input.branchId) throw new HttpsError("not-found", "Handover not found in this branch.");
    if (sale.get("status") !== "completed" || sale.get("collectionTracked") !== true || !["awaiting_collection", "partially_collected"].includes(sale.get("collectionStatus"))) throw new HttpsError("failed-precondition", "This sale has no goods awaiting collection. Refresh the queue.");
    const items = await db.collection("saleItems").where("saleId", "==", sale.id).limit(101).get();
    if (items.size > 100 || items.docs.some(item => item.get("organizationId") !== actor.organizationId || item.get("branchId") !== input.branchId)) throw new HttpsError("data-loss", "Handover items require administrator review.");
    return { id: sale.id, saleNumber: sale.get("saleNumber"), customerName: sale.get("customerName") ?? "Walk-in customer", collectionStatus: sale.get("collectionStatus"),
      items: items.docs.filter(item => item.get("itemKind") !== "service" && item.get("collectionTracked") !== false).map(item => stockHandoverItem(item.id, item.data())).filter(item => item.remaining > 0) };
  }
  let query = db.collection("sales").where("organizationId", "==", actor.organizationId).where("branchId", "==", input.branchId)
    .where("collectionStatus", "in", ["awaiting_collection", "partially_collected"]).orderBy("recordedAt", "desc").orderBy(FieldPath.documentId(), "desc");
  if (input.cursor) {
    const cursor = await db.doc(`sales/${input.cursor}`).get();
    if (!cursor.exists || cursor.get("organizationId") !== actor.organizationId || cursor.get("branchId") !== input.branchId) throw new HttpsError("invalid-argument", "Invalid handover page.");
    query = query.startAfter(cursor.get("recordedAt"), cursor.id);
  }
  const result = await query.limit(26).get();
  return { rows: result.docs.slice(0, 25).map(sale => ({ id: sale.id, saleNumber: sale.get("saleNumber"), customerName: sale.get("customerName") ?? "Walk-in customer", collectionStatus: sale.get("collectionStatus"), remaining: Math.max(0, Number(sale.get("physicalQuantity") ?? sale.get("totalQuantity")) - Number(sale.get("collectedQuantity") ?? 0) - Number(sale.get("cancelledQuantity") ?? 0)) })), nextCursor: result.size > 25 ? result.docs[24]!.id : null };
}
