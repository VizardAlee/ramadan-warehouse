import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "../admin.js";

export const COLLECTION_REMINDER_DAYS = 7;

export function awaitingCollectionDays(reservedAt: unknown, now: Date): number | null {
  if (!(reservedAt instanceof Timestamp)) return null;
  return Math.max(0, Math.floor((now.getTime() - reservedAt.toMillis()) / 86400000));
}

/** Bounded scan, weekly deduplication; never changes stock or cancels reservations. */
export async function queueCollectionReminders(organizationId: string, now = new Date(), limit = 25) {
  const week = Math.floor(now.getTime() / (7 * 86400000));
  const cursor = db.doc(`organizations/${organizationId}/jobCursors/collections`);
  return db.runTransaction(async (transaction) => {
    const previous = await transaction.get(cursor);
    let query = db.collection("sales").where("organizationId", "==", organizationId)
      .where("collectionStatus", "in", ["awaiting_collection", "partially_collected"])
      .orderBy("__name__").limit(limit);
    if (previous.get("saleId")) query = query.startAfter(previous.get("saleId"));
    const sales = await transaction.get(query);
    const events = sales.docs.filter((sale) => sale.get("status") === "completed" && sale.get("collectionTracked") === true &&
      (awaitingCollectionDays(sale.get("reservedAt"), now) ?? -1) >= COLLECTION_REMINDER_DAYS &&
      Number(sale.get("totalQuantity")) > Number(sale.get("collectedQuantity") ?? 0) + Number(sale.get("cancelledQuantity") ?? 0))
      .map((sale) => ({ sale, ref: db.doc(`notificationEvents/sale_collection_waiting_${sale.id}_${week}`) }));
    const existing = events.length ? await transaction.getAll(...events.map(({ ref }) => ref)) : [];
    events.forEach(({ sale, ref }, index) => {
      if (existing[index]!.exists) return;
      transaction.create(ref, {
        organizationId, entityType: "sale", entityId: sale.id, branchId: sale.get("branchId"),
        referenceNumber: sale.get("saleNumber"), eventType: "sale.collection_waiting",
        templateKey: "sale_collection_waiting_v1", recipientIds: [], recipientRoles: [],
        idempotencyKey: ref.id, status: "pending", attemptCount: 0, createdAt: FieldValue.serverTimestamp(),
      });
    });
    transaction.set(cursor, { saleId: sales.size === limit ? sales.docs.at(-1)!.id : null, updatedAt: FieldValue.serverTimestamp() });
    return events.filter((_, index) => !existing[index]!.exists).length;
  });
}
