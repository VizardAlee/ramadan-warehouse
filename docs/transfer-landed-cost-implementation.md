# Transfer landed cost: implementation checkpoint (2026-11-12)

## Release status

**Not deployed, not connected to the receipt action.** The only implementation at
this checkpoint is a pure allocation/cost-basis module and its unit tests. Do not
represent this branch as a working landed-cost feature. Existing transactions and
company/branch reports are unchanged. No live stock or payment tests were made.

## Approved business requirement

Receiving-branch managerial cost is agreed transfer value plus allocated external
transport. Company consolidated inventory remains original carrying cost plus
qualifying external transport; internal markup must not become company cost.
Default transport allocation is proportional to agreed line values, with explicit
manual override summing exactly to the total. Capture payer, payee and external
reference. Recording this cost must not initiate a payment. Future receipts only;
no silent historical rewrite.

## Why receipt fields alone are unsafe

There is currently only one valuation path. `inventoryBalances.totalValueMinor`
and serial `currentUnitCostMinor` feed both branch and consolidated COGS.
`financial-reports.ts` aggregates the same journalLines for both scopes. Replacing
that value with the transfer price would capitalise internal profit. Merely adding
another display field without propagating it through sales/returns would leave
branch reports wrong after the first movement.

## Required end-to-end integration

1. Add a versioned immutable transport plan to a newly priced transfer. Store
   integer minor-unit total, exact per-line allocation, allocation method, payer
   branch, transporter/payee, external invoice/reference and qualifying-cost
   evidence. Only the existing authorized pricing capability may write it; use
   expected version, organization/branch authorization and idempotency fingerprint.
   Redact these fields wherever internal prices are redacted, including audit detail.
2. Freeze approved allocation quantities and line values at source confirmation.
   Repricing or editing after the first receipt is forbidden in initial release.
   New freight or refunds after receipt require a distinct adjustment workflow;
   display an explicit administrator-review block, never silently overwrite.
3. On each receipt, atomically allocate only its cumulative share of each fixed
   line allocation. Good and damaged units both consume their allocated external
   freight; later commercial damage waivers must not undo external freight.
   Cancelled/lost/rejected quantities leave an explicit unallocated amount requiring
   review, not an automatic charge to unrelated good units.
4. Store both company value and branch-management value in balances, movements,
   per-serial records, receipt evidence, return evidence and sale-item evidence.
   Legacy documents without management fields fall back to company value. Do not
   recalculate old sales. Read/validate every relevant document before writes.
5. Company journals capitalise external freight using a dedicated clearing/AP
   reference, not an unbalanced inventory write. Source-paid recharge goes into
   destination supplier liability only once; destination-paid freight stays out
   of that supplier invoice. Link subsequent expense/payment recording to the
   same immutable reference to prevent duplicate cost, liability or cash entries.
6. Preserve company-cost journal COGS. Add an explicitly labelled branch management
   view using parallel management COGS. Do not change statutory/company P&L into
   internal-branch management reporting without labelling the basis.
7. Retain immutable original issue costs for partial sales returns, supplier
   returns, exchanges, damage/restock/scrap. A stock return does not imply a freight
   refund. Reject unsupported adjustments before mutation and explain review.

## Exact integration touchpoints

- `callable/stock-transfers.ts`: input schema, pricing, redaction, approval freeze,
  receipt transaction, serial costs and inventory evidence.
- `branch-trading/receipt.ts`, `model.ts`, `payments.ts`, `returns.ts`,
  `damage-review.ts`: commercial liabilities and immutable original cost evidence.
- `inventory/post-inventory-transaction.ts`, `reverse-inventory-posting.ts`:
  generic receipt/issue/transfer/lot/serial/adjustment/reversal paths.
- `billing/stock.ts`, `callable/sales.ts`, `sales/collection.ts`: immediate POS and
  reserved goods collection cost consumption and sale/collection evidence.
- `callable/sales-returns.ts`, `sales/return-disposition.ts`: original cost reversal,
  quarantine, supplier replacement, restock and scrap.
- `callable/financial-reports.ts`, `reports/product-margins.ts`: explicit management
  margin reporting without changing consolidated journal basis.
- `features/branch-trading/transfer-trading.tsx`, transfer receipt UI and privacy
  wrappers: price, transport payer/reference, allocation preview and receiving cost.
- Rules, exports and reconciliation: new fields/collections must not expose cost
  to warehouse staff lacking financial permissions.

## Tests completed at checkpoint

`tests/transfer-landed-cost.test.ts`: 14 passing unit cases, including exhaustive
small amount/quantity combinations. Covers integer rounding conservation,
deterministic largest remainder, manual override validation, cumulative partial
receipt allocation, fractional quantity ticks, large safe-integer arithmetic,
source vs destination freight payer and separate company/branch cost bases.
These tests do **not** establish transactional integration or release readiness.

## Mandatory release gates still pending

- Emulator integration: retries/concurrent partial receipts, stale versions,
  cross-organization access, unauthorized cost reads/writes, closed periods.
- Quantity/serial/lot workflows; mixing existing and newly landed stock; downstream
  transfer; partial and final sale/collection/return; damage/cancellation/reversal.
- Reconcile inventory, company journals, branch management values, internal supplier
  liability and freight clearing to exact integer totals.
- Full production predeploy and exact-commit CI; read-only live rollout checks.
- Never deploy a partial valuation path or test with real stock/payment mutations.
