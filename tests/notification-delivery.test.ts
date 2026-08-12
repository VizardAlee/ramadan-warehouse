import { describe, expect, it } from "vitest";
import { attemptNotificationDelivery, EmulatorNotificationAdapter, type NotificationEvent } from "../functions/src/notifications/delivery";

const pending = (): NotificationEvent => ({ id: "n1", idempotencyKey: "event:1", status: "pending", eventType: "transfer.delayed", templateKey: "transfer_delayed_v1", recipientIds: ["u1"], recipientRoles: [], attemptCount: 0 });

describe("notification delivery", () => {
  it("delivers once and treats completed events as idempotent", async () => {
    const adapter = new EmulatorNotificationAdapter();
    const first = await attemptNotificationDelivery(pending(), adapter);
    expect(first.patch.status).toBe("delivered");
    const second = await attemptNotificationDelivery({ ...pending(), status: "delivered", attemptCount: 1 }, adapter);
    expect(second.attempted).toBe(false);
    expect(adapter.delivered).toHaveLength(1);
  });

  it("dead-letters rather than retrying indefinitely", async () => {
    const result = await attemptNotificationDelivery({ ...pending(), attemptCount: 4 }, { deliver: async () => ({ delivered: false, retryable: true, errorSummary: "unavailable" }) });
    expect(result.patch.status).toBe("dead_letter");
  });
});
