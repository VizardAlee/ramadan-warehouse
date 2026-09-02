import { createHash } from "node:crypto";
import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { db } from "../admin.js";
import { environment } from "../config.js";
import { scheduledJobReliability } from "../jobs/schedule-options.js";

export function operationalNotificationId(
  organizationId: string,
  category: string,
  entityId: string,
  dateKey: string,
): string {
  return createHash("sha256").update(`${organizationId}:${category}:${entityId}:${dateKey}`).digest("hex");
}

interface MonitoringSummary {
  organizations: number;
  examined: number;
  alertsUpserted: number;
  skipped: boolean;
}

const date = (value: unknown): Date | undefined => {
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") return value.toDate();
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.valueOf()) ? undefined : parsed;
  }
  return undefined;
};

export async function runTransferExceptionMonitoring(now = new Date()): Promise<MonitoringSummary> {
  if (!environment.WAREHOUSE_SCHEDULED_FUNCTIONS_ENABLED && environment.APP_ENV !== "emulator")
    return { organizations: 0, examined: 0, alertsUpserted: 0, skipped: true };
  const dateKey = now.toISOString().slice(0, 10);
  const organizations = await db.collection("organizations").orderBy("createdAt").limit(100).get();
  let examined = 0;
  let alertsUpserted = 0;
  for (const organization of organizations.docs) {
    const organizationId = organization.id;
    const [transfers, discrepancies, costs, reservations, requests] = await Promise.all([
      db.collection("transfers").where("organizationId", "==", organizationId).where("status", "in", ["approved", "reserved", "packed", "ready_for_dispatch", "dispatched", "partially_dispatched", "partially_received", "disputed"]).limit(100).get(),
      db.collection("transferDiscrepancies").where("organizationId", "==", organizationId).where("status", "in", ["open", "under_investigation"]).limit(100).get(),
      db.collection("transferCosts").where("organizationId", "==", organizationId).where("status", "in", ["submitted", "approved", "incurred"]).limit(100).get(),
      db.collection("stockReservations").where("organizationId", "==", organizationId).where("status", "in", ["active", "partially_consumed"]).limit(100).get(),
      db.collection("branchRequests").where("organizationId", "==", organizationId).where("status", "in", ["approved", "partially_fulfilled"]).limit(100).get(),
    ]);
    examined += transfers.size + discrepancies.size + costs.size + reservations.size + requests.size;
    const alerts: Array<{ category: string; entityType: string; entityId: string; branchId?: string; warehouseId?: string; roles: string[] }> = [];
    for (const transfer of transfers.docs) {
      const status = String(transfer.get("status"));
      const expectedDispatch = date(transfer.get("expectedDispatchDate"));
      const expectedDelivery = date(transfer.get("expectedDeliveryDate"));
      if (["approved", "reserved", "packed", "ready_for_dispatch"].includes(status) && expectedDispatch && expectedDispatch < now)
        alerts.push({ category: "transfer.ready_not_dispatched", entityType: "transfer", entityId: transfer.id, branchId: transfer.get("destinationBranchId"), warehouseId: transfer.get("originWarehouseId"), roles: ["operations_administrator", "warehouse_manager"] });
      if (["dispatched", "partially_dispatched", "partially_received"].includes(status) && expectedDelivery && expectedDelivery < now)
        alerts.push({ category: "transfer.overdue_receipt", entityType: "transfer", entityId: transfer.id, branchId: transfer.get("destinationBranchId"), warehouseId: transfer.get("originWarehouseId"), roles: ["operations_administrator", "warehouse_manager", "branch_manager"] });
      if (status === "disputed")
        alerts.push({ category: "transfer.reconciliation_anomaly", entityType: "transfer", entityId: transfer.id, branchId: transfer.get("destinationBranchId"), warehouseId: transfer.get("originWarehouseId"), roles: ["operations_administrator", "auditor"] });
    }
    for (const discrepancy of discrepancies.docs)
      alerts.push({ category: "transfer.discrepancy_reminder", entityType: "transferDiscrepancy", entityId: discrepancy.id, roles: ["operations_administrator", "warehouse_manager"] });
    for (const cost of costs.docs)
      alerts.push({ category: cost.get("status") === "submitted" ? "transfer.cost_approval_required" : "transfer.cost_reconciliation_required", entityType: "transferCost", entityId: cost.id, roles: ["finance_officer"] });
    for (const reservation of reservations.docs) {
      const expiresAt = date(reservation.get("expiresAt"));
      if (expiresAt && expiresAt < now)
        alerts.push({ category: "transfer.reservation_expired", entityType: "stockReservation", entityId: reservation.id, warehouseId: reservation.get("warehouseId"), roles: ["operations_administrator", "warehouse_manager"] });
    }
    for (const request of requests.docs) {
      const approvedAt = date(request.get("approvedAt"));
      if (approvedAt && now.getTime() - approvedAt.getTime() > 24 * 60 * 60 * 1000 && Number(request.get("totalTransferredQuantity") ?? 0) === 0)
        alerts.push({ category: "request.approved_not_transferred", entityType: "branchRequest", entityId: request.id, branchId: request.get("branchId"), roles: ["operations_administrator", "warehouse_manager"] });
    }
    if (!alerts.length) continue;
    const batch = db.batch();
    for (const alert of alerts) {
      const id = operationalNotificationId(organizationId, alert.category, alert.entityId, dateKey);
      batch.set(db.doc(`notificationEvents/${id}`), {
        organizationId,
        eventType: alert.category,
        templateKey: alert.category.replaceAll(".", "_") + "_v1",
        entityType: alert.entityType,
        entityId: alert.entityId,
        branchId: alert.branchId ?? null,
        warehouseId: alert.warehouseId ?? null,
        recipientRoles: alert.roles,
        recipientIds: [],
        channelPreferences: {},
        idempotencyKey: `${alert.category}:${alert.entityId}:${dateKey}`,
        status: "pending",
        deliveryStatus: "pending",
        attemptCount: 0,
        lastAttemptedAt: null,
        lastErrorSummary: null,
        nextRetryAt: null,
        deadLetteredAt: null,
        createdAt: now,
        updatedAt: now,
      }, { merge: true });
      alertsUpserted++;
    }
    await batch.commit();
  }
  const summary = { organizations: organizations.size, examined, alertsUpserted, skipped: false };
  logger.info("scheduled_monitoring_completed", summary);
  return summary;
}

export const monitorTransferExceptions = onSchedule(
  { schedule: "every day 08:00", timeZone: "Africa/Lagos", ...scheduledJobReliability },
  async () => { await runTransferExceptionMonitoring(); },
);
