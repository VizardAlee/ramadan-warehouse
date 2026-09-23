import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import webpush from "web-push";
import { db } from "../admin.js";
import { requireAccess } from "../auth/authorize.js";
import { enforceAppCheck, webPushSecrets, webPushVapidSecret } from "../config.js";
import { parseInput } from "../utils/callable.js";

function publicPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      !isIP(host) && host.includes(".") && !["localhost", ".local", ".internal", ".test", ".example", ".invalid"].some((suffix) => host === suffix || host.endsWith(suffix));
  } catch { return false; }
}
const subscriptionSchema = z.object({
  endpoint: z.url().max(2048).refine(publicPushEndpoint, "A public HTTPS push-service endpoint is required."),
  keys: z.object({ p256dh: z.string().min(40).max(256), auth: z.string().min(8).max(256) }),
});
const removeSchema = z.object({ endpoint: z.url().max(2048).refine(publicPushEndpoint) });
const subscriptionId = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex");

export function readWebPushConfig(): { publicKey: string; privateKey: string; subject: string } | null {
  const raw = process.env.FUNCTIONS_EMULATOR === "true"
    ? process.env.WAREHOUSE_WEB_PUSH_VAPID
    : webPushVapidSecret.value();
  if (!raw) return null;
  try {
    const parsed = z.object({ publicKey: z.string().min(40), privateKey: z.string().min(40), subject: z.string().startsWith("mailto:") }).parse(JSON.parse(raw));
    return parsed;
  } catch {
    logger.error("web_push_configuration_invalid");
    return null;
  }
}

export const getWebPushPublicKey = onCall({ enforceAppCheck, secrets: webPushSecrets }, async (request) => {
  await requireAccess(request);
  return { publicKey: readWebPushConfig()?.publicKey ?? null };
});

export const saveWebPushSubscription = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request);
  const input = parseInput(subscriptionSchema, request.data);
  const id = subscriptionId(input.endpoint);
  await db.doc(`users/${actor.userId}/pushSubscriptions/${id}`).set({
    organizationId: actor.organizationId,
    userId: actor.userId,
    endpoint: input.endpoint,
    keys: input.keys,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { registered: true };
});

export const removeWebPushSubscription = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request);
  const input = parseInput(removeSchema, request.data);
  await db.doc(`users/${actor.userId}/pushSubscriptions/${subscriptionId(input.endpoint)}`).delete();
  return { removed: true };
});

// The inbox is authoritative. A separate delivery queue prevents a push-service outage
// from delaying the task card or re-running the business operation.
export const queueNotificationPush = onDocumentWritten("users/{userId}/notifications/{notificationId}", async (event) => {
  const after = event.data?.after;
  if (!after?.exists) return;
  const data = after.data();
  if (!data) return;
  if (!data.actionRequired || !data.eventId || data.eventId === event.data?.before.data()?.eventId) return;
  const userId = event.params.userId;
  const user = await db.doc(`users/${userId}`).get();
  if (!user.exists || user.get("status") !== "active" || user.get("authDisabled") === true || user.get("organizationId") !== data.organizationId) return;
  const subscriptions = await db.collection(`users/${userId}/pushSubscriptions`).limit(20).get();
  if (subscriptions.empty) return;
  for (const subscription of subscriptions.docs) {
    const deliveryId = createHash("sha256").update(`${data.eventId}:${userId}:${subscription.id}`).digest("hex");
    const ref = db.doc(`pushDeliveries/${deliveryId}`);
    await db.runTransaction(async (transaction) => {
      if ((await transaction.get(ref)).exists) return;
      transaction.create(ref, {
        organizationId: data.organizationId,
        userId,
        subscriptionId: subscription.id,
        notificationId: event.params.notificationId,
        eventId: data.eventId,
        status: "pending",
        attemptCount: 0,
        createdAt: FieldValue.serverTimestamp(),
      });
    });
  }
});

export async function deliverPendingWebPush(limit = 100): Promise<number> {
  const config = readWebPushConfig();
  if (!config) return 0;
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  const pending = await db.collection("pushDeliveries").where("status", "in", ["pending", "retry"]).orderBy("createdAt", "asc").limit(limit).get();
  let attempted = 0;
  for (const record of pending.docs) {
    const data = record.data();
    const [user, notification, subscription] = await Promise.all([
      db.doc(`users/${data.userId}`).get(),
      db.doc(`users/${data.userId}/notifications/${data.notificationId}`).get(),
      db.doc(`users/${data.userId}/pushSubscriptions/${data.subscriptionId}`).get(),
    ]);
    if (!user.exists || user.get("status") !== "active" || user.get("authDisabled") === true || user.get("organizationId") !== data.organizationId || !notification.exists || notification.get("eventId") !== data.eventId || !notification.get("actionRequired") || notification.get("readAt") != null || !subscription.exists || subscription.get("organizationId") !== data.organizationId) {
      await record.ref.update({ status: "cancelled", updatedAt: FieldValue.serverTimestamp() });
      continue;
    }
    attempted++;
    try {
      await webpush.sendNotification({ endpoint: String(subscription.get("endpoint")), keys: subscription.get("keys") as { p256dh: string; auth: string } }, JSON.stringify({ title: notification.get("title"), body: notification.get("body"), href: notification.get("href"), tag: data.eventId }), { TTL: 3600 });
      await record.ref.update({ status: "sent", attemptCount: FieldValue.increment(1), sentAt: FieldValue.serverTimestamp() });
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await subscription.ref.delete();
      const retry = status !== 404 && status !== 410 && Number(data.attemptCount ?? 0) < 4;
      await record.ref.update({ status: retry ? "retry" : "failed", attemptCount: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() });
      logger.warn("web_push_delivery_failed", { deliveryId: record.id, statusCode: status ?? null, retry });
    }
  }
  return attempted;
}
