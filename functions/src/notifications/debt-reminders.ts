import { FieldValue } from "firebase-admin/firestore";
import { db } from "../admin.js";

/** Bounded, resumable scan. Existing notification delivery handles fanout/push. */
export async function queueDebtReminders(organizationId: string, now = new Date(), limit = 25) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const week = Math.floor(Date.parse(`${today}T00:00:00Z`) / (7 * 86400000));
  const cursor = db.doc(`organizations/${organizationId}/jobCursors/receivables`);
  return db.runTransaction(async (transaction) => {
    const previous = await transaction.get(cursor);
    let query = db.collection("sales").where("organizationId", "==", organizationId).where("receivableStatus", "==", "open")
      .where("receivableDueDate", "<=", today).orderBy("receivableDueDate").orderBy("__name__").limit(limit);
    if (previous.get("dueDate") && previous.get("saleId")) query = query.startAfter(previous.get("dueDate"), previous.get("saleId"));
    const invoices = await transaction.get(query);
    const events = invoices.docs.filter((sale) => Number(sale.get("receivableOutstandingMinor")) > 0).map((sale) => {
      const due = sale.get("receivableDueDate") === today;
      const eventType = due ? "customer.debt_due" : "customer.debt_overdue";
      const id = `${eventType.replaceAll(".", "_")}_${sale.id}_${due ? today : week}`;
      return { sale, eventType, id, ref: db.doc(`notificationEvents/${id}`) };
    });
    const existing = events.length ? await transaction.getAll(...events.map((event) => event.ref)) : [];
    events.forEach((event, index) => {
      if (existing[index]!.exists) return;
      transaction.create(event.ref, {
        organizationId, entityType: "sale", entityId: event.sale.id,
        customerId: event.sale.get("customerId"), branchId: event.sale.get("branchId"),
        referenceNumber: event.sale.get("saleNumber"), eventType: event.eventType,
        templateKey: `${event.eventType.replaceAll(".", "_")}_v1`,
        recipientIds: [], recipientRoles: [], idempotencyKey: event.id,
        status: "pending", attemptCount: 0, createdAt: FieldValue.serverTimestamp(),
      });
    });
    const last = invoices.docs.at(-1);
    transaction.set(cursor, { dueDate: invoices.size === limit ? last!.get("receivableDueDate") : null, saleId: invoices.size === limit ? last!.id : null, updatedAt: FieldValue.serverTimestamp() });
    return events.filter((_, index) => !existing[index]!.exists).length;
  });
}
