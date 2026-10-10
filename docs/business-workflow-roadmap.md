# Business workflow expansion (24 September 2026 baseline)

## Current delivery checkpoint — 10 October 2026

This checkpoint supersedes the older dated backlog tables below; those remain
release history, not a claim that the same work still needs rebuilding.

| Workstream | Implemented foundation | Remaining completion gate |
| --- | --- | --- |
| 1. Locations / UI / RBAC | HQ/store model, historical location preservation, multi-role/custom roles, user deactivation/reactivation, responsive shared dialogs and navigation | Final role/device acceptance and larger-register usability checks |
| 2. Sales / customers / payments | Controlled stages, split/credit/advance payments, customer arrangements/statements, corrections, reservations and partial collections | Mixed goods/service billing and associated service accrual/refund integration |
| 3. Inventory / returns / serials | Stock ledger, collection evidence, inspection/disposition, supplier handovers/replacements, private serial photos and linked stock journals | Paged count progress/completeness release below; staged snapshot scalability and final device acceptance |
| 4. Procurement / suppliers | PO/GRN/invoice, advances, credits/refunds, supplier statements/aging and linked return corrections | Final cross-module financial acceptance, not a duplicate supplier ledger |
| 5. Accounting / tax | Statements, journal controls/reversals, financial accounts/transfers, reconciliations, linked stock accounting and reviewed versioned tax configuration | Accountant opening balances/classification review; company tax facts and authorized statutory activation/filing |
| 6. Services / aftersales / delivery | Case workflow, employee ownership, non-stock service catalogue/case pricing, receipts and linked outsourced bills | Mixed service invoicing, parts/costs, accrual/refunds, collected delivery fee versus provider payable/retained-income split |
| 7. Documents / reports / dashboard | Official invoices/receipts, partial-collection A4 waybills, filtered reports, ledger statements and server aggregates | Issued quotation/proforma conversion, additional product/profit/aging analytics and larger-report processing |
| 8. Budgets / HR / hardening | Monthly account/store budgets, independent employees, attendance connector contract, salary terms, notifications and audit | Broader budget dimensions, payroll when commissioned, real biometric-device integration and final acceptance |

Dependency order: finish count page/completeness safeguards; then service
billing/parts and delivery allocation; commercial-document
conversion; analytics/report scaling; remaining HR/budget extensions and final
cross-module acceptance. Preserve existing goods invoices, receipts and history
at each step. Tax activation and hardware-specific biometric acceptance remain
external gates because the company tax profile and device are unavailable.
Firebase CLI authentication is restored. The matching live planner audit passes
457/457 shapes and all 226 deployed indexes are READY. The guarded baseline is
refreshed against the exact reviewed sources; deployment completion is still a
separate release gate.

## Paged count progress and completeness — 10 October 2026 (validated; release pending)

