# Business workflow expansion (24 September 2026 baseline)

This roadmap extends the existing Firebase application and preserves historical users, stock entries, sales, journals and audit records. A requested capability is not marked complete merely because a screen or a partial workflow exists.

### Supplier advances and statements release — 8 October 2026

Sources `c326aa7` and corrected UI checkpoint `dde638c` are deployed. Existing
`getProcurementWorkspace` and `recordSupplierPayment` are ACTIVE on revisions
`getprocurementworkspace-00007-nag` and `recordsupplierpayment-00007-rib`, with
App Check enabled. App Hosting `build-2026-10-08-003` is READY, serves 100% traffic,
and is no longer reconciling. Purchasing returns HTTP 200. The earlier build
002 completed before cancellation; build 003 replaces its invalid-decimal dialog
edge case. No IAM changes or historical data rewrites were made.

Validation passed: 273 unit/interface tests, 3 procurement emulator cases,
17 sales emulator cases, 25 security cases, typecheck, lint, Functions compilation,
production build, secret scan and diff checks. All 215 indexes were READY and
420/420 live query plans passed. Emulator financial mutations used only the demo
project. Signed-in live financial acceptance remains unexercised.

### Supplier aging validation — 8 October 2026

Current unpaid-invoice paging, optional invoice due dates and six-way aging extend
the existing purchasing workspace. No dates or balances were backfilled into
historical invoices. Store-filtered debt excludes other locations, paid invoices
are excluded, legacy undated debt is explicitly separated, and payment updates
the same canonical invoice balance. Duplicate invoice lines and due dates before
issuance are rejected. No inventory, journal or permission model was replaced.

All 221 indexes are READY; the live planner audit passed 430/430 query shapes
with zero missing indexes at 2026-10-08T08:50:29.547Z. The guarded baseline was
updated only afterward. Validation passed 267 unit/interface cases, nine query
release-guard cases and all four procurement emulator cases (actual PO/GRN/invoice
posting, payable aging/location boundaries, and advance/part-payment concurrency).
Typecheck, lint, production build, Functions compilation, production environment
validation, secret scan and diff checks passed. Application deployment follows;
signed-in live financial acceptance remains unexercised.

### Supplier aging release — 8 October 2026

Source `a798f1e` is deployed. `getProcurementWorkspace` and `submitSupplierInvoice`
are ACTIVE on revisions `getprocurementworkspace-00008-rig` and
`submitsupplierinvoice-00007-xaw`, with App Check enabled. App Hosting
`build-2026-10-08-004` is READY, with 100% traffic and no reconciliation pending.
Purchasing returns HTTP 200 and the workspace callable rejects unauthenticated
requests with Firebase JSON UNAUTHENTICATED. No signed-in live financial mutations
were performed. Runtime Config/Secret Manager connection failures required scoped
retries; the successful Functions command explicitly completed. A web-build
cancellation request arrived after its Cloud Build had already finished; the web
and backend release are now both verified complete. Subsequent API/UI releases
must complete the backend before starting the dependent web rollout.

Current work has moved on to bounded receiving history and printable GRNs.

### Receiving history / GRN validation — 8 October 2026

Bounded receipt history and printable A4 GRNs are locally validated; deployment
is pending. Reprints use original posted inventory evidence and do not receive
stock again. Legacy references are derived without rewriting historical receipts.
All 278 unit/interface tests and 30 emulator tests (five procurement and 25
security) passed, as did typecheck, lint, Functions build, production build,
environment validation, secret scanning and diff checks. All 222 live indexes
are READY; the 09:10 UTC audit passed 432/432 query plans with no missing indexes.
The guarded baseline was refreshed only after readiness and the successful audit.
Release the receipt backend before the dependent web interface. Signed-in live
financial acceptance is not performed; no live business transactions were posted.
Next integrity dependency: verify concurrent inventory replay references before
integrating atomic supplier returns, credits and refunds.

### Receiving history / GRN release — 8 October 2026

