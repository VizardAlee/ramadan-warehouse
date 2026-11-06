# Sales voucher, receipt and store release

Status: implemented in the feature candidate; integration validation is incomplete and this workflow is not deployed.

The user approved this workflow on 2026-11-06. Cashier and store officer may be the same person or different people. Each action must independently pass its existing permission and branch checks and record its own actor. Existing approved-credit and part-payment eligibility remains in force. This does not grant any new permissions.

1. Sales creates and can print a sales voucher from the order snapshot. It does not receive money, create debt, issue goods, or imply that goods have been handed over.
2. The cashier accepts and confirms the payment or eligible credit arrangement. The atomic posting issues the receipt, posts the existing financial entries once, and reserves physical goods. A printable pending waybill clearly says that store confirmation is outstanding and is not proof of collection.
3. The authorized store officer confirms the actual quantities and serial identities handed over using the existing collection command. Only that action releases those physical goods. Each partial collection retains its own immutable waybill, actor, quantities and idempotency evidence.

## Existing implementation points

- `confirmPosSaleOrder` now reserves physical goods regardless of the client’s `deferCollection` value. Cashier confirmation checks its own payment permission.
- `commitPosSale` retains the compatibility path with independent sales creation, payment acceptance and payment confirmation permissions. It reserves physical goods, records the combined authorized actor provenance, and preserves historical fingerprint retries. It does not release physical goods.
- `collectReservedSale` already requires `sales.stock.release` and supports partial quantities, serial reservations and accounting. Retain those invariants and cancellation/refund behavior.
- Included service parts are separately issued by `includedIssues`, even when goods are reserved. Preserve their existing service-cost/consumption semantics; do not accidentally reserve or reissue consumed service parts as customer collections.
- Distinguish goods reservations from service fulfillment. A service-only bill must not fabricate goods awaiting collection.
- Existing completed invoices, receipts, collections and actor history are immutable. Do not retrospectively change their posting or ownership.

## Required verification

Test same-person and different-person workflows, each missing permission, selected and unauthorized branches, client attempts to force immediate issue, the direct posting endpoint, offline replay and interrupted confirmations, approved credit and part payment, rejected credit, service-only bills and included parts, partial collections, serial ownership, reservation cancellations, returns and financial balancing. Confirm printing a voucher or pending waybill has no posting side effect. Verify that the pending document is visibly different from a recorded handover waybill.
