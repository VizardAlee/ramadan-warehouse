# Warehouse application implementation plan

## Business expansion — Phases 1 through 4 implemented locally

The first POS expansion slice adds centrally controlled base selling prices,
version-aware branch markups, separately stated VAT, branch-scoped cashier
access, device-bound shifts, paid quantity-product checkout, receipts, payment
records, immutable branch inventory issues, COGS, balanced sales journals, and
an IndexedDB/service-worker offline queue. Cash, card, and bank transfer are
recorded payment methods; no external payment-settlement claim is made.

Phase 2 adds reusable customer accounts, administrator-only credit decisions,
live credit-limit enforcement, online credit checkout, an immutable customer
account ledger, Accounts Receivable journals, and customer repayment posting.
Customer creation does not itself grant credit, credit is never represented as
a payment, and repayment never edits the original sale.

Phase 3 adds receipt-linked return requests, independent maker-checker
approval, quantity caps against the unreturned receipt quantity, controlled
restocking at original cost, non-restockable damage handling, cash/card/bank
refund evidence, customer-receivable credits, and exchange credit that may be
redeemed on a later online POS sale. Approval posts the correcting inventory,
accounting, customer, and audit evidence atomically without altering the sale.

Phase 4 adds supplier master data, warehouse purchase orders, independent PO
approval, controlled goods receipt into the immutable inventory ledger,
received-quantity invoice matching, independent supplier-invoice approval,
Accounts Payable journals, a supplier subledger, and allocated supplier
payments. See `procurement-and-payables.md` for its workflow and invariants.

The expansion does not yet implement serialized or lot checkout at POS,
operating-expense bills, bank reconciliation, period closing, or complete
financial statements. Those remain later finance phases. The new source must
pass its full local and emulator gates before any production deployment; the
current production environment continues to run the validated 98-function
inventory/transfer release until that separate approval.

## Warehouse transfer programme — implemented locally

Warehouse transfers cover request/direct initiation, versioned approval, atomic reservation/release, serial/lot allocation, picker/checker, packages, dispatch to route transit, partial receipt, request fulfilment, discrepancies, costs, cancellation, closure, reports, notifications, rules, indexes, UI, tests, and emulator seed data. Deployment, production configuration, binary evidence, paid notifications, advanced policy UI, and existing branch-app integration remain deferred.

## Phase 1 — Foundation

1. Establish strict TypeScript Next.js and Cloud Functions projects.
2. Configure Firebase clients, Admin SDK, Emulator Suite, and environment validation.
3. Define user, organization, branch, warehouse, location, role, permission, and audit models with Zod validation.
4. Add authenticated app shell, role-aware navigation, login and foundation administration views.
5. Add server-side identity/authorization helpers, append-only audit writing, baseline callable context endpoint, and an integration contract.
6. Add deny-by-default Firestore and Storage rules plus unit and emulator rule tests.
7. Validate lint, type checking, tests, production build, and Firestore emulator tests.
8. Add one-time bootstrap, trusted user provisioning, assignment controls, claims refresh, administrative master-data workflows, and emulator-only seed tooling.

Phase 1 code is complete for local validation. Production Firebase creation, Auth/App Check configuration, bootstrap-secret configuration, email action handling, monitoring, backup policy, and an approved production bootstrap run remain operational prerequisites.

## Phase 2 — Product catalogue and immutable inventory ledger

Implemented locally: organization-unique products/categories, separated costs, quantity/batch/serial projections, double-sided immutable entries, transactional balances and numbering, opening stock, receipts, internal same-warehouse movements, privileged adjustments, safe reversals, blind maker-checker counts, reconciliation, SKU history, six reports, CSV export, rules/indexes, representative seed data, and calculation/rules/callable/concurrency tests.

Deferred Phase 2 hardening includes CSV import, large-value adjustment drafts/approval, all requested compound report filters, scheduled partitioned reconciliation, and maintained reporting aggregates. These do not weaken the central ledger invariants.

## Phase 3 — Branch material requests and approvals

Implemented locally: organization/branch-scoped drafts, server numbering, trusted product snapshots, submission versions, review, changes requested, resubmission, full/partial/rejected decisions, separation of duties, cancellation, closure, comments, availability and cost filtering, request reports/CSV export, internal notification events, rules/indexes, representative seed records, and unit/rules/callable/concurrency coverage. Requests do not reserve or mutate inventory.

Deferred Phase 3 hardening includes binary attachments, delivery adapters for notifications, configurable multi-stage/high-value policy execution, maintained reporting aggregates, and full cross-dimensional report filtering.

## Later phases

- Phase 4: transfers, server-validated state machine, reservation concurrency, and release.
- Phase 5: picking, maker-checker packing, dispatch, and goods in transit.
- Phase 6: receipts, discrepancies, reversals, and closure controls.
- Phase 7: finance approval expansion, period locking, and accounting integration.
- Phase 8: maintained reporting summaries, exports, versioned integration adapters, monitoring, and operational hardening.

The numbered list above describes the original warehouse-transfer programme.
The later business expansion uses its own POS/finance phase numbering: POS,
customer credit, returns, then procurement and payables. The next business
finance phase is operating expenses and cash-disbursement control, followed by
bank reconciliation, period close, and complete financial reporting.

Each phase should add emulator tests for its invariants before the next phase begins. Production deployment remains a separate, explicitly approved activity.
