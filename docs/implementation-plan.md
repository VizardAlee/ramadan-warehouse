# Warehouse application implementation plan

## Consolidated client roadmap — 20 September 2026

This roadmap extends the deployed application. It does not replace the current
Firebase architecture, ledgers, audit records, RBAC model, offline POS, or
working operational modules. Schema evolution must be additive and migrated;
legacy warehouse identifiers remain resolvable for historical transactions.

### Dependency sequence

1. **Foundation, locations, RBAC, and responsive UI.** Introduce a canonical
   operational-location read model (`head_office`, `store`, or
   `legacy_warehouse`) over existing branch and warehouse records. Make Head
   Office the default central stock location for new work without rewriting
   history. Complete configurable roles and the 1024x768, 1280x720, and
   1366x768 shared-dialog/form regression matrix.

   Current compatibility slice: selecting an operating location narrows the
   user's branch/legacy-warehouse data scope but no longer removes permissions
   contributed by another assigned role. The context-relevant primary role is
   retained only for legacy labels and audit compatibility.
2. **Sales, POS, payments, reservations, and collection.** Add inline customer
   creation, extensible price levels, arbitrary split tenders linked to company
   accounts, debt aging, correction requests, and the distinct
   paid -> reserved -> awaiting collection -> partially/fully collected flow.
   Preserve offline order capture; physical release remains an online trusted
   mutation.
3. **Inventory, returns, and serial evidence.** Extend the immutable ledger for
   customer reservation/release and partial collection, complete return
   inspection/disposition, and attach human-confirmed serial photographs to
   transaction evidence. Existing posted sales are migrated as already
   collected; they must not be reserved again.
4. **Suppliers and procurement.** Generalize receiving destinations from
   warehouse-only to operational locations, then add supplier advances,
   statements, returns, refunds, credits, and payable reductions through
   balanced inventory/accounting corrections.
5. **Accounting, financial accounts, reconciliation, and tax.** Add manual
   journals with reversal controls, internal account transfers, daily cash
   reconciliation, complete financial statements, and an effective-dated,
   review-gated Nigerian tax-rule engine. No statutory rate is activated
   without authoritative verification and approval.
   Current incremental slice: POS card/bank receipts and supplier/expense
   disbursements select an existing active company bank account; trusted
   posting validates organization ownership, records an account snapshot, and
   uses its configured ledger code in the journal. Existing posted payments
   remain unchanged. Older queued offline POS orders lacking an account retain
   their historical clearing-account fallback during synchronization; new
   online orders require an explicit selection. The Accounting entry point
   links the existing banking and month-close controls with the financial
   and tax views. The Reports screen now exposes
   ledger-derived draft income, balance, cash-flow, and trial-balance views
   with CSV export. The Tax Centre displays posted VAT ledger evidence and a
   rule register, but no unverified statutory rule is auto-activated. Full
   effective-dated tax configuration, filing, manual journals, transfers
   between company financial accounts, and statement sign-off remain open.
6. **Services, aftersales, and simple delivery.** Reuse customer, payment,
   accounting, notification, and evidence components. Service items never
   behave as stocked products; delivery tracks only operational status and the
   split between provider payable and company-retained income.
   Current aftersales slice: store-scoped warranty and non-warranty cases link
   to one existing customer and optionally a sale, product, and serial; staff
   record complaint, diagnosis, service, collection, complimentary/charge
   decision, and partial payments. Payment posts an idempotent balanced journal
   using the selected company account; the case and audit retain immutable
   payment references. This slice does not move inventory or rewrite the
   original sale. Supplier warranty returns, parts consumption, photo
   evidence, service invoicing/receivables, explicit tax treatment, technician
   assignment, notifications, and warranty eligibility rules remain later
   work. A quoted but unpaid aftersales charge is a case balance, not yet a
   posted receivable; revenue is posted when payment is recorded.
7. **Commercial documents, reports, and dashboard.** Add quotation, proforma,
   invoice conversion, A4 waybill, statements, product/location analytics, and
   server-maintained aggregates. Dashboards use real persisted data and do not
   download full collections for browser-side totals.
