# Production conversion evidence

Converted 2026-08-12. The immutable Firebase/GCP project ID `ramadan-warehouse-staging` is now the operational production project. A separate cloud staging project does not currently exist; `demo-ramadan-warehouse` in the local Emulator Suite is the pre-production environment until billing capacity permits a new staging project.

## Recovery gate — passed

- Source backup: READY `36b62798-14dd-4991-b7a0-fe7ceea06a03`, `(default)`, `nam5`, snapshot `2026-08-12T17:38:09.517272Z`.
- Restore: isolated `restore-test`; operation `_eV9KCL9fLUVRdMZzjEkpxAqNW1hbgQiChAaGg`, started `2026-08-12T18:20:30.288280Z`, `SUCCESSFUL`/100%.
- Representative recovery: all 51 expected collections. Counts matched the active snapshot, including 1 organization, 3 branches, 1 warehouse, 15 locations, 6 products, 33 transactions, 78 ledger entries, 19 balances, 8 serials, 1 lot, 8 requests, 8 request versions/approvals, 42 request events, 12 transfers, 12 transfer versions, 11 transfer approvals, 187 transfer events, and 258 audits.
- Integrity: no duplicate serials, broken core references, invalid numeric balances, unresolved discrepancies, active reservations, or nonzero transit. Restored product totals and the 500-unit lot were coherent.
- Cleanup: only `restore-test` was deleted at `2026-08-12T20:03:31.760981Z`. `(default)` remained intact; both managed backups remain READY.

## Production configuration

- Alias: the sole cloud alias is `production` → `ramadan-warehouse-staging`; no ambiguous staging alias remains.
- Project display name: `Ramadan Warehouse Production`; Firebase Web app and monitoring/uptime resources use production labels.
- Functions: 98/98 Gen 2 services ACTIVE on Node 22 with `APP_ENV=production`, App Check enabled, schedulers enabled, and `noop` notification/integration adapters.
- Firestore/Storage: rules released and indexes deployed to `(default)` in `nam5`.
- App Hosting: existing backend and hosted.app hostname retained; HTTP 200. Public Firebase/App Check values and hostname did not change. A repeat CLI rollout was unnecessary for runtime semantics and its IAM preflight was unreliable during transient OAuth connectivity.
- App Check: the existing reCAPTCHA Enterprise key and one-hour token TTL are retained. Callable enforcement is enabled. Firestore, Auth, and Storage service-level enforcement remain `UNENFORCED` under the validated metrics-first policy; no debug tokens exist.
- Operations: 3/3 Scheduler jobs, 6/6 alert policies, one uptime check, daily seven-day backups, and the email channel to `servicegurunigeria@gmail.com` remain enabled.
- Budget: project-scoped USD 18.26 monthly, 50/80/100 current-spend thresholds, one email channel, no Pub/Sub, and no automatic shutdown.

Production validation passed before deployment: lint, type checks, 74 unit tests, 13 rules tests, 26 combined callable tests, focused inventory/request/transfer suites, serial/lot/return/transit-loss/remainder E2E, concurrency, reconciliation, scheduled/noop integration/import tests, Functions/web builds, index validation, secret scan, and repository safety.

## Controlled synthetic reset

The offline-only guarded script `scripts/production-conversion-reset.mjs` requires the exact project ID, confirmation phrase, short-lived privileged token file, and an explicit execute flag. It is not callable by application clients.

Dry run asserted organization `RWSTG`, exclusively `STG-*` products, completed synthetic bootstrap, an exact collection allowlist, one verified owner identity, and exactly nine synthetic `@staging.ramadan-warehouse.invalid` identities. It enumerated 1,367 Firestore documents across 51 collections.

Execution completed `2026-08-12T21:15:42.717Z`:

- Deleted all allowlisted synthetic Firestore documents, including audit/outbox/counter/rate-limit and bootstrap state.
- Deleted nine synthetic Auth users.
- Preserved enabled, verified `servicegurunigeria@gmail.com`; cleared custom claims and revoked existing sessions.
- Preserved `(default)`, backups, rules, indexes, Functions, Hosting, App Check, Scheduler, monitoring, uptime, budget, Secret Manager, and Auth provider configuration.

Independent after-state: zero top-level Firestore collections, one owner Auth identity with empty claims, and bootstrap ready.

## Production bootstrap — completed

The owner supplied legal name `AB Ramadan Ltd.` and organization code `ABR`. On 2026-08-12, a trusted authenticated GCP administrative procedure first asserted that Firestore had zero collections and Auth contained only the enabled, verified owner identity `servicegurunigeria@gmail.com`. It then atomically created organization `I2wgZly4jehKd5Fjr4UJ`, the active owner profile, the one-time bootstrap guard, and the organization/bootstrap audit evidence before assigning `system_administrator` claims at authorization version 1.

Read-only verification confirmed the organization name/code, NGN currency, Africa/Lagos timezone, owner/profile organization agreement, completed bootstrap guard, claims, and both `organization.bootstrap` and `custom_claim.updated` audit actions. No branch, warehouse, additional user, product, inventory location, opening stock, request, or transfer was created or inferred.

The existing hosted.app domain remains the temporary production URL until the owner supplies a custom domain. Subsequent master and inventory data must be entered through the authorized application workflows.

Current verdict: **Production bootstrapped; ready for owner sign-in and controlled master-data setup**.
