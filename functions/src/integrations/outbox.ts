import { createHash, randomUUID } from "node:crypto";
import type { Transaction } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { db } from "../admin.js";

export const outboundEventTypes = [
  "warehouse.transfer.dispatched.v1",
  "warehouse.transfer.received.v1",
  "warehouse.transfer.partially_received.v1",
  "warehouse.transfer.cancelled.v1",
  "warehouse.inventory.adjusted.v1",
  "warehouse.product.updated.v1",
] as const;
export const inboundEventTypes = [
  "branch.inventory.receipt_acknowledged.v1",
  "branch.product.mapping.updated.v1",
] as const;

export const integrationEventSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.enum([...outboundEventTypes, ...inboundEventTypes]),
  version: z.literal(1),
  schemaVersion: z.literal("1.0"),
  organizationId: z.string().min(1),
  branchId: z.string().min(1),
  warehouseId: z.string().min(1).optional(),
  entityId: z.string().min(1),
  occurredAt: z.string().datetime(),
  correlationId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});
export type IntegrationEvent = z.infer<typeof integrationEventSchema>;

export interface IntegrationAdapter {
  publish(event: IntegrationEvent): Promise<{ delivered: boolean; error?: string; retryable?: boolean }>;
}
export class NoopIntegrationAdapter implements IntegrationAdapter {
  async publish() { return { delivered: true }; }
}
export class MockIntegrationAdapter implements IntegrationAdapter {
  readonly events: IntegrationEvent[] = [];
  async publish(event: IntegrationEvent) { this.events.push(event); return { delivered: true }; }
}

export function outboxDocumentId(organizationId: string, idempotencyKey: string): string {
  return createHash("sha256").update(`${organizationId}:${idempotencyKey}`).digest("hex");
}

export function createIntegrationEvent(input: Omit<IntegrationEvent, "eventId" | "version" | "schemaVersion"> & { eventId?: string }): IntegrationEvent {
  return integrationEventSchema.parse({ ...input, eventId: input.eventId ?? randomUUID(), version: 1, schemaVersion: "1.0" });
}

export function writeIntegrationOutbox(transaction: Transaction, event: IntegrationEvent): void {
  const reference = db.doc(`integrationOutbox/${outboxDocumentId(event.organizationId, event.idempotencyKey)}`);
  transaction.create(reference, { ...event, status: "pending", retryCount: 0, lastError: null, deadLetter: false, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
}

export async function attemptIntegrationDelivery(event: IntegrationEvent & { status: string; retryCount: number }, adapter: IntegrationAdapter, maxAttempts = 8) {
  if (["delivered", "dead_letter"].includes(event.status)) return { attempted: false, eventId: event.eventId, patch: {} };
  const result = await adapter.publish(event);
  const retryCount = event.retryCount + 1;
  if (result.delivered) return { attempted: true, eventId: event.eventId, patch: { status: "delivered", retryCount, lastError: null } };
  const deadLetter = retryCount >= maxAttempts || result.retryable === false;
  return { attempted: true, eventId: event.eventId, patch: { status: deadLetter ? "dead_letter" : "retry", retryCount, lastError: (result.error ?? "Delivery failed").slice(0, 300), deadLetter } };
}