8. **Budgeting, HR, and final hardening.** Add ledger-backed budget variance and
   a permission-restricted employee domain that may link to, but is distinct
   from, Firebase users. Finish audit coverage, migration verification,
   security tests, operational documentation, and staging acceptance.

### Migration and release gates

- Each phase ships with idempotent migration/backfill tooling, dry-run output,
  count/reconciliation checks, and rollback guidance where reversal is safe.
- Operational records retain links across source transaction, stock event,
  journal, notification, and audit correlation ID.
- Every logical group must pass focused regression tests, full unit tests,
  typecheck, lint, production build, and affected emulator/security suites
  before a targeted staging release.
- The pending three-stage POS web release remains gated on callable reachability
  for `createPosSaleOrder`, `acceptPosSaleOrderPayment`, and
  `confirmPosSaleOrder`; no IAM control is changed without explicit approval.

## Business expansion — Phases 1 through 7 implemented locally

The first POS expansion slice adds centrally controlled base selling prices,
version-aware branch markups, separately stated VAT, branch-scoped cashier
access, device-bound shifts, paid quantity-product checkout, receipts, payment
records, immutable branch inventory issues, COGS, balanced sales journals, and
an IndexedDB/service-worker offline queue. Cash, card, and bank transfer are
recorded payment methods; no external payment-settlement claim is made.
Named active customers can be attached to any sale. Explicit reason-backed
discounts reduce the product subtotal before VAT without changing catalogue
prices, and their header/line allocations remain in invoices, reports, and
audit evidence.

The POS now uses an audited three-stage operational projection: order receipt,
payment acceptance, and payment confirmation/goods release. The first two
stages do not mutate stock or accounting. Final confirmation performs the
existing atomic sale post. Role permissions may be combined on one user, so
the workflow preserves accountability without forcing three separate people.

The location model now treats one designated branch as **Head office / central
distribution**, allowing the same physical site to sell and supply other
stores. New operational setup is store-only: warehouse administration,
assignment, opening-stock, procurement, expense, and transfer choices are no
longer exposed. Legacy warehouse records and their ledger history remain
read-compatible and are never silently deleted or reclassified.

Phase 2 adds reusable customer accounts, administrator-only credit decisions,
live credit-limit enforcement, online credit checkout, an immutable customer
account ledger, Accounts Receivable journals, and customer repayment posting.
Customer creation does not itself grant credit, credit is never represented as
a payment, and repayment never edits the original sale. Checkout may combine a
cash, card, or bank amount received now with the approved customer-account
balance for a part-paid invoice.

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

Phase 5 adds non-inventory operating expenses, inline category creation,
branch/warehouse/organization allocation, separately stated input VAT,
independent approval, accrued-expense journals, and controlled partial or full
disbursements. See `operating-expenses.md` for the workflow and invariants.

Phase 6 adds bank-account masters with masked identifiers, duplicate-safe
statement imports, exact one-to-one statement/journal matching, reversible
open matches, zero-difference period preparation, independent completion, and
immutable closed reconciliation evidence. See `bank-reconciliation.md`.

Phase 7 adds a monthly trial-balance workspace, explicit close-readiness
blockers, race-safe period preparation, independent completion, immutable
evidence snapshots, and a shared effective-date lock across every journal
posting path. See `accounting-period-close.md`.

The sales-document and reporting hardening adds server-authoritative printable
invoices/receipts, historical document reprint, a branch-scoped downloadable
sales register, and downloadable trial-balance evidence. Offline references
remain visibly provisional until the queued sale posts successfully.

The expansion does not yet implement serialized or lot checkout at POS or
complete financial statements. Those remain later finance work. Each source
change must pass the full local and emulator gates before deployment.

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
customer credit, returns, procurement/payables, operating expenses, controlled
disbursements, bank reconciliation, and accounting period close. The next
business finance phase is complete financial reporting based on closed-period
evidence.

Each phase should add emulator tests for its invariants before the next phase begins. Production deployment remains a separate, explicitly approved activity.
