# Business schema version 1

Version 1 is frozen after Phase 5.1. Correctness fixes and additive indexes/fields require migration notes; broad redesign requires a new schema version.

| Classification | Authoritative collections |
|---|---|
| Configuration/master data | `organizations`, `roles`, `settings`, `users`, `branches`, `warehouses`, `inventoryLocations`, `productCategories`, `products`, `productCosts` |
| Mutable projections | `inventoryBalances`, `serializedItems`, `inventoryLots`, request/transfer header and item current-state fields, counters, delivery projections |
| Immutable inventory/history | `inventoryTransactions`, `inventoryEntries`, `auditLogs`, `branchRequestVersions`, `branchRequestApprovals`, `branchRequestEvents`, `transferVersions`, `transferApprovals`, `transferEvents`, confirmed receipt/package/dispatch item records |
| Inventory workflow | `stockCounts`, `stockCountItems`, `stockAdjustments`, `inventoryReconciliations` |
| Request workflow | `branchRequests`, `branchRequestItems`, `branchRequestComments` plus request history above |
| Transfer workflow | `transfers`, `transferItems`, `stockReservations`, `transferPicks`, `transferPickItems`, `transferPackages`, `transferPackageItems`, `transferDispatches`, `transferDispatchItems`, `transferReceipts`, `transferReceiptItems`, `transferDiscrepancies`, `transferDiscrepancyItems`, `transferCosts` |
| Operational delivery | `notificationEvents`, `integrationOutbox`, operation/idempotency records and monitoring results |

Physical truth is the immutable transaction/entry ledger. Balances, serial current location, lot balances, reservation remainder, and workflow totals are rebuildable projections. Confirmed historical documents are append-only; corrections use new events or reversal/disposition transactions. Every organization-owned record carries `organizationId`, and relationship IDs must remain within that organization.
