import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { db } from "../admin.js";
import { environment } from "../config.js";
import { attemptIntegrationDelivery, integrationEventSchema, MockIntegrationAdapter, NoopIntegrationAdapter } from "../integrations/outbox.js";
import { attemptNotificationDelivery, EmulatorNotificationAdapter, LogNotificationAdapter, NoopNotificationAdapter, type NotificationEvent } from "../notifications/delivery.js";

const notificationAdapter = () => environment.NOTIFICATION_ADAPTER_MODE === "log" ? new LogNotificationAdapter() : environment.NOTIFICATION_ADAPTER_MODE === "emulator" ? new EmulatorNotificationAdapter() : new NoopNotificationAdapter();
const integrationAdapter = () => environment.INTEGRATION_ADAPTER_MODE === "mock" ? new MockIntegrationAdapter() : new NoopIntegrationAdapter();

export async function runNotificationDeliveryJob(limit = 100) {
  if (!environment.WAREHOUSE_SCHEDULED_FUNCTIONS_ENABLED && environment.APP_ENV !== "emulator") return { skipped: true, examined: 0, attempted: 0 };
  const snapshots = await db.collection("notificationEvents").where("status", "in", ["pending", "retry"]).limit(limit).get();
  let attempted = 0;
  for (const snapshot of snapshots.docs) {
    const data = snapshot.data();
    const result = await attemptNotificationDelivery({ id: snapshot.id, idempotencyKey: String(data.idempotencyKey), status: data.status, eventType: String(data.eventType), templateKey: String(data.templateKey ?? data.eventType), recipientIds: data.recipientIds ?? [], recipientRoles: data.recipientRoles ?? [], channelPreferences: data.channelPreferences ?? {}, attemptCount: Number(data.attemptCount ?? 0), nextRetryAt: data.nextRetryAt?.toDate?.().toISOString?.() ?? data.nextRetryAt ?? undefined } as NotificationEvent, notificationAdapter());
    if (result.attempted) { await snapshot.ref.update(result.patch); attempted++; }
  }
  const summary = { skipped: false, examined: snapshots.size, attempted };
  logger.info("notification_delivery_job_completed", summary);
  return summary;
}

export async function runIntegrationOutboxJob(limit = 100) {
  if (!environment.WAREHOUSE_SCHEDULED_FUNCTIONS_ENABLED && environment.APP_ENV !== "emulator") return { skipped: true, examined: 0, attempted: 0 };
  const snapshots = await db.collection("integrationOutbox").where("status", "in", ["pending", "retry"]).limit(limit).get();
  let attempted = 0;
  for (const snapshot of snapshots.docs) {
    const parsed = integrationEventSchema.safeParse(snapshot.data());
    if (!parsed.success) { await snapshot.ref.update({ status: "dead_letter", deadLetter: true, lastError: "Schema validation failed" }); continue; }
    const result = await attemptIntegrationDelivery({ ...parsed.data, status: String(snapshot.get("status")), retryCount: Number(snapshot.get("retryCount") ?? 0) }, integrationAdapter());
    if (result.attempted) { await snapshot.ref.update(result.patch); attempted++; }
  }
  const summary = { skipped: false, examined: snapshots.size, attempted };
  logger.info("integration_outbox_job_completed", summary);
  return summary;
}

export const deliverPendingNotifications = onSchedule("every 15 minutes", async () => { await runNotificationDeliveryJob(); });
export const deliverIntegrationOutbox = onSchedule("every 15 minutes", async () => { await runIntegrationOutboxJob(); });
