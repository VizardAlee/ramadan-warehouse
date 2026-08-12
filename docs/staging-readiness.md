# Staging readiness

Historical staging acceptance record, verified 2026-08-12 against immutable project ID `ramadan-warehouse-staging`. All statements below describe the environment before its owner-approved conversion. The representative-data recovery gate subsequently passed, and this same immutable project is now configured as production. See `production-conversion.md` for current state.

## Status

| Area | Classification | Evidence / limitation |
|---|---|---|
| Project and billing | Validated | Alias `staging` resolves to the active Blaze project `ramadan-warehouse-staging` (project number `482160397815`). The existing project-scoped monthly budget is USD 18.26 (the approved ₦25,000 converted at the documented 2026-07-24 mid-market rate), with current-spend alerts at 50%, 80%, and 100%; no Pub/Sub or shutdown automation is configured. |
| Firestore | Deployed | Native-mode database in `nam5`; current rules, Storage rules, and indexes deployed. Unauthenticated direct writes were rejected live. |
| Authentication | Configured | Email/password enabled, anonymous disabled, App Hosting hostname authorized, and no staging users exist yet. |
| App Check registration | Validated | Staging web app uses reCAPTCHA Enterprise; ignored web environment contains the public key; generated App Hosting hostname is allowed; no debug tokens exist. A headless browser loaded the Enterprise challenge from the deployed hostname. |
| App Check enforcement | Validated | Callable enforcement is live on the corrected Functions revision: missing and invalid tokens are rejected with the SDK's generic `Unauthenticated`, while a real reCAPTCHA Enterprise token passes App Check verification and reaches the callable's Auth guard. Firebase service-level enforcement remains in the documented metrics-first state. |
| Functions | Deployed and validated | 98 Gen 2 Node 22 functions are ACTIVE in `us-central1` (95 callable, 3 scheduled). All expose the corrected staging flags. The main bundle hash is `3cac137c5352e64e484958bb8ed485e2ed6b2848`; secret-bound `bootstrapOrganization` has its expected separate hash. The main bundle includes the corrected transit-loss external-account ledger attribution. |
| Scheduler | Deployed | Exception monitoring runs daily at 08:00 Africa/Lagos; notification and integration delivery run every 15 minutes. |
| Secret Manager | Configured | `WAREHOUSE_BOOTSTRAP_SECRET` version 1 is enabled and bound only to `bootstrapOrganization`. No value is stored in tracked files or this documentation. |
| App Hosting | Deployed and validated | Backend `ramadan-warehouse-staging` returns HTTP 200 at `https://ramadan-warehouse-staging--ramadan-warehouse-staging.us-central1.hosted.app`. SSR routes build and no production project reference was found in served HTML. |
| Bootstrap and master data | Completed | The trusted callable created `RWSTG`, the first `system_administrator`, bootstrap state, claims, and audit records. Three branches, one warehouse, 11 canonical locations, nine synthetic role users, six products, and synthetic opening balances now exist through deployed callables. |
| Monitoring | Validated | HTTPS uptime check plus 5xx, p95 latency, Scheduler failure, structured operation failure, and App Check rejection policies exist. The enabled staging email channel for `servicegurunigeria@gmail.com` is attached to all six enabled policies and to the staging billing budget. The Monitoring API exposes no verification state; no pending confirmation can be asserted from API evidence. |
| Backups | Configured with limitation | Daily managed Firestore backups retain seven days. A 2026-08-12 recheck found only READY backup `25d3d91a-b856-4a6a-b34d-0804e0bc3013` (snapshot `2026-08-11T17:24:55.699584Z`), which predates bootstrap. Its earlier restore to temporary `restore-test` proved mechanics and cleanup, but representative post-bootstrap recovery still awaits the next READY daily snapshot. |
| External adapters | Validated safe | Notifications and branch integration are configured `noop`; no real external events are sent. |

## Validation evidence

The final `ALLOW_DIRTY_DEPLOY=true npm run predeploy:staging` passed on 2026-08-12 after correcting external-account ledger attribution. The dirty-tree override is the repository-supported mechanism used because this brief explicitly prohibited staging or committing the existing worktree.

| Gate / suite | Result |
|---|---|
| Environment and staging validation | Passed |
| Local acceptance | Passed |
| Lint and application/Functions type checks | Passed |
| Unit tests | 74 passed |
| Firestore rules tests | 13 passed |
| Callable administration/inventory/request/transfer tests | 26 passed |
| Inventory, request, and transfer focused suites | Passed |
| Serial, lot, return, transit-loss, and remainder-cancellation E2E | Passed |
| Transfer concurrency and reconciliation | Passed |
| Scheduled, integration, and import tests | Passed |
| Functions and Next.js builds | Passed; 31 routes, including SSR routes |
| Index validation, secret scan, repository safety, `git diff --check` | Passed |

