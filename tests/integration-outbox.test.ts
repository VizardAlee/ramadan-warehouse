import { describe, expect, it } from "vitest";
import { attemptIntegrationDelivery, createIntegrationEvent, MockIntegrationAdapter, outboxDocumentId } from "../functions/src/integrations/outbox";

const event = () => createIntegrationEvent({ eventType: "warehouse.transfer.dispatched.v1", organizationId: "org", branchId: "branch", warehouseId: "warehouse", entityId: "t1", occurredAt: new Date().toISOString(), correlationId: "cid", idempotencyKey: "dispatch:t1:d1", payload: { quantity: 2 } });

describe("integration outbox", () => {
  it("uses a stable document identity to prevent duplicate events", () => {
    expect(outboxDocumentId("org", "key")).toBe(outboxDocumentId("org", "key"));
    expect(outboxDocumentId("org", "key")).not.toBe(outboxDocumentId("org", "other"));
  });

  it("preserves event identity across retries", async () => {
    const original = event();
    const result = await attemptIntegrationDelivery({ ...original, status: "retry", retryCount: 2 }, { publish: async () => ({ delivered: false, retryable: true, error: "down" }) });
    expect(result.eventId).toBe(original.eventId);
    expect(result.patch.retryCount).toBe(3);
  });

  it("does not redeliver a completed event", async () => {
    const adapter = new MockIntegrationAdapter();
    const result = await attemptIntegrationDelivery({ ...event(), status: "delivered", retryCount: 1 }, adapter);
    expect(result.attempted).toBe(false);
    expect(adapter.events).toHaveLength(0);
  });
});
