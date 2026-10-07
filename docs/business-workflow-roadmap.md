# Business workflow expansion (24 September 2026 baseline)

This roadmap extends the existing Firebase application and preserves historical users, stock entries, sales, journals and audit records. A requested capability is not marked complete merely because a screen or a partial workflow exists.

| Request | Current implementation | Remaining work |
| --- | --- | --- |
| Daily physical stock and cash reconciliation | Stock counts, inventory-ledger reconciliation, POS opening/closing cash variance and bank reconciliation exist; a dated store daily close now records cash ledger evidence, physical counted cash, exceptions, retained revisions and audited sign-off | Bank reconciliation remains a separate control; company-wide cash must have a store allocation before inclusion in a store close |
| Administrator-managed roles | Organization-specific role creation/editing, multiple role assignment, permission versioning and effective union authorization exist | Regression coverage for newly introduced permissions and deactivation across all modules |
| User disable/delete | Administrators can make accounts inactive or suspended; Auth is disabled and sessions are revoked; Users now has a direct Disable action | Do not hard-delete users with historical activity. Add archival/anonymization only with an explicit retention policy |
| Purchase order to payment | Draft/submitted/approved PO, goods receiving, supplier invoice approval, and supplier payment with audit and journals | Supplier advances, credit balances, remittance allocation, richer GRN printout and statement |
| Logistics and outsourced services | Transfer costs and aftersales charges/payments exist | External provider payables, service-item costing, payment accounts, balanced journals and provider statements |
| Retail and wholesale prices | Central base price and store override with version checks | Effective-dated price tiers, POS tier selection, authorization, offline snapshot and audit of manual overrides |
| Product stock ledger/history | Immutable inventory entries and paginated product movement history exist | Human-readable running balance across reservations, collection and all future transaction types |
| Customer account arrangements | Customer identity, credit decisions, payments and account entries exist | Multiple named arrangements/subaccounts per customer with allocation and consolidated statements |
| Financial statements | Ledger-derived balance sheet, income statement, cash-flow statement and trial balance with CSV export exist | Opening-balance/COA review, complete transaction classifications and accountant sign-off before external use |
| Waybill, quotation and proforma | Official sale invoice/receipt printing and transfer waybill reference exist | Issued and versioned quotation/proforma conversion, physical-release-linked A4 waybill and reprint controls |
| Returns/exchanges | Partial returns, refunds, customer-account and exchange credit exist | Linked replacement sale with automatic difference settlement either direction, inventory disposition and balanced posting |

## Dependency sequence

Paid-but-uncollected stock, partial collection and reservation cancellation are implemented. Financial reports page full ledger history. The current expansion first adds store daily-close evidence and index-backed dashboard aggregates, then proceeds through the eight workstreams below. Completion of one group does not imply completion of all eight.

1. Daily-close evidence and organization-specific role/permission model, with server-authoritative authorization and safe migration.
2. Retail/wholesale price tiers and customer subaccounts, preserving offline POS and existing credit balances.
3. Supplier advances, logistics/service payables, and complete cash/bank posting.
4. Return-for-replacement settlement, collection and stock disposition.
5. Versioned quotations/proformas, physical-release waybills, and final statement/report sign-off.

Each vertical slice needs rules/index review, idempotent trusted mutations, audit events, emulator tests, typecheck, lint, production build and a verified staging rollout. No historical ledger or issued document is edited in place.

## Eight-workstream completion programme — 7 October 2026

The client authorized all eight groups. Continue the existing modules in this dependency order; do not create parallel customer, supplier, role, ledger or notification systems.

