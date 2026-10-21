# Private Help & feedback

The protected `/help` workspace accepts bug reports, help requests and suggestions. It preserves existing POS, customer autocomplete, financial workflows and permissions. No customer replies are sent.

## User workflow

- Enter a description with 10–4,000 Unicode code points after trimming its ends. The form shows the count and explains each disabled Send action. Expected outcome is optional, limited to 2,000 characters.
- Optionally choose a PNG already cropped to the issue. Only an explicitly selected file is processed; the page is never captured. Review the preview and confirm that private/unrelated information was removed. Changing content invalidates this confirmation.
- Submit once. The ticket, owner membership, quota counters and notification outbox are created atomically before SMTP. A receipt means the ticket was saved, independently of email availability.
- On an uncertain response, retry the unchanged in-memory request reference or check My tickets before starting another. Drafts and screenshots are not stored in browser storage and are discarded on account/organization/authorization-version/operating-context changes or navigation/reload.
- My tickets and direct emailed ticket links require current authorization. Lists check at most 20 entries per page; a filtered empty page can still have More tickets.
- Directly assigned built-in system administrators can review the support queue, change New / In progress / Resolved status using revision checks, and request a retry only for a confirmed failed or unconfigured notification. Custom administrator-base roles do not inherit access to other users’ private reports.

The login page provides a support contact when sign-in is unavailable. It does not submit anonymous tickets or grant access to private history.

## Privacy and access

The server derives owner, organization, roles and reporting scope from the verified current account. A client cannot supply these fields. Current organization status, authorization version and profile/assignment checks apply; a selected branch or warehouse narrows ticket access even for administrators. All ticket operations are confined to the authenticated organization. Built-in organization-wide roles retain existing location authority for their own reports.

Diagnostics contain only a whitelisted screen template with record IDs and query strings removed, actual deployed revision when available, client/server timestamps, coarse browser/device categories and an optional bounded error reference. No tokens, page contents, customer/financial records, broad logs, browser history or other apps are collected automatically.

PNG input is limited to 5 MB in the browser, bounded by decoded dimensions and resized locally. The server independently validates PNG signature, chunks/CRC, dimensions, filters and bounded decoded scanlines; strips metadata; and caps canonical output at 128 KB. It rejects SVG, URLs, external/file attachments and original filenames. Screenshots are stored as private Firestore bytes with an ownership check and have no public link.

`supportOrganizations/{organizationId}` contains tickets, owner indexes, screenshots, limits and status audit entries. `supportMailOutbox/{ticketId}` contains notification state. Existing Firestore catch-all deny protects all new paths from direct client reads/writes, including app administrators; no Firestore or Storage rule was opened. The API applies the server authorization checks on each request and rechecks authority inside write transactions.

Creation limits are 3 reports per user per rolling five minutes, 10 per user per Lagos day and 200 per organization per Lagos day. Same-reference unchanged retries do not consume another quota. Reusing a reference for different content is rejected. No business, financial, user-profile or system-setting record is written by support operations.

## Mail delivery

Fixed sender: `biggy0023@gmail.com`. Fixed recipient: `servicegurunigeria@gmail.com`. Subject: `[Ramadan Support] Ticket <id>`. Messages contain reviewed report text, safe account/scope/context metadata, a private authenticated link and optional canonical PNG. The API has no mail-secret access. There is no Reply-To/customer address, CC/BCC, automatic customer reply or arbitrary recipient configuration.

The once-per-minute worker checks at most 10 interrupted sending claims and attempts at most one pending report. It claims an attempt transactionally before SMTP and uses a lease to prevent overlapping sends. Gmail SMTP uses port 465 with certificate verification and TLS 1.2 minimum, bounded timeouts, no protocol/payload logging and no file/URL access.

SMTP acceptance is not proof of inbox delivery. Explicit rejection is recorded as failed and may be manually queued by an authorized administrator, with a five-attempt ceiling. Lost/ambiguous responses or interrupted sending leases become uncertain and are never automatically replayed. A deterministic Message-ID is a reference, not SMTP idempotency. Missing/invalid provider configuration leaves the saved ticket unconfigured/pending. Emulator runs never load production Gmail credentials or contact Gmail; tests inject a synthetic transport.