Source `9c9ef02` is deployed. Backend deployment completed first:
`getProcurementWorkspace` is ACTIVE on `getprocurementworkspace-00009-dop` and
`receivePurchaseOrderItem` on `receivepurchaseorderitem-00007-zup`, both with
App Check enabled. App Hosting `build-2026-10-08-005` is READY with 100% traffic,
with neither build nor traffic reconciliation pending. Purchasing and the guide
return HTTP 200; the workspace callable returns Firebase JSON UNAUTHENTICATED to
an unauthenticated request. Signed-in business acceptance remains unperformed.

The next regression reproduced a concurrent inventory replay returning an unused
transaction ID and `posted: true`. The central engine now returns the committed
transaction callback result, preserving the original reference and `posted: false`
on a competing request/retry. This fix is not yet deployed. Its deterministic
regression and all 280 unit/interface tests pass. Final emulator coverage passed
16 inventory, four transfer, five procurement and 25 security cases (50 total).
The first run caught an invalid new test fixture and a 120-second transfer-test
timeout; the corrected inventory suite and transfer suite passed on a fresh
emulator run with a 240-second per-test allowance. Typecheck, lint, production
build, Functions build, secret scanning and the index guard passed. The fresh
12:49 UTC live audit passed 432/432 query plans with all 222 indexes READY.
No historical ledger or financial data is rewritten. Deploy only the ten
existing callable consumers of the shared posting engine; no web change is needed.

### Inventory replay hardening release — 8 October 2026

Source `0a622f9` is deployed. The scoped ten-function deployment explicitly
completed after two failed pre-upload attempts (Secret Manager connection and
Pub/Sub service identity checks). A live Functions listing confirms all ten
consumers ACTIVE with App Check enabled:

| Callable | Live revision |
| --- | --- |
| postOpeningStock | postopeningstock-00013-vam |
| postInventoryReceipt | postinventoryreceipt-00013-xip |
| moveInventoryBetweenLocations | moveinventorybetweenlocations-00013-jux |
| postStockAdjustment | poststockadjustment-00013-wax |
| postStockCount | poststockcount-00013-ves |
| receivePurchaseOrderItem | receivepurchaseorderitem-00008-fam |
| confirmCsvImport | confirmcsvimport-00014-qiq |
| confirmTransferDispatch | confirmtransferdispatch-00014-sad |
| confirmTransferReceipt | confirmtransferreceipt-00014-bit |
| resolveTransferDiscrepancy | resolvetransferdiscrepancy-00013-tel |

Live receipt callables return Firebase JSON UNAUTHENTICATED/HTTP 401 without a
session; this checks the authentication barrier, not signed-in business acceptance.
No live financial/stock mutations or IAM changes were performed. The web remains
the previously verified GRN build `build-2026-10-08-005`; this backend-only fix
did not start another web rollout. A redundant post-backend App Hosting metadata
refresh timed out; its earlier READY/100%-traffic verification remains recorded
above. Supplier returns/refunds/credits are the next supplier-workstream slice,
not yet implemented; the broader backlog is not complete.
Supplier returns/refunds/credits and the broader remaining roadmap are not complete.

## Next five priorities — 7 October 2026 implementation checkpoint

| Priority | This implementation group | Remaining gate / dependency |
| --- | --- | --- |
| 1. Customer invoice repayments, advances and debt aging | Implemented, validated and deployed: additive invoice receivable projections, agreed due dates, explicit invoice repayment and bounded FIFO, arrangement advances/application, aging, existing-worker due reminders and customer UI/guide | All 200 indexes READY; 378/378 live query shapes verified on 8 October. Historical allocations are not guessed; advanced statements, direct POS advance tender and unused-advance refunds remain separate work |
| 2. Supplier accounts | Existing PO/GRN/invoice/payment flow retained; supplier advances, partial invoice payments, advance application, dated statements, payable aging/unpaid-invoice pages, receiving history and printable GRNs deployed; shared inventory replay reference fix deployed | Supplier returns/refunds/credits with atomic stock/accounting integration remain |
| 3. Inspected customer returns and replacement differences | Existing returns, refund, exchange-credit and collection controls retained; tracked account-credit returns now reduce the original unpaid invoice | Next: separate inspection/disposition and linked replacement settlement in both directions |
| 4. Accounting and reviewed tax | Existing ledger/statements and period locks retained; advances use liability 2210, separate from accrued expenses 2300 | Next: manual/reversal journals, internal funds transfers, accountant-reviewed classifications and effective-dated statutory configuration. No new tax rates activated |
| 5. Commercial conversions, provider payables and budgets | Existing documents, aftersales and transfer costs retained | Next: issued quotation/proforma conversion, non-stock services/logistics provider settlement and budget-versus-actual |