Extends the existing count workspace and submit callable, not a second count
module. The server returns stable count-scoped cursor pages; the UI offers
25/50/100 items and saves entered quantities before page navigation. Draft page
saves are audited and do not submit, post inventory or create financial entries.
Blank quantities remain uncounted, never implicit zero. Duplicate lines and
foreign page cursors are rejected. Submission, review and posting reject counts
with unfinished lines; custom review permissions govern blind-count visibility.
Existing completed counts/history remain unchanged. Snapshot capacity is checked
before any mutation: more than 2000 positions or 5000 active serials fails clearly
and leaves the draft untouched instead of truncating. This is a safety guard,
not a claim that staged snapshots beyond the supported atomic limits are complete.
Stock and serials are read from the same transaction snapshot. Exact start
retries retain that snapshot, and document/request size budgets fail before any
write. Larger atomic write support and remaining size limits were verified from
[Firestore release notes](https://docs.cloud.google.com/firestore/docs/release-notes)
and [current quotas](https://docs.cloud.google.com/firestore/quotas).
Validation: all 407 unit/interface tests, all 25 inventory emulator cases,
nine focused UI/client checks, typecheck, lint, production build, Functions build,
secret scan and diff checks pass. A final focused emulator rerun passes the three
count tests against the reviewed source, including foreign-organization line
denial, paged blind counts, explicit zero, incomplete submission/review/posting,
a complete 501-position atomic snapshot, exact start replay and fail-closed
2001-position snapshot admission. All 457 live planner checks pass; no new
index is required. Existing role/rule denial coverage is retained; no Rules or
Storage policy change or historical migration is needed.

## Stock valuation journals and complete count posting — 10 October 2026 (deployed)

Opening stock, adjustments and approved count variances now link actual weighted
stock valuation to balanced non-cash journals inside the same stock transaction.
CSV/Excel opening quantities use the same journal linkage rather than bypassing
the accounting treatment of manual opening stock.
Opening equity clearing (3100) is separate from synthetic unclosed earnings;
adjustments/count variances use 5200. Existing conflicting account configuration
fails closed rather than being overwritten. Period locks apply, including to
zero-valued postings. Zero-value stock receives explicit linkage metadata without
an invented journal. Historical stock-only postings are not backfilled.
Authorized stock reversals reverse the linked journal atomically, with original
journal evidence checks. New opening/adjustment retries reject changed payloads
and recheck current store access. Stock-count posting pages all variance lines,
not just 100, retains its original posting date/reason for safe resumption and
allows authorized managers/admins to review and post without a second person.
The count register shows Resume posting after posting starts, retains the
original reason, explains uncertain/partial results and uses the server's
five-minute posting timeout instead of timing out the client at 70 seconds.
Count snapshot/workspace limits and mixed service POS billing remain separate
roadmap work; this group does not claim those complete.
Validation: final typecheck, lint, Functions compilation, production build,
secret scan and diff checks pass. The initial unit/interface run passed 401 cases;
four query-baseline guard assertions correctly blocked a stale source baseline.
After user-controlled reauthentication, all 456 live planner checks pass with
226/226 deployed indexes READY and no missing indexes. The matching baseline is
now refreshed; the final full unit/interface suite passes all 405 cases across
105 files. Twelve targeted
UI/client/journal tests pass. The affected emulator run passes 94 cases with two
Storage-only skips and one incorrect new test lookup (transaction headers do not
carry productId). That lookup is corrected to follow the original inventory
entry's transaction ID. The final four focused emulator cases pass, including
imported opening journals, closed-period rollback, weighted-cost reversal,
concurrent exact replay, revoked-scope replay denial, zero-value stock and
manager resumption of an interrupted 101-line count without duplicate journals.
Procurement passes all 12 cases, POS passes 30 with one Storage skip, manual
journals pass all five and Rules pass 26 with one Storage skip. Supplier statement
test dates now use Nigerian business dates rather than UTC midnight.
Release 38cddc9 is pushed and deployed. All 13 selected existing callables report
successful updates, ACTIVE state, App Check enabled, the original runtime
identity and 100% traffic to their updated revisions. All 13 unauthenticated
probes return 401 (Auth barrier evidence, not authenticated business acceptance).
App Hosting build-2026-10-10-001 is READY, its rollout SUCCEEDED, and the matching
revision serves 100% traffic. Counts, Guide, POS and manifest return HTTP 200;
the served count asset contains Resume posting. No live business data was posted.
No IAM change,
new collection or destructive historical migration is required.

## Non-stock service catalogue / case pricing — 10 October 2026 (deployed)

Extends Products with an immutable stock/service classification. Omitted kind on
historical goods means stock; old-client edits preserve an existing service kind.
Services use the existing catalogue and configured selling prices, never a second
customer, product or service identity. Inventory posting rejects service items;
goods procurement and physical POS do not offer them. Catalogue service selection
on an aftersales case snapshots its name, SKU, configured base price, VAT rate and
price version. Staff confirm the VAT-inclusive charge/complimentary decision with
a reason. Version-2 service receipts allocate that configured VAT cumulatively
over part payments, with balanced bank/cash, service-income and VAT journals.
Legacy cases/receipts keep their existing recognition unchanged. No statutory
rate is invented or activated; fixture rates are emulator-only. No physical
stock/reservation/release is generated for service billing. POS mixed-service
invoices, accrual/refunds, service parts and quotation/proforma conversion remain
subsequent dependency work; this slice does not claim them complete.
Validation: 399 unit/interface cases across 103 files and 18 final targeted
cases pass. Inventory/aftersales callable checks pass 31 cases (four Storage
skips); sales checks pass 30 cases (one Storage skip), covering ordinary and
controlled-order flows, partial collection, credit, advances, returns and
corrections. The final ordinary-line service guard regression passes, as do all
12 simplified-transfer cases and 26 security-rule cases (one Storage-only skip).
The guard checks every order line, not only manually priced goods. Production
build, Functions compilation, final typecheck/lint and secret scan pass. The matching read-only live
planner proof passes 455/455 query shapes with zero missing indexes; independent
metadata confirms 226 READY indexes. Historical records are not migrated or
rewritten. The release must update all shared inventory-posting consumers, not
only the catalogue UI, before services may be created by live users.
Source f821941 is pushed and deployed. All 23 selected Functions printed
Successful update / Deploy complete and are ACTIVE at 100% traffic, retaining
production mode, App Check and original runtime identity. All unauthenticated
callable probes return HTTP 401. App Hosting build-2026-10-09-026 is READY,
rollout SUCCEEDED at 100% traffic without reconciliation. Products, Aftersales,
Guide, POS, Inventory and manifest return HTTP 200; served Products/Aftersales
scripts contain the new catalogue service controls. No live business postings,
IAM changes or historical migrations were used.

## Aftersales staff ownership — 10 October 2026 (deployed)

The existing updateAftersalesCase operation supports independently assigning,
reassigning or removing an existing HR employee by staff ID and reason. It reuses
HR's unique employee mapping, accepts employees without app accounts, validates
organization, active status and store assignment inside the transaction, and
captures the minimum employee identity snapshot in the case and append-only audit.
Salary/contact fields are not copied or exposed. Closed cases reject reassignment.
The existing per-user saved-instructions retry protection covers assignment too.
No stock, payments, salary terms or accounting entries are changed. Historical
cases remain unassigned until explicitly updated; no destructive migration.
This implements staff ownership, not service catalogue billing, parts consumption
or accrual/refunds. Nine targeted UI/schema/audit tests and three focused emulator
cases pass, including employees with no login, inactive/on-leave/foreign employee
denials, wrong-store and missing-permission denials, exact replay, changed replay,
unassignment and closed-case rejection without stock/journal effects. The full
suite passes 395 tests across 102 files. Typecheck, lint, Functions compilation,
production build, secret scan and diff checks pass; the unchanged rules passed
26 cases with one Storage skip in the immediately preceding retry release.
All 454 live query shapes pass with zero missing indexes and the reviewed source
baseline is refreshed. Deployment scope: updateAftersalesCase and App Hosting.
No IAM change, live business test posting or historical rewrite is required.
Source 238581a is pushed and deployed. updateAftersalesCase printed Successful
update / Deploy complete and is ACTIVE as updateaftersalescase-00006-gac at 100%
traffic without reconciliation, retaining production mode, App Check and original
runtime identity. Its unauthenticated probe returns HTTP 401. App Hosting printed
Rollout complete / Deploy complete; build-2026-10-09-025 is READY and rollout
SUCCEEDED, with 100% traffic and no reconciliation. Aftersales and Guide return
HTTP 200; all eleven served aftersales scripts load and contain staff-ID,
assignment and saved-retry controls. No live business postings were used.

## Aftersales action retry safety — 10 October 2026 (deployed)

Before expanding non-stock services, existing case creation, status changes,
charge decisions and service receipts now retain exact uncertain instructions in
per-user/per-organization browser-tab storage, including across reload. Concurrent
and new actions are blocked while the saved result is unknown. A denied retry
does not discard earlier uncertainty. Corrupt browser recovery data fails closed
with a persistent explanation. Successful mutations clear used payment drafts;
two-decimal amounts use the existing minor-unit converter, not raw float equality.
New trusted operation fingerprints reject changed payloads; legacy creation,
charge/status and payment retries are checked against their existing evidence.
Every replay rechecks current case/store access, even if the original request
already committed. This does not rewrite old receipts or change the existing
service cash-receipt revenue treatment. It is not the non-stock POS catalogue,
service accrual/refund, technician/parts or commercial-document conversion slice.
Four targeted UI/validation cases pass. The broader aftersales/statement emulator
suite passes ten cases with four Storage-only skips; the final focused emulator
checks pass both warranty/payment cases against the last compatibility refinement.
The full suite passes 393 cases across 102 files. Typecheck, lint, Functions
compilation, production build, secret scan and diff checks pass. Rules checks pass
26 cases with one Storage-only skip. The matching live planner audit passes all
454 query shapes without missing indexes; its source baseline is refreshed.
Source 1621f0e is pushed and deployed. The five existing callables printed
Successful update / Deploy complete and are ACTIVE at 100% traffic without
reconciliation: getaftersalesworkspace-00010-xez, createaftersalescase-00005-jub,
updateaftersalescase-00005-fab, setaftersalescharge-00005-heb and
recordaftersalespayment-00005-cuq. Production mode, App Check and the original
runtime identity remain intact; all five unauthenticated probes return HTTP 401.
App Hosting printed Rollout complete / Deploy complete; build-2026-10-09-024 is
READY and rollout SUCCEEDED at 100% traffic without reconciliation. Aftersales,
Guide, POS and the manifest return HTTP 200; all eleven aftersales scripts load
and include the saved-service-instructions retry control. No live business
records were posted and no IAM change or migration was made. Auth-barrier/public
probes are not signed-in business acceptance; emulator business proof is separate.

## Older collection history — 9 October 2026 (deployed)

The existing official invoice reader now pages physical handovers in stable
timestamp/document-ID order, with 25/50/100 choices and Newer / Older controls.
Each historical handover retains its actual-quantity waybill and private photo
links; the paid invoice is not misrepresented as a physical release. Cursor
ownership is checked against the invoice, organization and store before query
execution. Inconsistent collection evidence fails closed. Failed page loads
preserve the visible page, and a mismatched invoice/store response is rejected.
Old clients retain the 25-record default. This changes no reservation, stock,
payment, journal or historical record and requires no data migration.
The guide explains paging and reprinting. Seven targeted validation/interface
cases pass, and the refreshed full suite passes 389 cases across 100 files.
Sales emulator checks pass 29 cases (one Storage-photo skip), including tied
timestamps without missing/duplicate handovers and foreign invoice, organization
and store cursor denials. Final typecheck, lint, Functions compilation, production
build, secret scan and diff checks pass. Security checks pass 26 cases with one
Storage-only skip. These emulator proofs do not imply signed-in live business
acceptance; no live business records are used for release tests.
The live planner audit passes all 454 query shapes with zero missing indexes;
independent metadata confirms 226 READY indexes. The reviewed catalog/source
fingerprints are refreshed only from that matching successful proof. Deployment
scope is getSaleDocument and App Hosting; no rule or IAM change is needed.
Source 6c972bb is pushed and deployed. getSaleDocument printed Successful update
and Deploy complete, is ACTIVE as getsaledocument-00013-paw at 100% traffic
without reconciliation, retaining production mode, App Check and original runtime
identity. Its unauthenticated probe returns Firebase HTTP 401. App Hosting printed
Rollout complete / Deploy complete; build-2026-10-09-023 is READY and rollout
SUCCEEDED, with 100% traffic and no reconciliation. POS, Guide, Returns and the
manifest return HTTP 200. All twelve served POS scripts load; collection page
size, Older/Newer controls and cursor request fields are present in live assets.
No live business postings were used. Signed-in live acceptance remains separate
from emulator business proof and public-route/Auth-barrier probes.

## Outsourced service / logistics bills — 9 October 2026 (deployed)

Extends the existing Expenses register, approval, payable and partial payment
workflow rather than creating a separate provider ledger. Aftersales cases and
official sales invoices link directly to a cost form. Purpose, original sale/job,
store, payee, due date and external invoice reference remain traceable on the
expense; payment records retain the linked purpose/reference and selected
company financial account. Trusted creation validates record ownership, store
and relevant sales/aftersales read permission. Cancelled jobs cannot receive new
bills. Draft creation does not post accounting; existing approval accrues the
expense/payable once and payment clears only the paid portion. This does not
charge the customer, release goods or complete the service job.

Creation, submission, approval and payment now save exact uncertain instructions
in per-user browser-tab storage, prevent concurrent/new mutations until resolved
and retry the same key after reload. New server fingerprints reject changed
retries; pre-upgrade expense/payment keys are checked against original records
without rewriting history. Cross-store/cross-organization links are rejected.
No financial or inventory history is migrated or deleted, and no tax rate is
activated. This is provider cost settlement, not full non-stock POS services or
the delivery collected/provider-payable/retained-income split. Do not record an
already-accrued pass-through payable as a second expense.
Validation: 384 full-suite unit/interface tests across 99 files passed, followed
by seven final invoice/provider UI cases including two-decimal partial payments
and retention of an uncertain retry after access denial. Both expense callable
emulator cases pass, covering scoped approval, selected-bank partial payment,
exact/changed retries (including pre-upgrade keys), and cross-organization/store
denials. Firestore security checks pass 26 cases with one Storage-only skip.
Final typecheck, lint, Functions compilation, production build, secret scan and
diff checks pass. The fresh planner audit passes 454/454 shapes, no missing
indexes; independent metadata confirms all 226 indexes READY. No new index or
rule definition and no data migration is required. Source 00f789f is pushed.
All five expense Functions printed Successful update / Deploy complete and are
ACTIVE at 100% traffic: createexpense-00007-gej, submitexpense-00007-bey,
approveexpense-00007-xob, recordexpensepayment-00007-wex and
getexpenseworkspace-00007-jep. Production mode, App Check and original runtime
identity are preserved; no IAM setting changed. App Hosting printed Rollout
complete / Deploy complete; build-2026-10-09-022 is READY, rollout SUCCEEDED,
100% traffic and no reconciliation. Expenses, Aftersales, POS, Guide and Banking
return HTTP 200; all eleven expense scripts load with the retry, cost purpose
and payment-due-date controls. No live business records were posted.

## Remaining dependency queue — 10 October 2026

Recent deployed sections below supersede the historical 7 October checkpoint;
they do not establish that all eight workstreams are complete. Continue without
routine approval pauses. Provider cost settlement and older collection-history
paging, aftersales retry safety and staff ownership are deployed. Continue
non-stock service billing and the
delivery fee/provider liability/retained-income split. Issued quotation/proforma
conversion must reuse existing customer/POS/invoice primitives. Follow with
remaining dashboard/report scalability and HR/payroll expansion. Department and
multi-month budgets are extensions to the deployed monthly targets. Company tax
assessment/payment/filing activation still needs reviewed legal/tax-profile facts;
external financial statements need accountant classification/opening-balance
sign-off. Hardware-specific attendance acceptance waits for device procurement.
Do not substitute invented tax facts, production test postings or a cosmetic
completion score for these dependencies.

## POS minor-unit calculation hardening — 9 October 2026 (deployed)

The existing browser/offline cart and trusted sale posting calculations now use
exact integer intermediates for half-up VAT and proportional discounts. Cumulative
allocation prevents accumulated rounding remainder from making the final item
negative, while preserving the full discount. Unsafe aggregate subtotals/totals
and malformed offline VAT snapshots are rejected. No rates, price permissions,
stored orders, issued invoices or posted ledger entries are changed. Existing
snapshot/retry checks remain authoritative. New payloads carry calculationVersion
2; unversioned queued/received orders retain legacy calculation version 1 without
changing their retry fingerprints. Posted sales record the method used. Invalid
negative legacy line allocations fail closed rather than posting corrupt values.
Old queued transactions are not silently repriced. Regression cases cover client/server parity, mixed rates,
large safe amounts, overflow and 100 low-value lines with a near-full discount.
This is calculation integrity hardening, not activation of statutory tax rules.
Validation passes 377 unit/interface cases across 97 files, 29 sales callable
emulator cases (one Storage-photo skip), typecheck, lint, Functions compilation,
production build, secret scan and diff checks. The fresh audit passes 454/454
live query shapes with zero missing indexes; independent API inspection confirms
all 226 indexes READY. The query definitions are unchanged. A failed transport
audit was discarded, then explicit IPv4 connection selection restored the
planner requests; only matching successful evidence refreshed the baseline.
Deployment scope is createPosSaleOrder, commitPosSale, confirmPosSaleOrder and
App Hosting; no rules, data migrations, statutory rates or IAM changes.
Source c34babf is pushed and released. Functions printed successful updates and
Deploy complete: createpossaleorder-00014-nac, commitpossale-00019-rir and
confirmpossaleorder-00020-xoj are ACTIVE, serving 100% traffic without
reconciliation. Production mode, App Check, original runtime identities and
existing transport settings are preserved; unauthenticated probes return
Firebase HTTP 401. The first web attempt hit a pre-upload IAM API network error;
the same-scope retry completed. App Hosting build-2026-10-09-021 is READY,
rollout SUCCEEDED, 100% traffic and no reconciliation, with explicit Rollout
complete / Deploy complete. POS, Finance, Tax, Guide, Banking and manifest
return HTTP 200. All twelve served POS scripts load; calculationVersion:2,
aggregate overflow checks and VAT snapshot validation appear in live assets.
No live business records were posted. Emulator coverage includes unversioned
offline sale retention and version-2 order receipt, atomic confirmation and
exact replay; HTTP probes alone do not prove authenticated business mutations.

## Monthly budgets versus actuals — 9 October 2026 (deployed)

Extends Accounting with monthly income/expense account targets scoped to one
store or the organization. Consolidated targets are distinct from branch targets,
not a double-counted automatic sum. Actuals use the existing journalLines ledger,
paged server-side with Nigerian calendar-month boundaries. Only budgeted accounts
appear; this is not a cash position or tax assessment. Favorable variance means
higher income or lower expense; zero targets have no percentage. Registers page
25/50/100, and revision history pages 25. Explicit finance.budget.manage controls
mutations; read access remains finance.journal.read with scope checks. Current
targets are summaries backed by immutable numbered revisions and reasoned audits;
expected versions prevent stale concurrent edits, and exact retries replay one
result. Saved uncertain UI instructions survive reload and scope switching.
No journals, stock movements, automatic tax liabilities or historical edits.
Guide, security regressions, RBAC tests and query catalog updated. Validation
passes 370 unit/interface cases across 97 files, 41 accounting/tax/budget/security
emulator cases (one Storage-only skip), typecheck, lint, Functions compilation,
production build, secret scan and diff checks. The live audit passes 454/454
query shapes with zero missing indexes and all 226 indexes READY; baseline was
refreshed only against matching source/proof.
An initial emulator failure exposed encoded scope IDs that could not pass history
validation; new budget IDs now use fixed-length SHA-256. Existing tax IDs remain
unchanged, with validated encoded version labels supported in reviews, previews
and page cursors. Explicit regressions cover these paths. A stale-baseline unit
failure was resolved through the actual live audit, not by weakening the guard.
Department budgets and multi-month planning remain
extensions, not features claimed by this monthly account/store slice.
Client confirms a limited-liability company but currently has no registered-name,
TIN, financial-year or VAT-status evidence available. Company-specific tax profile
and liability activation therefore remain unconfirmed; do not infer exemptions,
taxable profit or filing obligations from entity type alone. Other work continues.

Source 03db698 is pushed. A pre-upload Firestore metadata request timed out;
the retry uploaded successfully and updated all five existing selected Functions.
The new budgetWorkspace service required the owner's standing approval for its
service-specific supported invoker-IAM-disabled annotation after Google's policy
setup failed. It is ACTIVE at budgetworkspace-00001-hiv. The other revisions are
gettaxworkspace-00008-pen, taxruleadministration-00003-hax,
getmyaccesscontext-00017-hob, getassignablerolepermissions-00008-zed and
saveorganizationrole-00008-diz. All six retain production mode, App Check and
the original runtime identity, serve 100% traffic, and are not reconciling.
Unauthenticated probes return Firebase HTTP 401; no unrelated IAM was changed.
App Hosting build-2026-10-09-020 is READY, rollout SUCCEEDED and serving 100%
traffic, with explicit Rollout complete / Deploy complete. Finance, Tax, Guide,
POS and Banking return HTTP 200. All eleven Finance scripts return HTTP 200,
with deployed target creation, revision history and saved-retry controls found.
Bounded retries/compression recovered transient asset transport failures.
No live business records were posted; emulator tests provide the signed-in
workflow evidence, while these probes establish release and Auth barriers only.

## Reviewed tax-rule configuration — 9 October 2026 (deployed)

Extends the existing Tax Centre and taxRules collection with immutable proposed
versions, explicit approval/rejection, scope-specific bounded effective dates,
rate/basis/applicability/exemption/source evidence and reasoned audit events.
The new finance.tax.manage permission is explicit for custom roles and additive
for direct administrator/finance roles; preview still requires organization-wide
finance read access. No parallel tax register or direct-client mutation path.
Approval locks serialize concurrent reviews and reject overlapping approved
periods for the same tax/scope. Exact retries replay their original result;
changed instructions cannot reuse a key. Uncertain UI requests survive reload.
No approved definition can be edited/deleted through this workflow. New legal
changes require a separate version and non-overlapping dates, not historical
recalculation. Legacy unbounded rules require reconciliation before conflicting
new approvals, rather than silently changing their dates.

The centralized flat-rate engine uses exact BigInt minor-unit rounding and
returns rule ID/version, effective date, basis and statutory reference with its
preview. Tax Centre pages 25/50/100 rules on the server; VAT coverage checks are
independent of the visible page and require the entire selected period, with
gaps/overlaps flagged. Existing ledger VAT remains posted-transaction evidence,
not proof of lawful rates or recoverability. Source verification is a deliberate
authorized reviewer attestation, not a fabricated automatic legal verification.

Authoritative source inspected: the National Assembly's gazetted Nigeria Tax
Act 2025, https://nass.gov.ng/documents/download/11249 (sections 56/59/147 and
the small-company definition). No statutory rate is seeded or activated by
deployment. This group does NOT claim automatic company-tax compliance:
reviewed company/year profiles, exemptions, assessed taxable/assessable bases,
liability assessment/payment/filing journals and future POS rule snapshots
remain separate dependencies. A preview neither posts a tax liability/payment
nor changes invoices, product prices, offline POS snapshots or historical VAT.
Guide updated with these boundaries. Validation passed 364 unit/interface tests
across 95 files, 41 accounting/tax/security emulator cases (one Storage-only
skip), typecheck, lint, Functions compilation, production build, secret scan
and diff checks. All 452 live query shapes passed with zero missing indexes;
all 226 deployed indexes were independently verified READY before refreshing
the guarded baseline. No additional indexes or rules changes are needed.
Tax and manual-journal emulator suites are now included in the existing CI
callable command. Source f3318b0 is committed and pushed. The four existing
Functions updated successfully. The new taxRuleAdministration service is ACTIVE
at taxruleadministration-00001-yoh. Google's invoker-policy setup failed, then the
owner's standing approval was used to apply only that service's supported
invoker-IAM-disabled annotation. All five affected services retain production
mode, App Check, original runtime identity, 100% traffic and no reconciliation;
unauthenticated probes return Firebase HTTP 401. No other IAM bindings changed.
App Hosting build-2026-10-09-019 is READY, rollout SUCCEEDED, traffic 100%, with
explicit Rollout complete / Deploy complete. Tax, Finance, Guide, POS and Banking
routes returned HTTP 200; all 11 Tax scripts loaded and the register, proposal,
review, preview and saved retry controls were found in deployed assets. Bounded
retries recovered transient peer errors. No live tax or financial records were
created; emulator cases establish the signed-in business-workflow evidence.

## Accountant journals and linked reversals — 9 October 2026 (deployed)

Extends the Accounting hub with a server-paged dated journal register (25/50/100),
on-demand debit/credit expansion, explicit accountant-adjustment and reversal
permissions, and non-system Chart of Accounts configuration. Direct administrator
and finance roles gain the new capabilities; restricted custom bases do not.
The existing shared journal writer, counters, accounting period locks, company
financial accounts and audit system are reused; there is no parallel ledger.
Postings require an active store, date, reference, reason, purpose, safe balanced
minor units, active NGN ledger accounts and explicit cash-flow classification.
Bank lines identify one active company account with a unique ledger code; the
account ID and name remain traceable. Existing account metadata is not upserted
by accountant postings. Operational inventory/customer/supplier/advance/tax
controls and derived retained earnings cannot be changed through manual journals.
Reserved operational account configuration stays in its existing workflow.
Manual journals can be reversed once, in an open period, including when the
original period is closed or the original account has since been deactivated.
Opposite lines and a new journal commit with an additive link and audit; the
original posted status, values and history remain intact. Automatic journals and
reversals cannot be reversed through this route. Exact concurrent retries are
idempotent and uncertain client instructions survive reload/store switching.
Historical cash-flow grouping is preserved; explicitly classified new manual
money entries follow their reviewed operating/investing/financing choice.
Guide and plain-language audit presentation updated. No tax rules activated,
business records migrated or direct-client ledger writes enabled. Service-level
invoker IAM configuration is recorded separately below.
The two added journal register indexes were deployed; after their CREATING
phase, all 226 indexes were verified READY and the live planner audit passed
449/449 with zero missing indexes. Only then was the guarded baseline refreshed.
Validation passed 359 unit/interface tests across 93 files, 52 distinct
procurement/banking/accounting/security emulator cases (one Storage-only skip),
and the expanded five-case manual-journal suite rerun after final guards.
Typecheck, lint, Functions compilation, production build, secret scan, query
baseline and diff checks pass. An initial emulator assertion sent an undefined
bank reference instead of omitting the field; the fixture was corrected and
the real missing-bank/shared-code denials and successful posting were verified.
Source `fcfbaf5` is committed/pushed and production safeguards pass. The four
existing selected Functions updated successfully: generateFinancialStatement
`generatefinancialstatement-00007-wib`, getMyAccessContext
`getmyaccesscontext-00015-nus`, getAssignableRolePermissions
`getassignablerolepermissions-00006-vil` and saveOrganizationRole
`saveorganizationrole-00006-zuh`. Each is ACTIVE, retains production mode,
App Check, runtime identity and invoker settings, serves 100% traffic without
pending reconciliation and returns Firebase HTTP 401 to unauthenticated calls.
The new accountingJournals
Function is ACTIVE at `accountingjournals-00001-gib`, with production mode,
App Check enabled, original runtime identity, 100% traffic and no pending
reconciliation. Google rejected its invoker IAM policy setup; unauthenticated
requests still return Cloud Run HTTP 403 and invoker IAM checks remain enabled.
The earlier user approval covered recordCompanyFundsTransfer only, not this
service, so the web release was held. After separate explicit approval for
accountingJournals only, its supported Cloud Run service-level invoker-IAM-disabled
annotation was applied. The service is generation 2, with the same revision,
production mode, App Check, runtime identity, 100% traffic and no reconciliation
pending. Its unauthenticated response is now Firebase HTTP 401, not Cloud Run
HTTP 403; application authentication and action-specific permissions remain
enforced. No other service or IAM policy binding was changed.
App Hosting `build-2026-10-09-018` is READY, rollout SUCCEEDED, with 100% traffic
at `ramadan-warehouse-staging-build-2026-10-09-018` and no pending reconciliation.
Firebase reported explicit Rollout complete and Deploy complete. Production
environment/query-baseline/deployment safeguards passed again before deployment.
The four targeted manual-journal validation/interface tests passed again after
approval. Signed-in production financial mutations were not exercised; emulator
tests are the business-workflow proof, without adding live test transactions.
Finance, Banking, Tax, Guide and POS routes returned HTTP 200. All 11 scripts
referenced by Finance returned HTTP 200; the journal register, accountant
adjustment, linked reversal and saved-instructions retry controls were present
in the deployed assets. Transient peer/TLS connection failures recovered on
bounded retries.
Next: reviewed statutory tax configuration and accountant statement sign-off.

## Internal company-account transfers — 9 October 2026 (deployed)

Extends Banking and extracts the existing procurement journal writer rather than
creating another ledger. Authorized finance users record an already-completed
transfer with two active company accounts, store, date, bank reference and reason.
An explicit banking.transfer permission is available to administrators and finance
roles; restricted custom-role bases do not inherit it. Both opposite money-ledger
lines, journal, exact retry fingerprint and audit post in one transaction. Account
opening-balance settings are not edited; transfers are not income or expenses and
do not initiate bank payments. Closed/prepared months, shared ledger codes,
foreign/inactive accounts, future dates and unsafe money values are rejected.
Uncertain requests lock their complete payload and survive reload in the same tab.
Existing bank reconciliation and supplier accounting retain the shared ledger.
No new collection, client-write rule, tax rate or historical migration. Guide
updated. Validation passed 354 unit/interface tests, 12 procurement emulator
cases and 35 banking/accounting/security cases (47 distinct emulator/security
passes; one Storage-emulator-only case skipped), typecheck, lint, Functions compilation, production
build, secret scan and diff checks. New assertions verify zero net cash movement
and no income/expense from an internal transfer. The first full unit run hit the
expected stale query-source baseline guard; after the live audit passed 443/443
with all 224 indexes READY, its guarded baseline was refreshed and the full suite
passed. An initial UI lint check required asynchronous session-storage hydration;
that was fixed and relevant tests, lint, typecheck and build rerun.
Source `0288186` is committed/pushed and production safeguards pass. Six existing
functions updated successfully: getMyAccessContext `getmyaccesscontext-00014-qet`,
getAssignableRolePermissions `getassignablerolepermissions-00005-cas`,
saveOrganizationRole `saveorganizationrole-00005-nel`, approveSupplierInvoice
`approvesupplierinvoice-00007-tav`, postSupplierReturn `postsupplierreturn-00008-lat`
and recordSupplierPayment `recordsupplierpayment-00009-xaq`. All retain production
mode, App Check, original runtime identity and invoker settings, 100% traffic and
no reconciliation pending. The new recordCompanyFundsTransfer function is ACTIVE
at `recordcompanyfundstransfer-00001-lur`. Google initially rejected its invoker
policy setup. Following explicit user approval for this service only, the
supported Cloud Run service-level invoker-IAM-disabled setting was applied.
The v2 PATCH rejected revision-name reuse without applying the change; the v1
service annotation update succeeded without a new revision or runtime change.
The endpoint now returns HTTP 401 at Firebase; production mode, App Check,
runtime identity, application RBAC, 100% traffic and no pending reconciliation
were verified. No other service or IAM policy binding was changed.
App Hosting `build-2026-10-09-017` is READY with its rollout SUCCEEDED,
100% traffic and no reconciliation pending. Banking, finance, guide, POS and
procurement return HTTP 200. All 11 scripts referenced by Banking return 200;
the deployed Record completed transfer and Retry saved transfer controls are
present. Transient asset connection failures were retried successfully.
No real financial mutations were used for release checks; authorized behavior
was validated in emulators rather than on live company records.
Next: authorized manual/reversal journals, then reviewed statutory tax rules.

## Linked supplier-return corrections — 9 October 2026 (deployed)

Extends postSupplierReturn and extracts the existing stock-reversal engine for
trusted atomic integration; ordinary stock-only financial reversals stay denied.
Authorized receiving/payables/reversal users can correct one original product
line after confirming the goods are physically back at its original store and
inspected as resellable. Damaged/uncertain goods require inspection/reconciliation. Stock,
serial/batch custody, invoice debt, unused same-store supplier credit, original
receipt/invoice projections, opposite balanced journal and audit commit together.
Original return values, journals, payments and history remain intact. Return
history distinguishes reversed credit and links reversal references. Concurrent
exact retries return the original stock/journal IDs; changed requests are rejected.
Later movements, consumed/refunded credit, closed periods, incomplete evidence
and held-handover credits cannot bypass reconciliation. No new collection, tax
rate, direct-client write rule or IAM relaxation. User guide updated.

Validation: 349 unit/interface cases and 92 distinct emulator/security cases
across sales, inventory, procurement, accounting close and rules. The broad
emulator run passed 89/92; new cases exposed missing test supplier contacts and
an undefined optional scope in the new audit payload. Both were corrected and
all 12 procurement cases passed against rebuilt Functions. Serial restoration
also fixes the older shared reversal cache's lost document reference. Typecheck,
lint, Functions compilation, production build, secret scan and diff checks pass.
Live planner audit passes 443/443, with all 224 indexes READY and no new indexes.
Report UI checks retain their assertions with a bounded five-second asynchronous
wait for debounced rendering under shared emulator/CI load.
Release proof for source `471b1d7`: selected Functions explicitly completed.
`postsupplierreturn-00007-luq`, `getprocurementworkspace-00016-sin` and
`reverseinventorytransaction-00019-mem` are ACTIVE, production mode, App Check
enabled, 100% traffic, no reconciliation pending, unchanged runtime identity
and invoker settings. All three reject unauthenticated calls with HTTP 401.
App Hosting `build-2026-10-09-016` is READY with a SUCCEEDED rollout, 100%
traffic and no reconciliation pending. Procurement, guide, POS, inventory and
all 17 referenced scripts return 200; deployed correction and resellable-
inspection controls are present. Authorized behavior was tested in emulators,
not by mutating real financial records. Earlier attempts failed before upload
on Google API connections. A process-local documented Undici dispatcher with
a 30-second connection timeout and address fallback completed both deployments;
no SDK files, TLS verification, credentials or IAM policies were changed.
Next dependency: authorized manual /
reversal journals and internal company-account transfers, reusing the ledger and
period controls; reviewed statutory tax configuration follows those foundations.

## Multi-product supplier credit notes — 9 October 2026 (deployed)

Extends the existing supplier-return callable, original-GRN validation, inventory
posting engine and credit/advance accounting. Users may collect up to 10 distinct
invoice products (one original receipt / batch each, 50 serials total) under one
supplier credit-note reference. All lines, journals, payable reductions, surplus
credits, original receipt/invoice projections and audit commit atomically. Shared
payable/advance and journal counters are calculated cumulatively, reset on every
transaction retry. Full commercial and stock fingerprints protect exact retries;
partly pre-posted independent lines are rejected. Existing single-product and
held-handover credit remain supported; held goods cannot be issued a second time
through this document. Existing history/photo references remain per line, with an
additive creditDocumentId. No collection migration, extra permission or IAM change.
Validation passed 347 unit/interface tests, inventory/sales/accounting/security
coverage and all 10 procurement emulator cases (437 distinct tests across the
validated suites), typecheck, lint, Functions compilation, production build,
secret scan and diff checks. The broader run passed 89/90; the new unique return-
reference assertion exposed the older compiled function. Rebuilding and rerunning
all 10 procurement cases passed. New return numbers use the retry UUID rather
than the common organization prefix; historical references remain unchanged.
Live planner audit passed 442/442 with all 224 indexes READY; no new indexes.
Release verified: postSupplierReturn revision postsupplierreturn-00005-lij is
ACTIVE with production/App Check retained, unchanged invoker IAM and service
account, 100% traffic and no reconciliation pending; unauthenticated access is
401. App Hosting build-2026-10-09-015 is READY, rollout SUCCEEDED, 100% traffic;
procurement, guide, POS, inventory and all 17 referenced scripts returned 200.
The deployed client includes the multi-product credit-note controls.
Next: linked supplier credit corrections/reversals,
with current settlement and original stock evidence checked, not history edits.

## Customer arrangement credit/advance statements — 9 October 2026 (deployed)

Extends the existing customer-history callable and full-history page. A separate
statement reads each account entry once, avoiding duplicate sale/account-entry
totals. Select all arrangements or a named/inactive arrangement, with mixed
receipts projected to the selected portion. Debt changes and advance movements
are separate; current all-store balances are not mislabeled as dated opening/
closing balances. Store scope and every cursor remain server-authorized. Bounded
scans retain continuation across empty matching pages; no entire-ledger browser
download or guessed historical reassignment. Page export, responsive presentation
and guide included. Unknown/non-proportional classifications require review.
Read-only extension, no migration or new permission. Validation passed 338 unit/
interface tests and 62 emulator sales/accounting/security tests (400 distinct),
typecheck, lint, Functions compilation, production build, secret scan and diff
checks. Live query audit passed 442/442 with all 224 indexes READY; guarded
baseline refreshed only after verification. Release proof for source `14b7a4b`:
Firebase explicitly completed getCustomerHistory and App Hosting deployment.
`getcustomerhistory-00009-rax` is ACTIVE, production mode, App Check enabled,
100% traffic, reconciling false, unchanged service account and invoker settings;
unauthenticated calls return 401. Web `build-2026-10-09-014` is READY, rollout
SUCCEEDED, 100% traffic, reconciling false. Customers, full-history, guide and POS
routes plus all 15 referenced JS assets return 200; statement controls are present.
The first Functions attempt failed before upload on function discovery; retry
completed. Authorized behavior was verified in emulators, not with real financial
mutations. Continuing directly into supplier credit documents.
Next: supplier multi-product credit documents and correction/reversal controls.

## POS customer advance tender — 9 October 2026 (deployed)

Extends the existing POS payment components and customer arrangement balances.
Full-advance payment or one advance component alongside cash/card/transfer and
authorized credit is supported online. Order receiving validates current funds
but holding/receiving/accepting/rejecting does not spend them. Final confirmation
atomically debits advance liability 2210, deducts the selected arrangement's
unused balance, and posts the sale, reservation/release, journal and audit.
The shared customer transaction prevents competing sales, debt applications and
refunds from overspending. Advance tender is not a new bank/till receipt; shift
advance usage is tracked separately from fresh non-cash collections. History
links the advance application to the sale/journal. Offline advance queueing is
blocked; quantity-tracked cash/card offline functionality is retained. Returns
use their existing authorized refund/exchange workflow, without also restoring
the advance. Additive fields only; no historical migration or new permissions.
New sales also retain the direct journal ID, preserving the reverse journal-to-sale
reference. Final validation passed 333 unit/interface tests and all 61 emulator
sales/accounting/Firestore/Storage security cases (394 distinct tests), typecheck,
lint, Functions compilation, production build, secret scan and diff checks.
The first final run exposed the missing direct journal link; the additive fix
and full rerun passed. A test reservation fixture was also isolated correctly.
Live planner audit passed 441/441 with all 224 indexes READY; no new query shapes
or indexes. Release proof for source `095a844`: Firebase explicitly completed
all four selected function updates. `getposworkspace-00013-yig`,
`createpossaleorder-00013-has`, `commitpossale-00018-xuq` and
`confirmpossaleorder-00019-bay` are ACTIVE, production mode, App Check enabled,
100% traffic and reconciling false. Runtime service account and existing invoker
settings unchanged; all four endpoints return HTTP 401 without authentication.
App Hosting `build-2026-10-09-013` is READY, rollout SUCCEEDED, 100% traffic and
reconciling false. POS, Guide, Customers, Returns and all 16 referenced JavaScript
assets return 200; the new advance control and guide instructions are present.
Initial Functions/web attempts failed before upload on intermittent Google API
requests; retries completed. Authorized financial behavior was tested in
emulators, without real financial mutations. Next: arrangement statements.

## Atomic sales-order confirmation — 9 October 2026 (deployed)

Safety dependency before direct POS advance tender. Final confirmation now reads
the accepted order and posts its completion, sale, stock/reservation, journal,
notification and audit within the same Firestore transaction. A concurrent
rejection cannot leave a rejected order with posted inventory/accounting. New
checkout operations fingerprint all sale instructions and the linked order;
new sales retain the order ID. Existing pre-change posting recovery is retained
without rewriting old transactions. No new collections, permissions or indexes.
Regression checks cover completion-write failure rollback, exact retry,
changed-instruction replay denial and confirmation-versus-rejection races for
immediate collection and reservations. Final validation passed 330 unit/interface
tests, all 59 emulator sales/accounting/Firestore/Storage security cases,
typecheck, lint, Functions compilation, production build, secret scan and diff
checks. The initial emulator run used an earlier compiled function for the final
legacy-reference assertion; rebuilding and the clean sequential full rerun
passed. Live planner audit passed 441/441 with all 224 indexes READY; unchanged
query catalog, guarded source baseline refreshed after readiness verification.
Release proof for source `f0113c8`: Firebase explicitly completed both affected
functions. `commitpossale-00017-nag` and `confirmpossaleorder-00018-zaj` are ACTIVE,
production mode, App Check enabled, 100% traffic and reconciling false. Existing
invoker settings and runtime service account unchanged. One initial deployment
failed before upload checking a Google service identity; retry succeeded.
Both endpoints reject unauthenticated requests with Firebase HTTP 401.
No web source changed, no new indexes/IAM relaxation or real financial mutations.
Authorized financial behavior was tested in emulators. POS advance tender is
next, followed by arrangement statements.

## Customer unused-advance refunds — 9 October 2026 (deployed)

Extends existing customer payments, arrangements, advance balances and journals;
no second customer-account module. Authorized customer-payment/return-approval
staff record actual refunds, a reason and the paying company account/reference
for non-cash payments. Refunds debit customer advances (2210) and credit the
selected money account. Debt/invoice allocations, sales income, VAT and stock
remain unchanged. Inactive customers/arrangements can receive existing money
owed. Shared advance-balance transactions prevent concurrent refund/application
overspending. New operations fingerprint instructions; old valid receipt retries
remain supported without allowing a receipt to become a refund. Refund entries
link the payment, journal, arrangement allocations and audit; customer history
uses plain language and red outflow styling. Additive fields only.

Scope: existing organization-wide customer advances, recording an outgoing
payment in the selected store. Cash uses the store cash-on-hand ledger, not a POS
till shift. No historical store ownership of advances is guessed. Direct POS
advance tender and arrangement-filtered statements remain the next dependencies.
Sequential emulator validation passed all 57 sales/POS, accounting/daily-close
and Firestore/Storage security cases, including all three refund cases. An extra
isolated run verified the refund's cash-flow and balance-sheet movements and
unchanged income statement. The earlier parallel run timed out starting an
existing shift-close function; the full sequential rerun passed. Live planner
audit passed 441/441, all 224 indexes READY, existing query shapes unchanged;
the guarded source baseline was refreshed only after this verification. Final
validation passed 330 unit/interface tests and 57 emulator/security cases (387
distinct tests), typecheck, lint, Functions compilation, production build, secret
scan and diff checks.

Release proof for source `ac6a9e3`: Firebase explicitly completed
`recordCustomerPayment`, revision `recordcustomerpayment-00009-xef` ACTIVE,
production mode, App Check enabled, 100% traffic and reconciling false. Runtime
service account and existing invoker settings unchanged; unauthenticated calls
return Firebase HTTP 401. App Hosting `build-2026-10-09-012` is READY, rollout
SUCCEEDED, 100% traffic and reconciling false. Customers, Guide, POS, Returns and
all 16 referenced JavaScript assets return 200; refund and reference controls
are present. Initial deployment attempts failed before upload on intermittent
Google API connection checks; retries completed without permission changes.
Authorized financial behavior was tested in emulators, not real business records.

## Linked supplier replacement receipts — 9 October 2026 (deployed)

Extends the existing approved-return follow-up and handover settlement panel.
Physically inspected same-product replacements restore stock and original held
cost (Dr inventory / Cr cost of sales), preserving existing reservations and
customer-sale history. No purchase invoice, payable, cash or VAT is invented.
Partial replacement receipts and supplier credits share transactional quantity
and cumulative-penny cost limits. Serial receipts verify original supplier custody,
accept a new unique serial or the exact returned original unit, retain original
serial history and link both units to the receipt. Existing private receiving
photo controls support the replacement receipt; no direct client photo access.
Server permission checks, open accounting periods, immutable linked stock/journal/
audit evidence and payload-fingerprinted retries protect posting. Stock-only
reversal is blocked. Additive fields only; no historical migration required.

Scope: same product, verified handover, same store, quantity/serial tracking.
Different-product/value exchanges and batch-specific receipts need reviewed
corrections; this is not automatic fulfilment of a previously refunded sale.
Latest receipt photos are surfaced in the panel; full product ledger retains
all receipts. Validation: 328 unit/interface tests and 72 distinct procurement,
POS/sales, aftersales/financial and Firestore/Storage security cases passed across
the full runs and final targeted reruns (400 unique tests). Includes exact new
serial custody, private receiving evidence, original-cost pennies, concurrency,
credit-versus-replacement mutual exclusion, reservation preservation, accounting
locks, stock-only reversal denial and receiving permission on idempotent replay.
The new supplier-race test fixture required a contact number before it could
exercise settlement; its corrected final run passed. Live read-only audit passed
441/441 query shapes; all 224 indexes READY. Typecheck, lint, Functions compilation,
production build, secret scan and diff checks passed.

Release proof for source `dae41ff`: Firebase explicitly completed all five
affected Functions and App Hosting `build-2026-10-09-011` (READY, rollout SUCCEEDED,
100% traffic, reconciling false). Live revisions `approvesalereturn-00017-ras`,
`getprocurementworkspace-00015-buk`, `reverseinventorytransaction-00018-xow`,
`getaftersalesworkspace-00009-haw`, `getsalereturnworkspace-00012-zif` are ACTIVE,
100% traffic, APP_ENV production and App Check enabled. Existing invoker settings
and runtime service account are unchanged. All five reject unauthenticated calls
with Firebase HTTP 401. Aftersales, Procurement, Guide, POS and Returns and all
18 referenced JavaScript assets return 200; replacement controls, settlement and
guide markers are present. Two initial deployments failed before uploading due
to intermittent Google API connectivity; the IPv4-first retry completed normally.
No new IAM relaxation, indexes, migration or real stock/financial mutations.
Authorized behavior was exercised in emulators, not live business records;
physical staff acceptance remains separate.

Next dependency: remaining customer advance tender/refund and statements,
then multi-line supplier correction documents, accounting/tax, services/provider
payables, document conversions/analytics, budgets/HR and final acceptance.

## Supplier credit for held-goods handovers — 9 October 2026 (deployed)

Aftersales handovers now offer a live, permission-controlled supplier credit
settlement panel, paged original invoices (including paid invoices), original
invoice lines/GRNs, partial credits and exact serial verification. Extends the
existing supplier-return callable, credit-note locks, supplier account entries,
receipt/invoice counters and balanced journals; no duplicate settlement system.
Already handed-over goods are not issued from stock twice. Original-cost recovery
credits COGS rather than inventory; original invoice VAT/price snapshots and
cumulative rounding determine the credit. Payables reduce first, excess becomes
supplier credit. No bank receipt or cash refund is invented. Handover settlement
counters, financial records and audit events commit atomically with retry safety.
Additive fields only; historical custody/stock/journal entries are preserved.

Scope: verified same-store original purchase evidence, quantity/serial products.
Cross-store/legacy warehouse evidence and differing negotiated credit values
require accounting reconciliation; no automatic interbranch clearing is invented.
Next: linked warranty replacement receipt (partial quantities, original-cost
restoration, replacement serial evidence and mutual exclusion with credits).

Validation: 326 unit/interface tests and 42 procurement, POS/sales and
aftersales/financial emulator cases passed. Covers partial original-cost/VAT
rounding, paid-invoice surplus credit, exact original GRN/serial evidence,
concurrent settlement, retry fingerprints, closed periods, wrong-store denial,
unchanged physical stock and shared purchase credit limits. The existing POS
return test now selects the original sale's till instead of an arbitrary open
till, preventing nondeterministic negative test cash. Typecheck, lint, Functions
compilation and production build passed. Live read-only query audit: 441/441,
all 224 indexes READY; existing indexes cover the paged invoice query.
All 27 Firestore/Storage security cases also passed, including direct-write
denial for forged handover counters and financial credits (395 unique tests).

Release proof for implementation `6f41d04`: Firebase explicitly completed
`postSupplierReturn`, `getProcurementWorkspace`, `approveSaleReturn` and App
Hosting `build-2026-10-09-010`. The build is READY at 100% traffic, reconciling
false. Live Function revisions `postsupplierreturn-00004-puv`,
`getprocurementworkspace-00014-fiw`, `approvesalereturn-00016-quc` are ACTIVE at
100% traffic, APP_ENV production, App Check true, same service account and
unchanged invoker IAM-disabled settings; all reject unauthenticated calls (401).
Aftersales, Procurement, Guide, POS and Returns return HTTP 200; all 18 referenced
JavaScript assets return 200 and include the new settlement controls/guide text.
No new IAM relaxation, index deployment, historical migration or real stock/
financial posting was performed. Authorized business mutations were validated
in isolated emulators, not against live customer/supplier records. Physical
staff acceptance of the new workflow remains a separate operational check.

## Controlled held-return disposition — 9 October 2026 (deployed)

Extends the existing approved return → aftersales link, without migrating or
rewriting history. Completed/cancelled linked cases offer partial restock,
scrap or physical supplier handover. Restock requires explicit inspection and
posts original-cost inventory/COGS restoration atomically. Other outcomes
record custody without reducing saleable stock or expensing goods twice.
Exact serial ownership, cumulative quantities/costs, retry fingerprints,
period locks, scope/permissions and linked audit events are enforced server-side.
Stock-only reversal is blocked to preserve case and financial integrity.
Recent case history is bounded to 20; full evidence remains append-only.
Supplier handover deliberately does not invent a supplier financial credit.
Validation: 323 unit/interface tests, 12 aftersales/financial and 22 existing
POS/sales emulator cases, and 27 Firestore/Storage security cases passed.
Partial original-cost penny allocation, exact serial ownership, concurrent
disposition, retry fingerprints, closed accounting periods, reservation
preservation, stock-only reversal denial and forged history are covered.
Report assertions include non-cash COGS restoration without cash/VAT changes.
Typecheck, lint, Functions compilation, production build, secret/diff checks
passed. Live index audit: 441/441 query shapes passed, all 224 indexes READY.
Implementation `337ded1`: Firebase explicitly completed all three Function
updates and App Hosting `build-2026-10-09-009`, READY at 100% traffic with no
reconciliation pending. ACTIVE revisions: `approvesalereturn-00015-kos`,
`getaftersalesworkspace-00008-sos`, `reverseinventorytransaction-00017-vac`,
each at 100% traffic. Production/App Check/runtime account and pre-existing
invoker settings are preserved; unauthenticated probes return 401.
Live Aftersales, Returns, Guide, POS and Products routes returned HTTP 200;
all 20 linked JavaScript assets returned 200 and contain the new controls,
full product-history link and guide instructions. No real stock/financial
mutation was made; signed-in live posting and physical acceptance remain
separate from emulator validation and release verification.
Next: link actual supplier credit-note/replacement settlement to held handovers.

## Inspected returns to aftersales — 9 October 2026 (deployed)

Approved warranty/repair returns can explicitly create a linked existing-system
aftersales case per returned serial, or per quantity line. Deterministic links
and transactional idempotency prevent duplicate cases. Walk-in service contacts
are captured without rewriting the original sale or duplicating customers.
Routing and service completion do not change held stock, refund money, or decide
warranty eligibility. Service charges remain separately authorized and auditable.
Direct case links are store/organization scoped. No historical migration needed.
Validation: 320 unit/interface tests, 32 sales/aftersales emulator cases and
27 Firestore/Storage security cases passed. Includes concurrent distinct-key
routing, exact held serials, store denial, walk-in contacts, unchanged stock and
journals, immutable original identity, retry payloads and forged-link denial.
Live query audit: 440/440 passed, all 224 deployed indexes READY. Typecheck, lint,
Functions compilation, production build, secret scan and diff checks passed.
Implementation `a3bae7c`: Firebase explicitly completed both Function updates and
the web rollout. App Hosting `build-2026-10-09-008` is READY with 100% traffic and
no reconciliation pending. Active revisions: `approvesalereturn-00014-mag` and
`getaftersalesworkspace-00007-neg`; production/App Check/runtime account and
existing invoker settings are preserved. Unauthenticated callable probes return
401 UNAUTHENTICATED. Signed-in live business posting was not performed; emulator
acceptance and deployment verification are not a claim of physical/live acceptance.
Live Returns, Aftersales, Guide and POS routes returned HTTP 200; all 16 linked
JavaScript assets loaded successfully and contain the new routing controls,
return-origin details and guide instructions. No real stock/financial posting
was made during live verification.
Next: controlled final disposition of held goods after service; never automatic restocking.

This roadmap extends the existing Firebase application and preserves historical users, stock entries, sales, journals and audit records. A requested capability is not marked complete merely because a screen or a partial workflow exists.

### Receiving / customer-return inspection photos — 9 October 2026 (deployed)

Extends the same private, append-only operational evidence controls onto existing
`purchaseReceipts` and `saleReturns`, without duplicate inventory, returns or
media systems. Receiving staff open the posted GRN from Receiving history;
authorized return inspectors expand the submitted physical return's evidence.
Receiving photos validate exact serials, product, quantity and original posted
stock movement; return photos validate the return's recorded serials. Photo
uploads do not receive stock, complete inspection, approve returns or issue money.
Posted return evidence stays readable; new uploads after approval are denied,
while an identical successful-but-unacknowledged request remains retryable.
Reservation cancellations do not accept physical-return inspection evidence.

Existing organization/location permissions, private Storage generation/hash checks,
20-photo cap, 2 MB JPEG/PNG validation, metadata and audit linking remain enforced.
No historical records, financial entries, indexes or security rules are rewritten.
Camera/device and signed-in live business acceptance remain separate.
Validation: 318 unit/interface tests, 15 procurement/aftersales/evidence emulator
cases and 27 Firestore/Storage security cases passed. Typecheck, lint, Functions
compilation, production build, secret scan and diff checks passed; the live index
audit passed 440/440 with all 224 indexes READY. A cold-start emulator discovery
timeout was retried with a longer startup allowance. The existing complimentary
service test now compares before/after ledger counts instead of assuming empty
data; its complete eight-case suite passed on rerun.

Release implementation `8ebf7e9`: Firebase explicitly completed all three scoped
Function updates and App Hosting rollout. Web `build-2026-10-09-007` is READY,
serving 100% of traffic with no reconciliation pending. Active revisions:
`getaftersalesworkspace-00006-san`, `getprocurementworkspace-00013-qul`, and
`getsalereturnworkspace-00011-yeq`. All retain production environment, App Check,
the existing runtime service account and unchanged invoker settings. Each live
unauthenticated evidence probe returns 401 UNAUTHENTICATED; this verifies auth
rejection/reachability, not signed-in transaction acceptance.
Live Purchasing, Returns, Guide and POS routes and their JavaScript assets return
HTTP 200. Served Purchasing/Returns bundles contain the new receiving and return
evidence controls; the guide contains original-stock-ledger receiving instructions.
No real inventory or financial postings were made for live release verification.
Next: link inspected warranty/repair dispositions to existing aftersales cases,
preserving quarantined stock and avoiding duplicate cases on retries.

### Supplier / aftersales serial photos — 9 October 2026 (deployed)

Existing supplier returns and warranty/non-warranty cases now accept private
append-only JPEG/PNG evidence (2 MB each, 20 per record). Aftersales captures
intake, diagnosis and handover against the current case status; supplier evidence
supplements already-posted physical returns. Exact serials must match the record.
Return history carries only a serialized flag, not potentially thousands of
serials on each row. Operators enter the photographed unit's serial on demand;
the server verifies it against the recorded return.
These photos document an operator-confirmed reference, not automatic warranty
eligibility, OCR verification, collection confirmation or a new inventory posting.

Reuses existing photo validation, Firebase Storage, workspace callables, RBAC and
audit. Metadata lives under each original record's server-only `evidence`
subcollection. A transaction atomically links immutable metadata, parent IDs and
audit; original stock and journal postings remain untouched. Generation-qualified
private reads check organization, location and hash. No public download tokens,
new endpoints, index changes or IAM relaxation. Interrupted uploads retain the
same reference for retry, even after a subsequent workflow status change.

Objects saved before an interrupted metadata link remain private; no automatic
deletion/retention policy is invented. These are optional post-record evidence
attachments, not a prerequisite that blocks operations. Camera/device and signed-in
live transaction acceptance remain separate. Next: the same controlled serial/photo
evidence at goods receiving and customer-return inspection, reusing existing
receipt/inspection records and preserving their inventory/accounting boundaries.

Validation passed: 316 unit/interface tests, all 13 aftersales/financial/procurement
emulator cases and all 27 Firestore/Storage security cases. Includes exact-unit and
stage validation, retries after status changes, immutable private reads, tampered
object rejection, cross-organization/store denial, read-only actor denial and no
stock/journal effects from uploads. Existing supplier returns/credits/advances,
service payments and large-ledger statements passed regression checks. Typecheck,
lint, Functions compilation, production build, secret scan and diff checks passed.
The live query audit passed 440/440; all 224 indexes are READY. The final bounded
history regression also passed in the procurement emulator.

Release: implementation `7924bc2`, bounded-history correction `7f908d5`.
App Hosting `build-2026-10-09-006` is READY, serving 100% of traffic with
`reconciling=false`. Both workspace Functions are ACTIVE: aftersales revision
`getaftersalesworkspace-00005-nup`, procurement `getprocurementworkspace-00012-diw`.
Production environment and App Check remain enabled; pre-existing invoker settings
are unchanged. Both live unauthenticated evidence probes return 401
UNAUTHENTICATED (reachability/authentication checks, not signed-in acceptance).
The web CLI printed Deploy complete, then an unexpected exit error; independent
App Hosting build/traffic verification confirms the rollout completed.
Live `/aftersales`, `/procurement`, `/guide` and `/pos` returned HTTP 200;
their script assets loaded successfully. Aftersales/procurement bundles contain
the evidence actions and corrected returned-serial input, and the served guide
contains the serial-validation instructions. Physical camera and signed-in live
business acceptance remain unverified; no real stock or financial postings were
created for these release checks.

### Serialized POS ownership — 9 October 2026 (deployed)

Extends existing `serializedItems`, sales, collection and return transactions;
there is no parallel stock or customer system. Online POS captures exact serials
(one per unit, maximum 50 per order). Holding/receiving an order does not reserve
units. Final confirmation atomically validates and reserves or releases them.
Partial collection accepts only the owning invoice's uncollected serials;
cancellation releases only its uncollected reservation. Inspected resellable
returns restore the exact units/costs; other dispositions leave serials held,
inactive and unavailable. Original sale/return/collection evidence is retained.

Per-unit inventory entries carry serial identity and exact historical cost;
linked journals use the summed unit costs rather than rounded averages. Invoice
and actual-handover waybill show allocated/collected serials. Held baskets retain
serial drafts, with revalidation on confirmation. Quantity-only offline POS
remains supported; serialized sales explicitly require internet ownership checks.
Inventory moves/transfers cannot bypass sales reservations, and stock-only
reversal of sale/reservation/collection postings is blocked.

Guide, regression coverage and live query-audit baseline are updated. Local
validation passed: 312 unit/interface tests, all 22 sales cases (21 in the full
run and the new serial case on focused rerun), 17 inventory cases, the legacy
serial-transfer journey, 11 simplified-transfer cases and 27 Firestore/Storage
security cases. The final affected UI subset passed again after layout refinement.
Typecheck, lint, Functions compilation, production build, secret scan and diff
checks passed. Live query planning passed 440/440; all 224 indexes are READY.
Concurrent emulator temporary-file interference was resolved using isolated ports
and a private temporary directory; no application checks were bypassed.
Release verified at 09:36 UTC: implementation `3f3ce31` is pushed. Firebase
explicitly completed all 12 scoped Function updates and the web rollout. All are
ACTIVE, `APP_ENV=production`, App Check enabled, with existing invoker-IAM-disabled
settings unchanged. App Hosting `build-2026-10-09-004` is READY with 100% current
traffic and no reconciliation pending. Live POS, Returns and Guide routes and
their 12/11/11 JavaScript assets return HTTP 200 and contain the deployed serial
workflow markers. Unauthenticated posting probes return 401 UNAUTHENTICATED;
these establish reachability/auth rejection, not signed-in business acceptance.
No real financial or inventory postings were made during live verification.
No historical data migration or index/rules/IAM relaxation is required. Physical
device/camera acceptance remains separate. Next: serial/photo evidence coverage
for supplier returns and warranty/repair handoffs, reusing existing workflows.

### Private collection photos — 9 October 2026 (deployed)

The existing POS collection queue accepts optional JPEG/PNG evidence (five per
collection, 2 MB each), with device camera capture where the browser supports it.
Each photo identifies its product, capturing user, upload time, hash and immutable
Storage generation. Upload and read actions reuse the existing confirmation and
sale-document callables. Direct client Storage/metadata access remains denied;
there are no public tokens or signed download links.

Photo uploads never post stock or accounting. A collection transaction claims
only its releasing user's unlinked photos for included products, atomically with
the stock movement, balanced journal, collection record and audit. Exact retries
remain safe, including fingerprints issued before photos existed. Authorized
sale readers can view linked photos from the invoice collection record.

Unattached/interrupted uploads remain private and are not automatically deleted;
retention/cleanup requires an explicit reviewed policy. This is collection-photo
evidence, not a complete serialized-product POS workflow. POS retains its
quantity-only guard. Next: controlled serial allocation through reservations,
collection, cancellation and inspected returns. Physical camera/device acceptance
and signed-in live postings must not be inferred from automated tests.

Local validation: 305 unit/interface tests, typecheck, lint, Functions compilation,
production build, secret scan and diff checks passed. The complete sales emulator
suite passed all 21 tests, including private upload/read, idempotent replay,
wrong-user attachment, cross-organization read denial and photo reuse rejection.
The live planner audit passed 440/440 query shapes; all 224 indexes are READY and
the guarded source baseline is refreshed. No index or IAM changes are required.
All 26 Firestore/Storage security tests passed, including denial of direct photo
metadata/object access to administrators, managers and cashiers (47 combined
sales/security tests, none skipped).

Release verified at 08:40 UTC: implementation `0204875` is pushed; Firebase
explicitly completed both endpoint updates and the App Hosting rollout. Both
Functions are ACTIVE, `APP_ENV=production`, App Check enabled, with their existing
invoker-IAM-disabled settings unchanged. Ready revisions are
`confirmpossaleorder-00016-fey` and `getsaledocument-00011-qec`. The existing
runtime project role already contains the necessary Storage object permissions;
no IAM grant or Storage-rules relaxation was made.

App Hosting `build-2026-10-09-003` is READY at 100% traffic, not reconciling.
POS and guide return HTTP 200; all 12 served POS script bundles load, and the
combined scripts contain photo upload, product selection and secure-view actions.
Both endpoints reject unauthenticated photo requests with Firebase JSON HTTP 401
UNAUTHENTICATED. This proves reachability/rejection, not a signed-in live upload
or collection. Authorized posting and photo-integrity behavior were exercised in
the emulator; no real financial or stock records were posted for verification.

### Collection follow-up — 9 October 2026 (deployed)

The existing scheduled notification worker now performs a bounded, resumable
25-sale scan for uncollected reservations. After seven complete days it queues
one reminder per invoice per week to active, in-scope stock-release staff via
the existing bell/browser-push delivery. Debt and collection reminders use
separate inbox identities. Completed/cancelled collections supersede queued
reminders. Missing historical reservation dates are not invented. No reminder
cancels a reservation, posts a journal or changes inventory.

Collection mutations now fingerprint submitted quantities, collector and notes;
changed-payload retries are rejected. The UI locks an uncertain submission and
retries the same payload/key, while definitive validation failures permit edits.
Historical idempotency records retain their existing replay interpretation.

The collection queue displays days waiting alongside the reservation date.
Validation: 289 unit/interface tests passed (the live-audit baseline gate was
explicitly excluded from this local run and remains blocking); focused final
notification/collection tests passed. All 25 Firestore security tests passed.
After an emulator reload interrupted the first combined run, a clean restart
passed all 20 sales tests, including reminder cursor/deduplication, recipient
scope, stale reminders, partial collection, changed-payload replay and competing
release checks. Typecheck, lint, Functions compilation, production build, secret
scan and diff checks passed.

Release validation resumed after owner-controlled Firebase reauthentication:
all 440 live query plans passed and all 224 indexes are READY. No new index is
required; the guarded baseline has been refreshed. The full unit/interface suite
now passes all 299 tests, including the live-audit baseline gate.

Release verified: source `4d3bcdb` is pushed. Firebase explicitly completed
deployment of `confirmPosSaleOrder`, `deliverPendingNotifications` and App Hosting.
Both Functions are ACTIVE with APP_ENV=production and App Check enabled; ready
revisions are `confirmpossaleorder-00015-mem` and
`deliverpendingnotifications-00017-vuh`. No IAM settings were changed.
The collection endpoint returns Firebase JSON HTTP 401 UNAUTHENTICATED without
credentials; this confirms reachability/rejection, not a live authorized posting.
App Hosting `build-2026-10-09-002` is READY, serves 100% of traffic and is no
longer reconciling. POS and guide routes return HTTP 200; served POS JavaScript
includes the retry action, waiting-age display and reminder explanation. No real
financial/stock postings were performed for verification; authorized workflow
behavior is covered by emulator tests.

Next dependency: serial allocation through order/reservation/release and secure
photo uploads. Current POS explicitly accepts quantity-tracked products only;
Storage rules deny all uploads. Do not present a free-text serial or unverified
photo URL as controlled serial evidence. Release-linked waybills already exist.

### Posted-order corrections — 9 October 2026 (deployed; full-reissue scope)

Returns now has an expandable full return/cancellation-and-reissue correction
register, with original/proposed snapshots, reasons, permission-scoped review,
rejection history and bounded 25/50/100 cursor pages. Approval never posts stock
or accounting. Completion verifies a full original reversal posted after approval,
the matching replacement customer/items/quantities/prices/discount, balanced
posted journals and unique transaction links. Existing return inspection,
reservation cancellation and POS remain the only posting engines. Server-owned
evidence locks and fingerprinted retries prevent duplicate linking. Original
sale/journal/audit records are preserved; schema changes are additive.
Orders already partially returned/cancelled before approval require an
accountant-assisted correction; they cannot enter a fresh full-reissue plan.

Validation: 297 unit/interface tests, 44 combined sales/security emulator cases,
and a self-contained focused emulator rerun passed. The latter exercises prior
return guards, invalid discounts, unauthorized review, changed-payload retries,
duplicate requests, mismatched replacements, unbalanced journals and replay-safe
completion. Typecheck, lint (including final changed-file checks), Functions
compilation, production build, secret scan and diff checks passed. All 224 live
indexes are READY and 439/439 live query plans passed; no new index was needed.
The guarded query-audit baseline has been refreshed;
no signed-in live financial posting or real-data migration was performed.

Release verified: implementation `e973764` and source checkpoint `957778e` are
pushed. The initial Function creation reached ACTIVE but failed to set public
invoker IAM policy. The owner subsequently explicitly approved disabling Cloud
Run invoker IAM checks for `salesCorrections` only. That scoped update completed
successfully; Cloud Run revision `salescorrections-00002-swm` is ready, with
invokerIamDisabled=true, APP_ENV=production and App Check enabled. No other
service IAM settings were changed. The public callable probe now returns
Firebase JSON HTTP 401 UNAUTHENTICATED, not the preceding IAM HTTP 403. Firebase
Auth and server permission/scope checks remain in place. Authorized workflow
behavior is covered by emulator tests, not a signed-in live financial posting.

Firestore rules compiled and were released. Firebase explicitly reported the
App Hosting rollout and deployment complete. `build-2026-10-09-001` is READY,
serves 100% traffic and is no longer reconciling. Returns, POS and the guide each
return HTTP 200; the served Returns JavaScript contains the new correction
interface and callable. All 224 indexes remain READY. No real financial/stock
records were modified during verification. The changes are additive and do not
rewrite historical stock, sale, journal or audit records.

Scope remains partial: standalone monetary debit/credit notes, payment-only or
serial/delivery amendments, partial correction plans and automated held-stock
aftersales routing are not implemented by this screen. No fictitious returns
should be used for paperwork changes. The user guide explains this boundary.
Next dependency: serial evidence at collection and uncollected-stock reminders.

### Customer returns inspection and exchange difference — 8 October 2026 (deployed)

Existing return callables now require explicit per-item inspection before goods
return approval. Resellable goods alone can replenish saleable stock; damaged,
defective, warranty, repair, scrap and supplier-return dispositions remain recorded
on the return and must be held separately. This is not an automated quarantine
stock valuation or aftersales-case creation workflow. Reservation cancellation
does not require goods inspection. Historical approved returns remain unchanged;
older pending goods returns require inspection before posting.

Replacement sales reference the original return and sale, and newly issued named-customer
credits cannot be redeemed against a different customer. Existing split tender
settles a higher replacement price. A cheaper replacement's unused exchange
credit can be retained or refunded through the existing approved-return register,
with an explicit company account or open store till. Refund, credit balance,
till cash, balanced liability/cash journal and audit commit atomically. Retry
fingerprints prevent duplicate or changed-payload execution. Closed accounting
periods block posting. Generic stock-only reversal of customer returns is blocked.
The register has bounded 25/50/100 cursor pages and the user guide covers the flow.

Validation passed: 295 unit/interface tests, 18 sales emulator cases and 25
Firestore security cases (43 combined), typecheck, lint, Functions compilation,
production build, secret scan and diff checks. All 224 live indexes are READY;
436/436 live query plans passed and the guarded baseline was refreshed.

Source `291965b` is deployed. The seven affected existing Functions completed
their updates and report ACTIVE, production mode and App Check enabled. All seven
unauthenticated probes return Firebase JSON HTTP 401 UNAUTHENTICATED. No service
IAM configuration changed. App Hosting `build-2026-10-08-008` is READY, serves
100% traffic and is no longer reconciling; the rollout explicitly completed.
Returns, POS and the guide return HTTP 200. Signed-in live financial posting was
not exercised; demo emulator cases provide workflow and authorization evidence.
No real financial/stock records were created for release verification.

Migration is additive; no historical stock, Auth, sale, journal or audit records
are rewritten. Next priority: posted-order correction requests with linked stock
and accounting reversals. Serial evidence/collection reminders and automated
non-saleable-stock disposition remain separate inventory follow-up work.

### Supplier goods returns and credit notes — 8 October 2026 (deployed)

Purchasing now has **Returns & credit notes** on approved/settled supplier invoices.
One product/batch from one original GRN can be fully or partially returned per note.
The trusted `postSupplierReturn` transaction validates original receipt stock evidence,
serial ownership, available stock, invoice quantities, store scope, receiving and
payable-approval permissions, accounting period and duplicate credit-note references.
Stock, cumulative return projections, supplier payable/credit, balanced journal and
audit commit together. Same-key retries cannot post twice. Original invoice amounts,
payments and ledger entries are preserved. Stock-only reversal of either the return
or its supporting receipt is blocked after a linked credit note.

Credit reduces the original invoice's unpaid balance first; excess uses the existing
supplier advance/credit asset and store-scoped application/refund workflow. A refund
is recorded only when money is actually received, with its receiving company account.
Original invoice VAT snapshots are allocated cumulatively to avoid rounding drift.
Inventory valuation differences post explicitly to account 5010. No statutory rate
changes are introduced. Return history and receipt selection use bounded cursor pages.

Migration is additive: absent returned-quantity/amount projections mean zero; no
historical quantities, invoice values, Auth users or journals are rewritten. Existing
receipts without matching original stock evidence require reconciliation, not guessed
links. New supplier-return records and control locks are server-only. This release
does not introduce multi-product atomic credit documents or a linked return-correction
screen; those remain explicit follow-up work, not a reason to use generic stock reversal.

Source `8ce2b83` passed 292 unit/interface tests, 54 targeted emulator/security/E2E
checks, typecheck, lint, Functions compilation, production build, secret scan and
diff checks. All 224 indexes are READY and 436/436 live query plans passed. The
additive Firestore rules are deployed. The twelve existing affected Functions
updated successfully and are ACTIVE. The new `postSupplierReturn` service is
ACTIVE on revision `postsupplierreturn-00002-nin`, in production mode with App Check
enabled. After explicit owner approval, the Cloud Run invoker IAM check was disabled
for `postSupplierReturn` only. The service remains READY, and an unauthenticated
probe now reaches Firebase and receives JSON HTTP 401 UNAUTHENTICATED. Firebase
Auth, App Check and server permission checks remain enforced. No other service's
invoker check was changed. App Hosting `build-2026-10-08-007` is READY, serves
100% traffic and is no longer reconciling. Purchasing and the user guide return
HTTP 200. The Functions update and web rollout both explicitly completed. No live
financial/stock test postings were performed during verification; signed-in live
financial acceptance remains unexercised, with demo emulator tests providing the
workflow and authorization evidence.

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

### Supplier unused-advance refund — 8 October 2026 implementation

The existing supplier-payment mutation, statement, permissions, company-account
resolver and audit system now support receiving unused advances back from a
supplier. Refunds require an explicit amount, recording store and reason; non-cash
receipts require the receiving company account and reference. They debit cash/bank,
credit supplier advances (1250), and leave invoice debt and stock unchanged.
Store-scoped/global advance guards and idempotent transaction posting protect
against duplicate or competing refunds. Inactive suppliers may refund existing
money. The existing journal-derived daily reconciliation includes cash receipts.
No migration/history rewrite or additional permission/IAM change is required.
The supplier UI and user guide distinguish this from goods returns. Validation
passed: 282 unit/interface tests, six procurement emulator cases and 25 security
tests; typecheck, lint, Functions compilation, production build, secret scan and
diff checks passed. The live query audit passed 432/432 shapes with all 222 indexes
READY before refreshing the guarded baseline.

Release source `305fb66` is deployed. `recordSupplierPayment` revision
`recordsupplierpayment-00008-hog` is ACTIVE with App Check enabled. App Hosting
`build-2026-10-08-006` is READY, not reconciling, and serves 100% of traffic;
Firebase reported explicit deployment completion. `/procurement` and `/guide`
returned HTTP 200, and an unauthenticated callable probe returned Firebase JSON
401. Authorized financial behavior was verified in the emulator, not by posting
test refunds into live company data. No IAM changes were made. Initial Google API
request failures occurred before rollout; subsequent deployments completed.
Physical supplier returns and linked credit-note settlement remain unfinished.
The broader remaining roadmap is not complete.

### Atomic stock/financial integration foundation — 8 October 2026

The shared inventory engine now has a trusted, optional linked-posting extension.
Business-document reads happen before writes, and linked financial writes commit
in the same Firestore transaction as stock, audit and idempotency. Callbacks use
ledger-calculated movement cost; they do not execute on committed replay. Existing
callers remain unchanged. This is not a supplier goods-return screen or completed
credit-note workflow. Original invoice/receipt validation, partial-return VAT
apportionment, serialized return lifecycle, credit allocation and the user-facing
workflow remain the next implementation slice.

Validation passed: 284 unit/UI tests; 52 emulator/security cases across the
inventory, transfer, procurement and security runs (the new atomic case passed
in isolation after correcting test-fixture setup). Typecheck, lint, Functions
compilation, production build, secret scan and diff checks passed. The live audit
passed 432/432 query shapes with all 222 indexes READY before baseline refresh.
No new query shapes, schema migration, client permission or IAM change is needed.
Source `7bb67e1` is committed and pushed, and clean production preflight passed.
The initial release attempt stopped before upload on expired Firebase credentials.
After user-controlled reauthentication, the backend-only deployment completed
explicitly. All ten stock-engine consumers are ACTIVE with App Check enabled;
the Functions API reported no unreachable regions. No IAM changes were made.

| Function | Verified deployed revision |
| --- | --- |
| postOpeningStock | postopeningstock-00014-tek |
| postInventoryReceipt | postinventoryreceipt-00014-hov |
| moveInventoryBetweenLocations | moveinventorybetweenlocations-00014-nes |
| postStockAdjustment | poststockadjustment-00014-lir |
| postStockCount | poststockcount-00014-ceh |
| receivePurchaseOrderItem | receivepurchaseorderitem-00009-voc |
| confirmCsvImport | confirmcsvimport-00015-mew |
| confirmTransferDispatch | confirmtransferdispatch-00015-huz |
| confirmTransferReceipt | confirmtransferreceipt-00015-xiq |
| resolveTransferDiscrepancy | resolvetransferdiscrepancy-00014-xaz |

Live `postInventoryReceipt` and `receivePurchaseOrderItem` probes returned Firebase
JSON 401 UNAUTHENTICATED. These confirm endpoint/auth barriers, not signed-in
business acceptance; financial and inventory behavior was validated in the demo
emulator without live test postings. No web changes were required; App Hosting
build `006` and the supplier-refund release were left unchanged. The foundation
is deployed, but the supplier goods-return UI and credit-note workflow remain
unfinished as described above.

## Next five priorities — 7 October 2026 implementation checkpoint

| Priority | This implementation group | Remaining gate / dependency |
| --- | --- | --- |
| 1. Customer invoice repayments, advances and debt aging | Implemented, validated and deployed: additive invoice receivable projections, agreed due dates, explicit invoice repayment and bounded FIFO, arrangement advances/application, aging, existing-worker due reminders and customer UI/guide | All 200 indexes READY; 378/378 live query shapes verified on 8 October. Historical allocations are not guessed; advanced statements, direct POS advance tender and unused-advance refunds remain separate work |
| 2. Supplier accounts | Existing PO/GRN/invoice/payment flow retained; supplier advances, partial invoice payments, advance application, dated statements, payable aging/unpaid-invoice pages, receiving history, printable GRNs, unused-advance refunds and atomic original-GRN supplier returns/credit notes deployed | Multi-product atomic credit documents and linked return correction/reversal screens remain; signed-in live financial acceptance remains unexercised |
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
| Purchase order to payment | Draft/submitted/approved PO, goods receiving, printable GRNs, supplier invoice approval, advances, part payments, advance allocation, refunds, dated statements, payable aging and original-GRN supplier returns/credit notes with atomic stock/accounting/audit deployed | Multi-product credit documents and linked return correction/reversal screens remain |
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
| 3. Inventory and returns | Reservation/partial collection/cancellation retained; inspected return disposition, linked replacement and difference settlement in both directions implemented, validated and deployed | Serial evidence at collection; uncollected reminders; automated held-stock disposition/aftersales routing; signed-in live financial acceptance |
| 4. Suppliers | Existing PO/GRN/invoice/payment workflow retained; advances, partial payments, advance application, refunds, dated statements, payable aging, receiving history, printable GRNs and atomic original-GRN supplier returns/credit notes deployed | Multi-product credit documents and linked return correction/reversal screens remain; historical receipts without original stock evidence require reconciliation |
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

Serial-evidence POS collection remains a next step; collection reminders are
implemented above and release-linked waybills are available. Do not
automatically expire reservations or use the collected-goods return option for uncollected stock.