## Approved transport and deployment

Project: `ramadan-warehouse-staging` (`482160397815`), region `us-central1`.

- Ticket function `supportWorkspace`: private IAM invocation, API runtime `ramadan-support-api-runtime@ramadan-warehouse-staging.iam.gserviceaccount.com`; max 3 instances / concurrency 4 / 256 MiB. Only `ramadan-support-gateway@ramadan-warehouse-staging.iam.gserviceaccount.com` is to receive invocation permission on this service.
- API Gateway: API `ramadan-support-api`, initial immutable configuration `support-v1`, regional Gateway `ramadan-support-gateway`. JWT issuer/audience are pinned to the Ramadan Firebase project. The backend independently verifies the original Firebase token and App Check, ignores decoded Gateway identity headers, and then applies normal application authorization. Only exact existing custom/hosted origins receive CORS headers; preflight cannot execute a ticket action. Direct backend access remains IAM-protected.
- Mail function `deliverSupportMail`: runtime and Scheduler caller `ramadan-support-mail-runtime@ramadan-warehouse-staging.iam.gserviceaccount.com`; max 1 instance / concurrency 1 / 256 MiB / 90-second timeout. Only this identity is to receive invocation on the worker and named-secret `roles/secretmanager.secretAccessor` for `RAMADAN_SUPPORT_GMAIL_APP_PASSWORD`.
- `ramadanSupportApiData` contains `datastore.databases.get` plus `datastore.entities.get,list,create,update`; `ramadanSupportMailData` contains `datastore.databases.get` plus `datastore.entities.get,list,update`. Each is bound only to its respective runtime, conditioned to `projects/ramadan-warehouse-staging/databases/(default)`. IAM permissions cover that entire database; application code supplies the support-collection boundary. No delete/import/export/database-admin/user-admin permission is included.
- Approved Google-managed Gateway agents receive the standard project-level `roles/apigateway.serviceAgent` and `roles/apigateway_management.serviceAgent`. These have broader token/service-management authority than the Gateway identity's one-service invocation grant. No additional human/deployer role, existing function policy, organization-policy relaxation or invoker-check bypass is part of this rollout.

`scripts/support-gateway-config.mjs` renders configuration only from the verified untagged supportWorkspace service URI. Publish it using the approved Gateway backend-auth identity; do not substitute another service/project or guessed tagged URL. Keep IAM invocation checking enabled.

After the Gateway is verified, set runtime-only non-secret `RAMADAN_SUPPORT_GATEWAY_URL` for App Hosting to its exact `/supportWorkspace` endpoint. `/api/support-config` returns only this approved URL and the actual `K_REVISION`, with no-store caching. If absent, sending stays unavailable with an explanation. This does not change common financial callable transport or put a Gmail secret in the browser/App Hosting runtime.

Provision a distinct Ramadan credential privately through Google Secret Manager Console. The retired local prompt helper must not be reused: a synthetic four-line paste demonstrated premature line submission. Agents must not inspect the password screen/clipboard, copy Beacon's secret or access either secret's payload. Verify only version metadata after the owner confirms storage. Deploy the mail worker only after that confirmation and successful release gates. Inspect an uncertain result before any retry.

## Verification gates

Focused tests cover validation/PNG, Gateway boundary/configuration, transaction/rate/access/status behavior, SMTP failure handling, bounded dispatch and UI interactions. `test:support:sdk` exercises actual demo Auth/Firestore SDK transactions with injected mail; Gateway HTTP verification is tested separately. Existing rules tests also assert direct access denial for every support namespace. Emulator tests require loopback `demo-` projects and never use live credentials or real mail.

Complete CI/predeploy, production build, current live planner/index audit, responsive browser checks and exact-release verification remain mandatory. Report signed-in production and actual inbox verification separately; synthetic fixtures and SDK emulator tests do not establish either result.
