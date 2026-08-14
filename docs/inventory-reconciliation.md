# Inventory reconciliation

`reconcileInventoryBalances` is a read-only, permission-protected callable. It filters by organization, the caller's selected branch or warehouse, and optionally product/location; recomputes quantity and value from immutable entries; compares the balance projection; and compares active serialized-item counts for serial products. Lot-aware balances are matched by lot ID; canonical lot remaining quantity is maintained by the same posting transaction. Quantity-only managers do not receive stored or computed cost values in the response.

Every run creates an `inventoryReconciliations` summary and an immutable audit event containing counts, filters, and up to 100 discrepancy details. It never rewrites data. Repair requires a separately reviewed reversal/repost or a future explicit repair operation.

The callable caps balance and entry reads to prevent unbounded execution. Large organizations should run scoped pages or a future scheduled/partitioned reconciliation. A stored-versus-ledger mismatch is an operational incident: stop related posting, preserve evidence, identify the first divergent transaction, and correct through immutable accounting controls.
