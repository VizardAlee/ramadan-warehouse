# Cross-section Firestore index audit

The catalog in `scripts/firestore-query-catalog.mjs` combines source-extracted
literal queries with explicit dynamic filter matrices. It covers the current
application, not hypothetical future functionality. The 8 October supplier-account
checkpoint covers 432 query shapes, including receiving history/stock evidence and current supplier payable aging,
unpaid invoice pages/totals and dated supplier statement pages,
separate payable/advance sums and opening balances across organization, store
and historical warehouse scopes.

Coverage includes POS, sales/collection/returns and customer histories/search;
inventory stock/valuation sums, movement history, serials, adjustments and counts;
request/transfer filters, organization/branch/legacy-location scopes; purchasing,
suppliers, expenses, banking/reconciliation, financial statements/tax, daily close,
HR/attendance, roles/users/audit registers, notifications and scheduled jobs.
Date ordering, aggregate sum field sets, optional filter combinations and `in`
assignment scopes matter; page limits/cursor values do not change index shapes.

## Checks

`npm run validate:indexes` runs JSON/index validation plus the reviewed query
baseline guard. CI and production deployment safeguards run this command.
Changing a query-bearing source, adding a source, changing the catalog, or
removing/changing an audited index requires a fresh review/audit. Adding indexes
is permitted, and does not authorize removal of old or live-only indexes.

`npm run audit:indexes:live -- --output /tmp/ramadan-index-audit.json` uses the
signed-in Firebase CLI account against the explicitly named production project
`ramadan-warehouse-staging`. It does not deploy or mutate records. By default,
Firestore Query Explain runs with `analyze=false`. When Explain reports a
missing index without its creation link, only that shape is retried using
sentinel IDs (row queries limited to one) to obtain Firebase's exact suggestion.
No user session is impersonated; these are index-planner checks, not end-user
RBAC or browser acceptance. No financial transactions are performed.

## Remediation and maintenance

The initial pass found 50 unsupported shapes, each with a distinct Firebase
suggested index: 37 inventory movement filter combinations, nine stock-count
variance combinations, and four sales sum combinations without a date filter.
Additive definitions preserve the existing 144 indexes. No application logic,
data, rules, service IAM, accounting or inventory history changes are required.

After changing a query: review and extend the catalog, explain against the live
project, add only confirmed missing definitions, deploy indexes without `--force`,
wait for READY, rerun the full live audit, then refresh the baseline's source
fingerprints/catalog digest/index signatures and retain verification evidence.
Do not refresh the baseline merely to suppress a failing release check. The
emulator cannot prove production composite-index coverage.