These five are dependency-ordered implementation groups, not five features marked
complete by a single customer-account change. Do not deploy the first group by
refreshing the query audit baseline without a successful live audit.

Customer-receivables index gate (8 October 2026): Firebase authentication was
renewed using the IPv4 connection workaround. Six additive indexes deployed;
all 200 indexes are READY, with no field overrides. The live planner audit passed
378/378 query shapes with zero missing indexes. The guarded baseline was refreshed
only after that successful audit. All 264 unit/interface tests, including the
release-guard file, passed with the refreshed baseline. The 8 October emulator
rerun also passed all 17 sales and 25 security tests and exited successfully.
Typecheck, lint, Functions compilation, production build, JSON index validation,
secret scan and diff checks passed. The implementation-checkpoint sales emulator
suite passed all 17 cases, including checkout-paid projections, due-date retention,
concurrent advance retries and reminders. The final 25 Firestore security tests
also passed (42 combined), including denial of forged receivables, advance balances
and job cursors; the emulator command exited successfully. Earlier emulator attempts encountered cold-start test timeouts
under concurrent validation; a rerun uses 120-second test/hook allowances.

Completed deployment scope: `saveCustomer`, `recordCustomerPayment`,
`getCustomerHistory`, `createPosSaleOrder`, `commitPosSale`, `confirmPosSaleOrder`,
`approveSaleReturn`, `deliverPendingNotifications`, indexes and App Hosting.
No new callable, service IAM relaxation, rules change or historical migration is
needed for this slice. Priorities 2–5 remain pending.

### Customer receivables release — 8 October 2026

Implementation/source checkpoint: `1ebf462`. All eight affected Functions report
ACTIVE on new revisions with App Check enabled. The existing notification worker
retains its scheduled-functions feature flag enabled. No IAM changes were made.
App Hosting `build-2026-10-08-001` is READY, rollout SUCCEEDED, with 100% traffic
and reconciliation complete. Customers, POS and Guide return HTTP 200.
The release passed 264 unit/interface tests, 17 sales emulator tests, 25 security
tests, typecheck, lint, production build, secret scanning, index validation and
diff checks. All 378 live query plans passed; all 200 indexes are READY.
Earlier deployment attempts encountered API connection timeouts; scoped retries
completed successfully. No real customer/payment/inventory mutations were used
for acceptance. Signed-in live financial workflows remain unexercised; emulator
tests are the current workflow and authorization evidence. Historical sale and
repayment allocations were not rewritten or invented.