| Group | Implementation checkpoint | Next acceptance criteria |
| --- | --- | --- |
| 1. Daily reconciliation | Implemented, validated and deployed | Nigerian business date, all store-allocated cash journals, counted cash/variance, stock/shift exceptions, retained revisions, separate prepare/sign permissions, same authorized manager allowed, stale evidence rejected, historical sign-off preserved; signed-in live acceptance remains separate |
| 2. Sales and customers | Pending next slice | Effective-dated retail/wholesale tiers and offline snapshots; named customer arrangements/payment allocation; correction request and reversal workflow; debt aging/reminders |
| 3. Inventory and returns | Partial: reservation/partial collection/cancellation already implemented | Serial evidence at collection; uncollected reminders; inspected return disposition; linked replacement sale and difference settlement in either direction |
| 4. Suppliers | Existing PO/GRN/invoice/payment workflow retained | Supplier advances, credit balances, allocation/statements and supplier returns with stock/journal linkage |
| 5. Accounting and tax | Draft statements/full-history paging implemented | Authorized manual/reversal journals, internal funds transfer, statement classifications/opening balances and accountant sign-off; reviewed versioned Nigerian tax rules, liabilities and payments. Do not activate invented statutory rates |
| 6. Services and logistics | Existing aftersales charges/payments retained | Non-stock service costing, technician/parts integration, outsourced provider payables and correct delivery fee/provider liability/retained income split |
| 7. Documents and dashboard | Server dashboard sums/counts validated and deployed; documents expansion remains pending | Issued/versioned quotation → proforma → invoice conversion, collection-linked A4 waybills; further profit/aging/product metrics and large-report jobs |
| 8. Budgeting and hardening | HR employee/compensation/attendance connector foundations exist | Budget-versus-actual, HR workflow/payroll expansion, real-device attendance acceptance, cross-role/offline/security regression and release verification |

### First dependency group: store close and bounded dashboard

`getDailyCloseWorkspace`, `prepareDailyClose` and `signDailyClose` reuse the existing journal lines, stock counts, shifts, branch scope and audit system. Cash is account 1010 for the selected store, including non-POS postings. Opening cash is derived from older journal lines, not an editable balance. Store-less/company-wide cash is deliberately excluded. Dates use Africa/Lagos boundaries. Every source page is read within a Firestore transaction snapshot. No business ledger is rewritten.

Cash differences and outstanding stock/till checks require explanations; they do not silently post adjustments. Direct built-in branch managers, operations administrators and finance officers gain scoped daily-close permissions additively. Custom roles gain only permissions explicitly assigned by their administrator. Signed evidence is retained in revision/sign-off records. Later/backdated postings are flagged and require a new revision. Daily close is evidence, not a period lock; bank reconciliation remains separate.

`getDashboardWorkspace` uses index-backed Firestore counts/sums, returning a fixed-size summary and seven trend points rather than complete sales, product, request and transfer registers. Both historical and simple transfers are counted, with an OR scope preventing double-counting a transfer whose source and destination are the same store. Unauthorized sections return unavailable values rather than fake zeros. Sales show invoiced value and payment position at checkout, not current receivables or net sales after later returns. Real data only; no backfill or fabricated production records. Materialized rollups remain an optional later optimization, not a prerequisite for correctness.

No migration rewrites existing documents. New daily-close collections are callable-only and deny direct client reads/writes; new indexes support the scoped aggregate/evidence queries. Newly introduced callable transport access must be verified at release; prior approvals for other services do not authorize new Cloud Run IAM changes.

Validation checkpoint: 228 unit/UI tests, 25 sales/administration/accounting callable emulator tests and 25 Firestore security tests passed. Typecheck, lint, Functions compilation, production build, index validation, secret scanning and diff checks passed. Production release and authenticated live acceptance remain separate checkpoints; the other workstreams above are not marked complete by this first group.

Initial release attempt (7 October 2026, source `5c40b37`): Firestore rules released and 19 new indexes accepted (at that checkpoint: 123 READY, 19 CREATING). Existing `createOrganizationUser`, `updateOrganizationUser`, `saveOrganizationRole` and `getAssignableRolePermissions` updates succeeded. Firebase could not set Cloud Run invoker IAM policy for new `getDailyCloseWorkspace`, `prepareDailyClose`, `signDailyClose` and `getDashboardWorkspace`; deployment exited with errors for those four services. No IAM checks were disabled in that attempt. App Hosting was held pending explicit transport approval and index readiness.

