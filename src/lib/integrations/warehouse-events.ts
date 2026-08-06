export const warehouseEventTypes = [
  "transfer.dispatched",
  "transfer.received",
  "transfer.partially_received",
  "transfer.cancelled",
  "inventory.adjusted",
] as const;

export type WarehouseEventType = (typeof warehouseEventTypes)[number];

export interface WarehouseIntegrationEvent<TPayload extends Readonly<Record<string, unknown>>> {
  readonly id: string;
  readonly version: 1;
  readonly type: WarehouseEventType;
  readonly organizationId: string;
  readonly occurredAt: string;
  readonly idempotencyKey: string;
  readonly payload: TPayload;
}

export interface WarehouseIntegrationAdapter {
  publish<TPayload extends Readonly<Record<string, unknown>>>(event: WarehouseIntegrationEvent<TPayload>): Promise<void>;
}

export class NoopWarehouseIntegrationAdapter implements WarehouseIntegrationAdapter {
  async publish<TPayload extends Readonly<Record<string, unknown>>>(event: WarehouseIntegrationEvent<TPayload>): Promise<void> {
    void event;
    return Promise.resolve();
  }
}