| Request | Current implementation | Remaining work |
| --- | --- | --- |
| Daily physical stock and cash reconciliation | Stock counts, inventory-ledger reconciliation, POS opening/closing cash variance and bank reconciliation exist; a dated store daily close now records cash ledger evidence, physical counted cash, exceptions, retained revisions and audited sign-off | Bank reconciliation remains a separate control; company-wide cash must have a store allocation before inclusion in a store close |
| Administrator-managed roles | Organization-specific role creation/editing, multiple role assignment, permission versioning and effective union authorization exist | Regression coverage for newly introduced permissions and deactivation across all modules |
| User disable/delete | Administrators can make accounts inactive or suspended; Auth is disabled and sessions are revoked; Users now has a direct Disable action | Do not hard-delete users with historical activity. Add archival/anonymization only with an explicit retention policy |
| Purchase order to payment | Draft/submitted/approved PO, goods receiving, printable GRNs, supplier invoice approval, advances, part payments, advance allocation, dated statements and payable aging with audit and journals | Supplier returns/refunds/credits remain |
| Logistics and outsourced services | Transfer costs and aftersales charges/payments exist | External provider payables, service-item costing, payment accounts, balanced journals and provider statements |
| Retail and wholesale prices | Retail/store and optional wholesale price, customer default and POS line selection; server validation, retained version/effective-from snapshots, held/offline price level and manual override audit implemented and deployed | Signed-in live acceptance; scheduled future price lists and additional configurable levels remain extensions |
| Product stock ledger/history | Immutable inventory entries and paginated product movement history exist | Human-readable running balance across reservations, collection and all future transaction types |
| Customer account arrangements | Named arrangements, POS selection, invoice/arrangement repayment allocation, advances/application, original-invoice return credits and aging/reminders implemented, validated and deployed | Arrangement-filtered statements, direct POS advance tender, unused-advance refunds and evidence-based historical allocation |
| Financial statements | Ledger-derived balance sheet, income statement, cash-flow statement and trial balance with CSV export exist | Opening-balance/COA review, complete transaction classifications and accountant sign-off before external use |
| Waybill, quotation and proforma | Official sale invoice/receipt printing, transfer reference and collection-linked A4 waybill deployed; each partial handover retains its stock-movement reference on reprint | Signed-in live acceptance; issued/versioned quotation and proforma conversion; older collection-history paging |
| Returns/exchanges | Partial returns, refunds, customer-account and exchange credit exist | Linked replacement sale with automatic difference settlement either direction, inventory disposition and balanced posting |

### Customer arrangements validation — 7 October 2026

Named arrangements extend existing customer identities and the shared credit
limit. POS orders/sales retain the selected arrangement; repayments allocate
exact totals across arrangements and return credits reduce the original
arrangement. General preserves historical debt without a backfill. No new
callables, permissions, Firestore rules or index definitions are introduced.
See [customer-arrangements.md](customer-arrangements.md) for usage and limits.

256 unit/interface tests and 41 sales/security emulator tests passed. Final
payment-retry UI tests, typecheck, lint, Functions compilation, production build,
secret scan and diff checks passed. All 371 live query shapes passed with no
missing indexes. This slice does not implement invoice settlement, advances,
arrangement-filtered statements or debt aging.

Source `27ba05c` is deployed. All nine affected existing callables reported
successful updates with production mode and App Check enabled. A temporary
503 on `getPosWorkspace` recovered; a scoped retry also completed, and its
final revision is ACTIVE. All nine service URLs returned Firebase JSON HTTP
401 UNAUTHENTICATED after initial local DNS timeouts. App Hosting
`build-2026-10-07-003` is READY, rollout SUCCEEDED, reconciliation complete,
with 100% traffic. GitHub push initially failed with server errors but
subsequently succeeded. No IAM, rules, index definitions or historical
business records were changed. Login, POS, Customers, Guide and manifest entry
URLs returned HTTP 200 after rollout. Signed-in live financial mutations and
physical-device UX were not exercised; emulator tests are the workflow proof.

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
| 2. Sales and customers | Retail/wholesale pricing, named arrangements, invoice/payment allocation, advances/application and debt aging/reminders implemented, validated and deployed | Arrangement-filtered statements, unused-advance refunds and direct POS advance tender; correction request and reversal workflow. Scheduled future price lists are not implemented |
| 3. Inventory and returns | Partial: reservation/partial collection/cancellation already implemented | Serial evidence at collection; uncollected reminders; inspected return disposition; linked replacement sale and difference settlement in either direction |
| 4. Suppliers | Existing PO/GRN/invoice/payment workflow retained; advances, partial payments, advance application, dated statements, payable aging, receiving history and printable GRNs deployed | Supplier returns/refunds/credits remain |
| 5. Accounting and tax | Draft statements/full-history paging implemented | Authorized manual/reversal journals, internal funds transfer, statement classifications/opening balances and accountant sign-off; reviewed versioned Nigerian tax rules, liabilities and payments. Do not activate invented statutory rates |
| 6. Services and logistics | Existing aftersales charges/payments retained | Non-stock service costing, technician/parts integration, outsourced provider payables and correct delivery fee/provider liability/retained income split |
| 7. Documents and dashboard | Server dashboard sums/counts and collection-linked A4 waybill slice deployed | Issued/versioned quotation → proforma → invoice conversion; older collection-history paging; further profit/aging/product metrics and large-report jobs |
| 8. Budgeting and hardening | HR employee/compensation/attendance connector foundations exist; client has not purchased a scanner yet | Budget-versus-actual, HR workflow/payroll expansion, future model-specific connector and real-device acceptance after procurement, cross-role/offline/security regression and release verification |