Completed release (7 October 2026): the owner explicitly approved disabling Cloud Run invoker IAM checks for those four new services only. The scoped changes succeeded; all four services report ready, production mode and App Check enabled, and each unauthenticated callable probe returns Firebase JSON HTTP 401 `UNAUTHENTICATED`. No other service IAM configuration was changed. All 142 indexes are READY. App Hosting build/rollout `build-2026-10-07-001` is READY/SUCCEEDED, with 100% production traffic and reconciliation complete. The web source checkpoint is `488cffd` (implementation `5c40b37`). Signed-in live mutations were not exercised; the 25 callable emulator tests and 25 security tests remain the workflow/authorization evidence. No real business data was modified during release verification. Remaining workstreams are still pending/partial as shown above.

## Financial history scalability — 6 October 2026

Financial statements and Tax Centre now aggregate stable 500-line server-side
pages, with account totals retained rather than whole ledgers. Cash-flow journal
metadata is fetched in batches of at most 100; all configured company accounts
are included. The previous 10,000-line, 1,000-journal and 100-account cutoffs are
removed. Missing or out-of-scope cash journals block issuance rather than silently
inventing a classification. Existing organization/store scope and accounting
classifications remain unchanged. Reports are still ledger-derived drafts;
accountant review, statutory tax-rule approval and cash-flow classification
hardening remain outstanding. Server paging fixes truncation, but materialized
dashboard aggregates and very-large-ledger report jobs remain later work.

Validation for this group: 225 unit/UI tests, 43 sales/aftersales/financial/security
emulator tests, plus focused reruns for cancellation rounding and large-ledger
aggregation. Typecheck, lint, production build and secret scanning passed. No
historical warehouse data, posted journals or statutory tax rates were rewritten.

## Customer register and history — October 2026

The customer register uses bounded, organization-scoped Firestore cursor queries,
25/50/100 rows, field-specific prefix search, desktop tables and compact-screen
cards. Inline history shows five recent activities and links to the full history
page. The existing history callable now pages sales, returns and account entries
together without downloading the complete account history or rewriting records.

Customer repayments and bank/card sale refunds now use the existing active
company bank-account resolver, preserve account snapshots and journal links,
and audit the selected ledger account. Earlier unapproved refunds require an
account at approval; historical posted clearing-account journals are not moved.
Cash remains on cash-on-hand, with cash refunds tied to an open POS till.

## Paid goods and physical collection — 6 October 2026

Payment confirmation now offers immediate collection or reservation for later.
For later collection, physical quantity/value remain unchanged; reserved stock
increases and available stock decreases. Revenue/payment posting happens at
confirmation; inventory cost and cost of goods sold post when goods leave.
The POS collection queue is store-scoped and cursor-paginated (25/50/100).
Partial collections create append-only release evidence, paired stock entries,
balanced cost journals, and audit events atomically, with retry idempotency.
Returns cannot exceed physically collected quantities.

Additive schema: new sales/items contain collection tracking fields; historical
sales without them retain their existing already-issued interpretation. No old
ledger records are rewritten. Built-in managers/admins receive stock-release
permission; administrators explicitly assign it to custom roles as needed.
Existing immediate/offline checkout remains immediate issue. Deferred collection
requires online confirmation and supports the current quantity-based POS items.
Reservation cancellation/refund before collection is available through Returns:
choose **Cancel goods not collected**, select uncollected quantities, a refund
or account resolution and a reason. Approval requires return approval and stock
release permissions. It releases reserved quantities without adding physical
stock or reversing costs that were never posted. Cancellation and goods-return
quantities are tracked separately; cumulative monetary reversals are checked
inside the approval transaction, with stale requests rejected for reissue.
Historical sales default to already collected, so cannot acquire invented
reservations. Fully cancelled invoices leave the collection queue; partial
cancellations leave only the remaining quantities available for collection.

Serial-evidence POS collection,
long-uncollected reminders and release-linked waybills remain next steps. Do not
automatically expire reservations or use the collected-goods return option for uncollected stock.
