# Phase 0 technical assessment

## Phase 4 assessment

The central ledger remains authoritative. Reservation is concurrency-safe and physical transfers reuse the posting service through a non-client-exposable capability. Receipt is the sole normal request-fulfilment trigger. Route transit locations keep outstanding goods reconcilable. Remaining launch risks include production policy configuration, evidence storage security, scheduled-job operations, high-volume reporting validation, and user acceptance of tablet picking/receiving flows.

Date: 2026-08-06

## Repository status

The repository contained only Git metadata: no commits, source files, package manifest, Firebase configuration, tests, CI, or deployment configuration. The configured `origin` points to `VizardAlee/ramadan-warehouse`, but no remote branch was available locally. There was therefore no working application or convention to preserve and no reusable code.

## Selected stack

- Next.js App Router, React, strict TypeScript, Tailwind CSS
- Firebase Authentication, Firestore, Storage, Cloud Functions v2, Admin SDK, App Check hooks
- Zod, React Hook Form, shadcn-compatible component conventions
- Vitest, Testing Library, Firebase Rules Unit Testing, Firebase Emulator Suite

## Firebase status

Firebase was not configured. Phase 1 adds local emulator configuration and environment-driven browser initialization. A real Firebase project, web app, Auth provider, App Check provider, and production indexes still require operator configuration. Nothing is deployed.

## Missing dependencies and infrastructure

Everything was initially missing. Phase 1 creates the package manifest and baseline configurations. CI/CD, production secrets, monitoring, backups, billing alerts, domain configuration, and integration credentials intentionally remain out of scope.

## Security concerns and integration risks

- Branch isolation cannot safely depend on client-provided organization or branch identifiers. Rules and functions resolve membership from `users/{uid}`.
- Custom claims can become stale; they are limited to broad flags while detailed permissions remain in Firestore.
- Bootstrap and provisioning now use trusted Cloud Functions. Production bootstrap still requires a configured secret and an approved operator procedure; self-registration remains absent.
- Firebase browser authentication cannot be treated as a server session. Phase 1 uses a client guard; sensitive data remains protected by rules and functions.
- App Check enforcement is enabled by environment outside emulator mode. Production rollout requires registered web origins and a configured provider.
- Storage starts fully denied until attachment ownership and malware/content controls are designed.
- The existing branch inventory application's API and consistency guarantees are unknown. No direct coupling is introduced.
- Firestore query/index requirements will grow with Phase 2; broad collection scans must not be introduced.

## Reusable foundation

The shared domain models, validation schemas, permission catalog, authenticated application shell, Firebase clients, callable-function guard, audit writer, and deny-by-default rules are intended for later phases.

The operational Phase 1 extension adds transactional bootstrap, Admin SDK user provisioning, claims versioning, centralized role-assignment safeguards, administrative master-data callables and UI, and an emulator-only seed.

## Dependency audit

The current Firebase Admin dependency tree reports a moderate transitive `uuid` advisory. npm proposes a breaking Firebase Admin downgrade, so no unsafe automatic fix is applied. Recheck when Google Cloud transitive packages publish compatible updates.

## Phase 2 architecture assessment

The Phase 1 callable authorization, Zod parsing, idempotency, audit writer, organization scoping, App Check switch, and deny-by-default rules were retained. Phase 2 adds a top-level immutable entry journal and transactional balance/serial/lot projections. Cost-bearing defaults are separated into `productCosts`; quantity-only clients use sanitized callables. Direct catalogue and inventory writes remain denied.

The principal correctness boundary is the central Firestore posting transaction. It creates paired quantity/value entries, uses locked counters and deterministic balance/asset identities, and rejects negative, cross-organization, out-of-assignment, duplicate serial, and later-phase transfer operations. Weighted-average amounts are integer minor units.

Remaining risks are operational scale (bounded callable pages/reconciliation), adjustment approval expansion, deferred CSV import, and the eventual interaction between reservations/transfers and the current `availableQuantity` projection. Those later modules must call the same posting service and must not add a competing balance mutation path.

## Phase 3 architecture assessment

Phase 3 adds a separate demand-and-approval aggregate using current callables, authorization, transactions, idempotency, audit, and App Check conventions. Current request state is projected into `branchRequests` and `branchRequestItems`; formal versions, approvals, events, comments, and notification events are immutable companion records. Server-side branch/year counters produce collision-safe human references.

The primary safety boundary is explicit: no request callable imports or calls the inventory posting service. Approval and availability integration tests compare inventory collections before and after workflow actions. Fulfilment fields are initialized to zero and have no client or Phase 3 callable mutation path.

Remaining Phase 3 risks are operational policy depth, report aggregation at scale, attachment security/scanning, and notification delivery operations. These are documented deferrals and do not weaken request history or stock separation.

## Files created or changed

Phase 1 creates the application and functions source trees, Firebase configuration/rules, test harness, environment template, this assessment, and the implementation plan. See Git status for the exact current set.