Reference: [Firestore Query Explain](https://firebase.google.com/docs/firestore/query-explain).

Deployment/readiness/final verification is recorded in the workflow roadmap.

Supplier-account verification (8 October 2026): 432/432 live query plans passed
with zero missing indexes after all 222 indexes reached READY. Fifteen additive
statement indexes, six unpaid-invoice aging indexes and one receipt-history index
were deployed; historical business data was not changed.
The guarded baseline was refreshed only after the successful live audit.

Inventory replay hardening verification (8 October 2026, 12:49 UTC): the
transaction-result fix does not change query shapes. A fresh planner-only audit
passed all 432 shapes with zero missing indexes; all 222 indexes remained READY
before refreshing the source fingerprint. No live business records were written.

Final verification (7 October 2026, 09:40 UTC): 371/371 live query plans passed;
zero unsupported queries, 194/194 indexes READY, zero single-field overrides.
Seven new regression tests pass; the complete suite contains 240 passing tests.
The deployment was index-only; no business data or access controls were changed.

Client usability PR #20 verification (7 November 2026): Customer branch selection reuses the existing authorized customer query and already-cataloged branch equality/in filters and name/number/phone/email ordering.
Reviewed candidate dce8ebca6d012838363d7d52d3833d2e162a7a48. Its complete 735-shape catalog
is byte-equivalent to the live-audited PR #20 candidate dce8ebca6d012838363d7d52d3833d2e162a7a48
(catalog SHA-256 f0008c842b3744e3621366fb157df298367c5c0f3a0df50e1afa8963300dbee5). The fresh production planner audit at
2026-11-07T11:07:35.963Z passed 735/735 shapes with zero missing indexes.
Planner evidence SHA-256: 0d7191ea4789e771b1496300542bee1f9c999293b79c6347e2830043a833fe57.
Candidate review evidence SHA-256: 0398d21078d999ded15b3f90ca752311282f7c87e7bc9e71e88c2b581970faa2.
The candidate's source fingerprints were refreshed only after that successful audit
and catalog comparison. Index definitions and validation safeguards are unchanged;
no business data, access controls or indexes were modified by this verification.
The recorded index inventory timestamp remains historical, not a new inventory check.

Client usability PR #21 verification (7 November 2026): Item-name filtering changes client-side matching only; no Firestore predicates, ordering or aggregate fields change.
Reviewed candidate 89aac7c3a46b95ed2acac37b4d656b76505948a3. Its complete 735-shape catalog
is byte-equivalent to the live-audited PR #20 candidate dce8ebca6d012838363d7d52d3833d2e162a7a48
(catalog SHA-256 f0008c842b3744e3621366fb157df298367c5c0f3a0df50e1afa8963300dbee5). The fresh production planner audit at
2026-11-07T11:07:35.963Z passed 735/735 shapes with zero missing indexes.
Planner evidence SHA-256: 0d7191ea4789e771b1496300542bee1f9c999293b79c6347e2830043a833fe57.
Candidate review evidence SHA-256: be5a0e71098cf83a1ac859afe74387cee5b8e4e73f7e5c3173b3e48550a37e22.
The candidate's source fingerprints were refreshed only after that successful audit
and catalog comparison. Index definitions and validation safeguards are unchanged;
no business data, access controls or indexes were modified by this verification.
The recorded index inventory timestamp remains historical, not a new inventory check.

Client usability PR #22 verification (7 November 2026): Inventory name matching scans the same authorized inventoryBalances document-ID ordered query with existing organization, branch/warehouse, product and location filters. Product labels use the existing direct-document reads.
Reviewed candidate d4ca81b8686c4e422ec99ef3b19e663b4e09fc8d. Its complete 735-shape catalog
is byte-equivalent to the live-audited PR #20 candidate dce8ebca6d012838363d7d52d3833d2e162a7a48
(catalog SHA-256 f0008c842b3744e3621366fb157df298367c5c0f3a0df50e1afa8963300dbee5). The fresh production planner audit at
2026-11-07T11:07:35.963Z passed 735/735 shapes with zero missing indexes.
Planner evidence SHA-256: 0d7191ea4789e771b1496300542bee1f9c999293b79c6347e2830043a833fe57.
Candidate review evidence SHA-256: 5c0f506b9fa0d31bb0787be8ba5a39b670c4833ece4e279334b5b0ba8dfa5502.
The candidate's source fingerprints were refreshed only after that successful audit
and catalog comparison. Index definitions and validation safeguards are unchanged;
no business data, access controls or indexes were modified by this verification.
The recorded index inventory timestamp remains historical, not a new inventory check.

Client usability PR #23 verification (7 November 2026): Customer status handling uses direct document transaction reads/writes only; existing callable queries and customer register index shapes are unchanged.
Reviewed candidate f73425c3df6db36a5d45b64a19772becf6f9db03. Its complete 735-shape catalog
is byte-equivalent to the live-audited PR #20 candidate dce8ebca6d012838363d7d52d3833d2e162a7a48
(catalog SHA-256 f0008c842b3744e3621366fb157df298367c5c0f3a0df50e1afa8963300dbee5). The fresh production planner audit at
2026-11-07T11:07:35.963Z passed 735/735 shapes with zero missing indexes.
Planner evidence SHA-256: 0d7191ea4789e771b1496300542bee1f9c999293b79c6347e2830043a833fe57.
Candidate review evidence SHA-256: e6c6615161442f7aa086e82eb5afb1ec820fabdf97bb76b075592c2f375dda1a.
The candidate's source fingerprints were refreshed only after that successful audit
and catalog comparison. Index definitions and validation safeguards are unchanged;
no business data, access controls or indexes were modified by this verification.
The recorded index inventory timestamp remains historical, not a new inventory check.
