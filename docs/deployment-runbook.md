# Deployment runbook

## Unreleased sales expansion checkpoint (2026-08-25)

Sales expansion Phase 1 adds six callable Functions and the offline-capable POS.
Phase 2 adds three callable Functions for customer records, administrator credit
decisions, and receivable payments, plus credit checkout in the existing sale
callable. Phase 3 adds four callable Functions for receipt lookup, return queue,
return submission, and independent return approval, plus exchange-credit
redemption in the existing sale callable. This source checkpoint is not yet deployed. Production therefore
correctly remains on the validated 98-function release described below. A later
approved release must pass the full production predeploy gate, deploy web,
Functions, rules, and indexes together, and verify 111 ACTIVE Functions plus a
real paid sale, reconnecting-offline paid sale, approved credit sale, limit
rejection, customer repayment, restockable and non-restockable returns,
maker-checker rejection, and one-time exchange-credit redemption before this section can be reclassified as
deployed. Never infer deployment from a Git push.

## Production checkpoint (2026-08-12)

Immutable Firebase project ID `ramadan-warehouse-staging` is now the approved production project. The sole cloud alias is `production`; there is no cloud `staging` alias. The project display name, web-app label, monitoring policies, uptime check, and deployed Functions runtime were converted to production after the representative-data recovery gate passed. The existing App Hosting backend remains healthy at its immutable generated URL.

The full production predeploy gate passed before deployment. Firestore rules, Storage rules, indexes, and all 98 Functions are deployed. All Functions are ACTIVE on Node 22 and report `APP_ENV=production`, callable App Check enabled, bootstrap enabled, scheduled functions enabled, and `noop` notification/integration adapters. The controlled reset removed only the allowlisted synthetic application data and nine synthetic Auth users. Production bootstrap subsequently created `AB Ramadan Ltd.` (`ABR`) and the verified owner's active `system_administrator` profile and claims; no operational master or inventory data was inferred.

Use `production-conversion.md` for the recovery, reset, and completed bootstrap evidence. Never recreate a cloud `staging` alias for this project.

## Historical staging checkpoint (2026-08-12)

Rules, indexes, 98 Functions, three Scheduler jobs, and the App Hosting backend are deployed only to `ramadan-warehouse-staging`. The corrected Functions revision was deployed on 2026-08-12 after the full predeploy gate passed. All 98 Functions report the intended staging runtime flags and ACTIVE Node 22 state. The 97-function main bundle reports source hash `3cac137c5352e64e484958bb8ed485e2ed6b2848`; secret-bound `bootstrapOrganization` has its expected separate bundle hash.

## Verified staging deployment sequence

1. Run `firebase login --reauth` and confirm `firebase login:list` shows `serviceguru@svoltnigeria.com`.
2. Confirm `firebase use` resolves `staging` exactly to `ramadan-warehouse-staging`; never rely on gcloud's default project.
3. Confirm both `.env.staging` and `functions/.env.staging` are ignored and no App Check debug token exists.
4. Run `ALLOW_DIRTY_DEPLOY=true npm run validate:staging` and `env -u DEBUG ALLOW_DIRTY_DEPLOY=true npm run predeploy:staging`. The override is permitted only while this explicitly uncommitted worktree is under review.
5. Deploy Functions only:

   ```bash
   env -u DEBUG firebase deploy --only functions --project staging --non-interactive
   ```

6. Because the organization policy rejects `allUsers`, verify each callable Cloud Run service has the supported invoker IAM check disabled. Do not change the three scheduled services to public endpoints.
7. Verify all Functions are ACTIVE on Node 22 and that runtime environment contains staging/App Check/bootstrap/scheduled flags plus `noop` adapters.
8. Verify `systemLiveness` succeeds, while `systemReadiness` without Auth/App Check fails. Use a real deployed-browser token to verify legitimate App Check traffic before changing Firebase service-level enforcement.
9. Live verification must show missing and invalid App Check tokens rejected and a real deployed-browser token accepted by App Check before bootstrap.

Steps 1-9 completed successfully on 2026-08-12. Bootstrap, the one-time guard, live smoke tests, all eight application acceptance scenarios, and all reconciliation paths subsequently completed.

Bootstrap and the initial authenticated smoke phase subsequently completed. The missing `transferDiscrepancies(transferId, status)` index was added, deployed, reached READY, and the original received transfer then closed normally. A separate request-linked Kaduna replenishment also completed through fulfilment and closure. All eight live application acceptance scenarios pass. Scenario 8 closes and reconciles at transfer level with 12 received and 8 cancelled while the linked request correctly retains 8 approved units outstanding for later allocation. Transfer-remainder cancellation must not be represented or implemented as request-demand cancellation.

Operational follow-up on 2026-08-12 created `restore-test` only through `gcloud firestore databases restore` from the READY `nam5` managed backup. The operation completed successfully, read-only verification confirmed that the pre-bootstrap snapshot contained no collections, and `restore-test` was deleted; `(default)` and the backup were untouched. A later eligibility check still found no post-bootstrap READY backup, so no repeat restore was started. The active read-only baseline is documented in `backup-and-recovery.md`; repeat after the next daily snapshot becomes READY.

The enabled email notification channel for `servicegurunigeria@gmail.com` is attached to all six enabled staging policies. The Monitoring API exposes no verification state. The Billing Budgets API was enabled and the existing staging-project budget updated to a recurring USD 18.26 (documented ₦25,000 equivalent) with 50%, 80%, and 100% current-spend thresholds. The email channel and default billing IAM recipients are attached; no Pub/Sub or automatic shutdown is configured.

## Already deployed

- Firestore and Storage rules
- Firestore indexes
- App Hosting backend and staging-only secrets
- App Check and Auth hostname bindings
- Function image cleanup policy (seven days)
- Six alert policies and HTTPS uptime check
- Daily Firestore backup schedule and initial pre-bootstrap export
- Project-scoped monthly staging budget with 50%, 80%, and 100% alerts

## Production deployment sequence

1. Confirm `firebase use` resolves `production` exactly to `ramadan-warehouse-staging`; the immutable project ID is intentional.
2. Work only from `main`, require a clean worktree for routine deployment, and confirm ignored `.env.production` and `functions/.env.production` contain no debug token.
3. Run `npm run validate:production` and `npm run predeploy:production`.
4. Deploy through the scoped production scripts in `package.json`. Do not bypass their environment and project guards.
5. Verify 98 ACTIVE Node 22 Functions, three enabled Scheduler jobs, production runtime flags, rules/indexes, Monitoring policies, uptime, and backup schedule.
6. Verify the generated Hosting URL and callable App Check behavior. Service-level App Check remains metrics-first unless a separately approved enforcement change is made.

## Stop conditions

Stop immediately if the `production` alias differs from the approved immutable ID, Firebase authentication is stale, a validation gate fails, a debug App Check token appears, a secret would be exposed, or any command targets a different cloud project. Do not restore over or delete `(default)`, delete managed backups, or reuse the conversion-reset script for routine data administration.
