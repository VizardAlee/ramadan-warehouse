# Inventory architecture

Phase 2 uses server-authoritative Firestore callables and one posting service. Clients may read only role- and assignment-scoped records and cannot write any ledger, balance, lot, serial, count, reconciliation, or audit record.

## Collections

- `products` and `productCategories` contain organization-scoped catalogue data. Uniqueness locks live in `organizationSkus` and `organizationCodes`.
- `productCosts` separates default cost from broadly readable product fields.
- `inventoryTransactions` is the immutable event header.
- Top-level `inventoryEntries` is the immutable, queryable journal. Top-level entries were chosen instead of subcollections so SKU, location, serial, and reporting queries do not require collection-group scans.
- `inventoryBalances` is a disposable fast-read projection keyed by organization, product, location, and optional lot.
- `serializedItems` stores the current serial lifecycle projection; journal entries retain history.
- `inventoryLots` stores a canonical organization/product/normalized-lot record and per-location quantities.
- `stockCounts`, `stockCountItems`, and `inventoryReconciliations` support controls and diagnostics.

All mutations go through `functions/src/inventory/post-inventory-transaction.ts`, except reversal, which has a dedicated inverse-posting transaction because it must replay already posted immutable entries exactly.

## Security boundary

Organization, role, assignments, status, product state, locations, balances, costs, and counters are loaded from trusted server records. App Check is enforced outside the emulator. Warehouse and branch location ownership is checked on every post. Unowned organization-wide virtual locations require system-administrator authority. Cross-warehouse and warehouse-to-branch movement is rejected until the formal transfer module.

## Atomicity and concurrency

The posting transaction reads the idempotency record, product/cost, counter, all locations, balances, lot, and serial records before writing. Firestore retries conflicting transactions. Consequently, two deductions cannot both consume the same available quantity. Header, entries, balance projections, asset projections, uniqueness state, and audit event commit together.

## Trusted linked-posting extension (8 October 2026)

`postInventoryTransaction` accepts an optional third, server-only argument for
business workflows that must commit financial consequences with stock. Existing
callers omit it and retain their behavior. It is not a callable input or a new
permission. No client may supply callbacks or ledger-calculated values.

- `prepare` receives only transaction read methods. It runs after core stock
  validation/calculation and before writes, on each Firestore retry.
- `apply` is synchronous and receives only create/set/update methods. It cannot
  perform transaction reads. Its writes share the stock transaction; a failure
  rolls back headers, entries, balances, linked writes, counter and idempotency
  state together.
- Both callbacks receive the actual ledger movement value/cost, original posting
  reference, effective date, product and source/destination scope. Financial
  workflows must not substitute client prices for these costs.
- A committed idempotency replay skips both callbacks and returns the original
  stock reference, including when another request wins a concurrent race.
- Callbacks must not send notifications, make external payments or perform other
  non-transactional side effects: Firestore may rerun them. Persist outbox work in
  the same transaction instead.
- The calling workflow must enforce organization/location permissions, original
  document eligibility, period locks, balanced journals, tax snapshots and its own
  business limits. This extension does not provide those controls automatically.
- One invocation still posts one product/lot. Looping invocations is not an atomic
  multi-line return or journal. There is no supplier goods-return UI yet.

## Known limits

- Reservation quantities remain zero until the transfer phase.
- Generic inventory receipts remain non-procurement adjustments. The dedicated
  purchase-order receipt workflow now posts through the same inventory service
  while preserving PO, received-quantity, invoice-match, and AP evidence.
- CSV import is deferred; CSV report export is implemented.
- A stock count may post one idempotent correction transaction per variance item. This is resumable but is not one all-items atomic commit.
- Reporting endpoints are paginated and deliberately capped; high-volume maintained aggregates remain future work.