### Pricing and collection documents validation — 7 October 2026

248 unit/interface tests, 15 sales callable emulator tests and 25 Firestore
security tests passed. Sales coverage includes configured wholesale selection,
price-version/idempotency protection, stale offline snapshots, split payments,
credit, returns, reservation/partial collection and replay-safe immediate
checkout handover evidence. Waybill UI tests verify partial quantities and
read-only reprinting. Typecheck, lint, Functions compilation, production build, secret scanning
and diff checks passed; all 371 live query shapes passed with zero missing
indexes. Release completion and signed-in live acceptance remain separate.
Hardware attendance acceptance is deferred because no scanner has been bought;
the HR guide now includes pre-purchase integration requirements. The rest of
the eight-workstream programme remains partial/pending as listed above.

Release completed from source `dc4e388`: the seven affected existing callables
(`saveProductSalesPrice`, `getPosWorkspace`, `createPosSaleOrder`, `commitPosSale`,
`confirmPosSaleOrder`, `saveCustomer`, `getSaleDocument`) report ACTIVE on new
revisions with production mode and App Check enabled. The Functions CLI printed
successful updates and Deploy complete before a trailing timeout; direct API
inspection confirmed all seven updates. Each unauthenticated endpoint returns
Firebase JSON HTTP 401 UNAUTHENTICATED. No service IAM, rules, index definitions
or historical business records were changed. App Hosting build/rollout
`build-2026-10-07-002` is READY/SUCCEEDED, reconciliation complete, with 100%
traffic. Login, manifest, POS and guide entry URLs return HTTP 200. An initial
Node HTTP probe failed to connect; independent HTTP retries succeeded.
Signed-in live sale/collection mutations, installed-device print layouts and
physical scanner acceptance were not exercised. Emulator tests remain the
workflow proof; release checks do not mark the other workstreams complete.

### First dependency group: store close and bounded dashboard

`getDailyCloseWorkspace`, `prepareDailyClose` and `signDailyClose` reuse the existing journal lines, stock counts, shifts, branch scope and audit system. Cash is account 1010 for the selected store, including non-POS postings. Opening cash is derived from older journal lines, not an editable balance. Store-less/company-wide cash is deliberately excluded. Dates use Africa/Lagos boundaries. Every source page is read within a Firestore transaction snapshot. No business ledger is rewritten.

Cash differences and outstanding stock/till checks require explanations; they do not silently post adjustments. Direct built-in branch managers, operations administrators and finance officers gain scoped daily-close permissions additively. Custom roles gain only permissions explicitly assigned by their administrator. Signed evidence is retained in revision/sign-off records. Later/backdated postings are flagged and require a new revision. Daily close is evidence, not a period lock; bank reconciliation remains separate.

`getDashboardWorkspace` uses index-backed Firestore counts/sums, returning a fixed-size summary and seven trend points rather than complete sales, product, request and transfer registers. Both historical and simple transfers are counted, with an OR scope preventing double-counting a transfer whose source and destination are the same store. Unauthorized sections return unavailable values rather than fake zeros. Sales show invoiced value and payment position at checkout, not current receivables or net sales after later returns. Real data only; no backfill or fabricated production records. Materialized rollups remain an optional later optimization, not a prerequisite for correctness.

No migration rewrites existing documents. New daily-close collections are callable-only and deny direct client reads/writes; new indexes support the scoped aggregate/evidence queries. Newly introduced callable transport access must be verified at release; prior approvals for other services do not authorize new Cloud Run IAM changes.

Validation checkpoint: 228 unit/UI tests, 25 sales/administration/accounting callable emulator tests and 25 Firestore security tests passed. Typecheck, lint, Functions compilation, production build, index validation, secret scanning and diff checks passed. Production release and authenticated live acceptance remain separate checkpoints; the other workstreams above are not marked complete by this first group.

