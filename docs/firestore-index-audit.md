# Cross-section Firestore index audit

The catalog in `scripts/firestore-query-catalog.mjs` combines source-extracted
literal queries with explicit dynamic filter matrices. It covers the current
application, not hypothetical future functionality. Current scope: 371 query
shapes and 70 query-bearing source files/hook consumers.

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

Final verification (7 October 2026, 09:40 UTC): 371/371 live query plans passed;
zero unsupported queries, 194/194 indexes READY, zero single-field overrides.
Seven new regression tests pass; the complete suite contains 240 passing tests.
The deployment was index-only; no business data or access controls were changed.
