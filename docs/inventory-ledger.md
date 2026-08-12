# Immutable inventory ledger

Each event creates one `inventoryTransactions` header and double-sided `inventoryEntries`. Internal movements debit the source location and credit the destination in one Firestore transaction. External receipts debit an external logical account and credit a location. External issues and corrections do the inverse. Quantity and value deltas across every transaction therefore sum to zero.

Transaction numbers use an organization counter in the format `INV-YYYY-000001`. The counter is read and incremented in the same Firestore transaction, making numbers collision-safe under concurrency. The effective date supplies the year; it does not supply uniqueness.

Each location entry records product/SKU, location and counterparty, quantity and value deltas, unit cost, before/after quantity, effective time, actor, reason, and optional lot/serial. The header retains reference and correlation metadata. Entries are top-level to make paginated reporting practical.

## Posting invariants

- Quantity is a positive safe integer; money is integer NGN minor units.
- Negative available balances are denied.
- Internal movement preserves organization quantity and exact carried value.
- Serial count equals movement quantity and every serial is unique organization-wide.
- Batch products require a deterministic product-scoped lot.
- Idempotency keys cannot post the same request twice.
- Products with history cannot change tracking type.
- Clients cannot create, edit, or delete headers, entries, or balances.

## Reversal

A reversal creates a new header and opposite entries; it never edits the original. A transaction-level lock prevents a second reversal. Every affected balance and serial must still identify the original as its latest transaction, otherwise the reversal is rejected as dependent history. The reversed transaction remains `posted`; reversal linkage is represented by the new header and lock so immutable history is preserved.

Opening stock uses the same posting path and may be disabled with `organizations/{id}.openingStockEnabled = false`. Cross-warehouse and warehouse-to-branch workflows are intentionally rejected in Phase 2.