Initial release attempt (7 October 2026, source `5c40b37`): Firestore rules released and 19 new indexes accepted (at that checkpoint: 123 READY, 19 CREATING). Existing `createOrganizationUser`, `updateOrganizationUser`, `saveOrganizationRole` and `getAssignableRolePermissions` updates succeeded. Firebase could not set Cloud Run invoker IAM policy for new `getDailyCloseWorkspace`, `prepareDailyClose`, `signDailyClose` and `getDashboardWorkspace`; deployment exited with errors for those four services. No IAM checks were disabled in that attempt. App Hosting was held pending explicit transport approval and index readiness.

Completed release (7 October 2026): the owner explicitly approved disabling Cloud Run invoker IAM checks for those four new services only. The scoped changes succeeded; all four services report ready, production mode and App Check enabled, and each unauthenticated callable probe returns Firebase JSON HTTP 401 `UNAUTHENTICATED`. No other service IAM configuration was changed. All 142 indexes are READY. App Hosting build/rollout `build-2026-10-07-001` is READY/SUCCEEDED, with 100% production traffic and reconciliation complete. The web source checkpoint is `488cffd` (implementation `5c40b37`). Signed-in live mutations were not exercised; the 25 callable emulator tests and 25 security tests remain the workflow/authorization evidence. No real business data was modified during release verification. Remaining workstreams are still pending/partial as shown above.

Dashboard follow-up (7 October 2026): live `getDashboardWorkspace` errors identified
missing count-only sales indexes (`branchId, organizationId, recordedAt ASC` and
`organizationId, recordedAt ASC`). Wider financial-sum and descending register
indexes do not cover these queries. Added both definitions and release-guard
regressions rejecting missing or descending count indexes. This remediation is
index-only: no permission changes, ledger edits, data migration or web rollout.
Deployment/readiness and live aggregate verification are recorded separately below.

Index-only release `73d1610` completed successfully against the production alias;
all 144 deployed indexes are READY. All 47 read-only live dashboard aggregate
probes passed using authorized Firebase CLI credentials and the real Igbo Road
store/organization scopes: period/daily sales counts and sums, payment mix,
requests, transfer counts/status groups and active products. These exercised the
same query shapes as the deployed callable, not a signed-in browser session or
financial mutation. The previously failing sales count queries now succeed.
Validation: 233 unit/UI tests (including five index regressions), typecheck, lint,
production build, index/config guards, secret scan and diff check passed. No
business records, Auth/App Check enforcement, rules or service IAM were changed.

## Cross-section index audit — 7 October 2026

Reviewed current client/server queries and dynamic filters across all existing
modules. The maintained catalog covers 371 query shapes and tracks 70 source
files/consumers. The first 367-shape live pass identified 50 unsupported shapes:
37 inventory movement combinations, nine stock-count variance combinations and
four no-date sales sum combinations. Added exactly Firebase's 50 suggested
indexes, preserving all 144 existing definitions. Added seven release-guard
regressions plus a baseline check in CI/production safeguards. See
`docs/firestore-index-audit.md` for coverage, safe rerun and maintenance steps.
Final deployment/readiness and full 371-shape results are recorded after release.

Verified production release: index-only deployment `d0d3703` completed (a
transient rules compilation API connection failure was retried successfully).
All 194 indexes are READY, with no single-field overrides. The final live audit
at 2026-10-07 09:40 UTC passed 371/371 query shapes across 73 collections, with
zero unsupported queries and zero missing-index findings. The complete-source
baseline guard is recorded in `5b1c467`; 240 unit/UI tests, typecheck, lint,
production build, secret scan, production safeguards and diff checks passed.
Recent logs contained 26 historical index errors across dashboard, sales reports
and stock-position reports; the affected query families are included in this
audit. No real transactions, user impersonation, rules changes, App Hosting
rollout or service IAM changes were performed. This is current query/index
coverage evidence, not an end-to-end browser/RBAC acceptance claim or completion
of the remaining business-workflow roadmap.

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
