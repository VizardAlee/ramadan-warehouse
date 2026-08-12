# Integration events

Outbound v1 types are `warehouse.transfer.dispatched.v1`, `warehouse.transfer.received.v1`, `warehouse.transfer.partially_received.v1`, `warehouse.transfer.cancelled.v1`, `warehouse.inventory.adjusted.v1`, and `warehouse.product.updated.v1`. Inbound contracts are `branch.inventory.receipt_acknowledged.v1` and `branch.product.mapping.updated.v1`.

Every envelope contains event ID/type, numeric version, schema version, organization, branch, optional warehouse, entity ID, occurred time, correlation ID, idempotency key, and validated payload. Additive compatible changes retain v1; semantic/breaking changes require v2 and parallel consumption.
