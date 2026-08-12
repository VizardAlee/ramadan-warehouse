export interface NotificationEvent {
  id: string;
  idempotencyKey: string;
  status: "pending" | "retry" | "delivered" | "dead_letter";
  eventType: string;
  templateKey: string;
  recipientIds: readonly string[];
  recipientRoles: readonly string[];
  channelPreferences?: Readonly<Record<string, boolean>>;
  attemptCount: number;
  nextRetryAt?: string;
}

export interface DeliveryResult {
  delivered: boolean;
  providerMessageId?: string;
  errorSummary?: string;
  retryable?: boolean;
}

export interface NotificationDeliveryAdapter {
  deliver(event: NotificationEvent): Promise<DeliveryResult>;
}

export class NoopNotificationAdapter implements NotificationDeliveryAdapter {
  async deliver(): Promise<DeliveryResult> {
    return { delivered: true, providerMessageId: "noop" };
  }
}

export class LogNotificationAdapter implements NotificationDeliveryAdapter {
  async deliver(event: NotificationEvent): Promise<DeliveryResult> {
    console.info("notification_delivery", { eventId: event.id, eventType: event.eventType, recipientCount: event.recipientIds.length });
    return { delivered: true, providerMessageId: `log:${event.id}` };
  }
}

export class EmulatorNotificationAdapter implements NotificationDeliveryAdapter {
  readonly delivered: NotificationEvent[] = [];
  async deliver(event: NotificationEvent): Promise<DeliveryResult> {
    this.delivered.push(event);
    return { delivered: true, providerMessageId: `emulator:${event.id}` };
  }
}

export interface NotificationAttempt {
  attempted: boolean;
  patch: Readonly<Record<string, unknown>>;
}

export async function attemptNotificationDelivery(
  event: NotificationEvent,
  adapter: NotificationDeliveryAdapter,
  now = new Date(),
  maxAttempts = 5,
): Promise<NotificationAttempt> {
  if (["delivered", "dead_letter"].includes(event.status)) return { attempted: false, patch: {} };
  if (event.nextRetryAt && new Date(event.nextRetryAt) > now) return { attempted: false, patch: {} };
  const attemptCount = event.attemptCount + 1;
  const result = await adapter.deliver(event);
  if (result.delivered)
    return { attempted: true, patch: { status: "delivered", deliveryStatus: "delivered", attemptCount, lastAttemptedAt: now.toISOString(), deliveredAt: now.toISOString(), providerMessageId: result.providerMessageId ?? null, lastErrorSummary: null } };
  const dead = attemptCount >= maxAttempts || result.retryable === false;
  return {
    attempted: true,
    patch: {
      status: dead ? "dead_letter" : "retry",
      deliveryStatus: dead ? "dead_letter" : "retry_scheduled",
      attemptCount,
      lastAttemptedAt: now.toISOString(),
      lastErrorSummary: (result.errorSummary ?? "Delivery failed").slice(0, 300),
      nextRetryAt: dead ? null : new Date(now.getTime() + Math.min(3600, 2 ** attemptCount * 60) * 1000).toISOString(),
      deadLetteredAt: dead ? now.toISOString() : null,
    },
  };
}
