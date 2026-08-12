# Firebase staging setup runbook

> Historical record: immutable project ID `ramadan-warehouse-staging` completed staging acceptance and was subsequently converted, with owner approval, into the production environment. The current sole cloud alias is `production`; do not use this document as authorization to recreate or deploy a staging alias. See `firebase-production-setup.md` and `production-conversion.md` for current operations.

## Deployed staging configuration (2026-08-12)

- Project: `ramadan-warehouse-staging`; alias: `staging`; Blaze billing active.
- Firestore: Native mode in `nam5`; rules and indexes deployed.
- Storage: default staging bucket created and deny-by-default rules deployed.
- Auth: email/password enabled, anonymous disabled. Authorized domains include the Firebase domains and the deployed App Hosting hostname.
- App Check: the existing staging web app is registered with reCAPTCHA Enterprise. The public site key is present only in ignored `.env.staging` and App Hosting Secret Manager configuration. The deployed hostname is allowed and debug-token inventory is empty.
- Functions: 98 Gen 2 Node 22 functions in `us-central1`; 95 callable and 3 scheduled. `WAREHOUSE_BOOTSTRAP_SECRET` exists and is bound only to bootstrap.
- App Hosting: backend `ramadan-warehouse-staging` is deployed at `https://ramadan-warehouse-staging--ramadan-warehouse-staging.us-central1.hosted.app` with min instances 0 and staging-only secret references.
- Safe integrations: notification and branch integration adapters are `noop`.
- Operations: six staging alert policies, an enabled email notification channel attached to all six and the staging billing budget, one regional HTTPS uptime check, a daily seven-day Firestore backup schedule, and a verified initial export are configured.

## Deployed Functions environment

Functions require their own ignored environment file. `functions/.env.staging` now sets:

```text
APP_ENV=staging
FUNCTIONS_REGION=us-central1
LOG_LEVEL=info
NOTIFICATION_ADAPTER_MODE=noop
INTEGRATION_ADAPTER_MODE=noop
WAREHOUSE_APP_CHECK_ENABLED=true
WAREHOUSE_BOOTSTRAP_ENABLED=true
WAREHOUSE_SCHEDULED_FUNCTIONS_ENABLED=true
```

The complete predeploy gate passed and this configuration was deployed on 2026-08-12. All 98 Functions are ACTIVE on Node 22. The 97-function main bundle uses source hash `3cac137c5352e64e484958bb8ed485e2ed6b2848`; secret-bound `bootstrapOrganization` uses its expected separate hash. Live verification confirmed that missing and invalid App Check tokens are rejected and a real reCAPTCHA Enterprise token passes verification. Do not copy browser configuration or secrets into this Functions file.

## Bootstrap state

Bootstrap completed through `bootstrapOrganization` for `servicegurunigeria@gmail.com`; a second call returned `ALREADY_EXISTS`. Claims and `getMyAccessContext` report `system_administrator` at authorization version 1, and bootstrap/custom-claim audit records exist. Normal password authentication is configured, the account is enabled, and Identity Toolkit records a successful login. The credential was not reset during the final acceptance run.

The live request and direct-transfer smoke workflows are closed and reconciled. The closure index `transferDiscrepancies(transferId, status)` is READY. All eight live application acceptance scenarios passed. Remainder cancellation correctly closes the transfer with 12 received and 8 cancelled while preserving those eight as approved request demand for later allocation.

The owner subsequently approved a temporary secondary database inside this project. The initial pre-bootstrap restore proved mechanics but contained no business data. A later READY post-bootstrap backup, `36b62798-14dd-4991-b7a0-fe7ceea06a03`, was restored to `restore-test`; all 51 collections and representative business evidence passed read-only verification. The temporary database was deleted, `(default)` was untouched, and the source backup remains READY. Never restore over `(default)`.

The staging email channel targets `servicegurunigeria@gmail.com`, is enabled, and is attached to all six enabled policies. The Monitoring API returns no verification-state field, so it does not establish a pending owner action. The Cloud Billing Budget API is enabled. The existing project-scoped monthly budget was updated to USD 18.26, the approved ₦25,000 converted using the 2026-07-24 mid-market equivalence of ₦25,000 to USD 18.26. Current-spend thresholds are 50%, 80%, and 100%; the staging email channel and default billing IAM recipients are enabled. No Pub/Sub or automatic shutdown is configured.

All subsequent users, branches, warehouses, locations, products, opening balances, requests, transfers, and costs must be created through the application callables. Use synthetic data only.