The emulator runs under the host's Node 20 and warns that production requests Node 22; deployed Cloud Functions use Node 22.

## Deployment evidence

- Firestore and Storage rules: deployed successfully.
- Firestore indexes: deployed successfully.
- Functions: 98 ACTIVE Node 22 services; all 95 callable Cloud Run services are ready and use `invokerIamDisabled`, the supported public-endpoint mode compatible with the inherited domain-restricted-sharing policy. Firebase Auth and App Check remain application controls.
- Functions runtime: every deployed function reports `APP_ENV=staging`, App Check/bootstrap/scheduler enabled, `us-central1`, and `noop` notification/integration adapters.
- Live callable verification on revision `systemreadiness-00003-xeh`: missing and invalid App Check requests returned `Unauthenticated`; logs recorded the invalid token as rejected. A real deployed-browser App Check token was logged `VALID` and proceeded to the callable's separate Auth requirement.
- Ledger correction: the focused transit-loss E2E passed before deployment, and the deployed main-bundle hash is the corrected source revision in which external-account attribution appears only on the balancing external ledger entry.
- Schedules: all three jobs are enabled.
- App Hosting: rollout completed at the staging URL above.
- Artifact Registry: cleanup removes function images older than seven days.

## Live authenticated validation (2026-08-12)

- Bootstrap completed through the trusted callable; the second attempt returned `ALREADY_EXISTS`.
- The `transferDiscrepancies(transferId, status)` composite index is READY.
- The original direct Kaduna transfer closed normally after its index became ready. Its cost is reconciled, closure audit/event exist, transit and reservations are zero, and closure did not change inventory quantities.
- A real Kaduna branch request completed through submit, independent review/approval, request-linked transfer, warehouse handling, receipt, fulfilment, cost reconciliation, closure, and reconciliation. Approval created no inventory movement, fulfilment remained zero before confirmed receipt, and an over-allocation attempt created no transfer.
- Final inventory reconciliation checked eight balances with zero discrepancies. Both completed live transfers are closed; panel stock is conserved across warehouse and Kaduna locations with zero transit.
- Live readiness reports `ready`; App Check, Auth, organization spoof resistance, maker-checks, and self-role escalation denial were exercised with real staging identities and real App Check tokens.
- Live acceptance scenarios 2-8 pass: dedicated Kano direct allocations, partial approval fulfilled 4+2, missing delivery resolved later from transit, damaged battery serial write-off, controlled inverter return through `CWH-RET`, confirmed transit loss, and undispatched-remainder cancellation. Every associated transfer is terminal and reconciles clean.
- Scenario 8 passes under the authoritative product rule that transfer-remainder cancellation does not cancel request demand. The transfer ended `approved 20 / dispatched 12 / received 12 / cancelled 8 / outstanding 0`; the request independently remained `approved 20 / fulfilled 12 / outstanding 8`, available for a later transfer.
- Final live reconciliation checked 19 balances with zero discrepancies and 12 operational transfers with zero warnings/errors. Active reservations, transit balances, unresolved discrepancies, and unreconciled costs are all zero. Seven serialized assets remain active, one is immutably written off, and the single lot retains 500 units.
- Normal password authentication for `servicegurunigeria@gmail.com` is configured and has a recorded successful login. The account is enabled and was not reset during this acceptance run.

## Historical remaining sequence

1. Repeat the temporary-secondary-database restore verification after a post-bootstrap daily backup becomes READY. **Completed:** READY backup `36b62798-14dd-4991-b7a0-fe7ceea06a03` passed isolated representative-data verification and cleanup on 2026-08-12.

Current active-data baseline captured read-only at `2026-08-12T14:20:29.373Z`: 1 organization, 3 branches, 1 warehouse, 15 locations, 6 products, 33 inventory transactions, 78 ledger entries, 19 balances, 8 serials, 1 lot, 8 branch requests, 12 transfers, and 258 audit records. Representative organization, branch, warehouse, location, SKU, balance, serial, lot, request, transfer, and audit identifiers were recorded for comparison with the next eligible snapshot.

Final health recheck: App Hosting HTTP 200; 98/98 Functions ACTIVE on Node 22 with the staging and App Check flags; only `(default)` exists in `nam5`; Scheduler 3/3 enabled with recent successful attempts; monitoring policies 6/6 enabled; one uptime check enabled; daily backup schedule enabled; managed backup READY.

Historical final classification: **Staging validated**. All eight application acceptance scenarios passed, final reconciliation was clean, and representative post-bootstrap restore validation subsequently passed.

Current conversion status: **production bootstrap completed**. Runtime, alias, monitoring labels, project/web-app display labels, controlled synthetic-data/Auth reset, and real organization bootstrap for `AB Ramadan Ltd.` (`ABR`) are complete.
