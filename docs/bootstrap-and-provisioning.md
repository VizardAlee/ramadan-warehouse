# Bootstrap and provisioning

## First organization

`bootstrapOrganization` is the only organization-creation path in Phase 1. It requires a signed-in Firebase Auth account and is callable without an existing warehouse profile only while `system/bootstrap` does not exist. A Firestore transaction reads the bootstrap state, organizations, trusted administrators, and caller profile before atomically creating the organization, caller profile, bootstrap state, and audit event. Concurrent calls contend on the same state document, so only one can commit.

The function runs without a secret only in the Emulator Suite. Production configures the Cloud Functions secret `WAREHOUSE_BOOTSTRAP_SECRET`; it must never be stored in `NEXT_PUBLIC_*`, source control, logs, or audit records.

Production bootstrap completed on 2026-08-12 for `AB Ramadan Ltd.` (`ABR`) through a trusted authenticated GCP administrative procedure because the owner intentionally had no Firestore profile from which to invoke the App-Check-protected callable. The procedure enforced the same empty-state and sole-verified-owner preconditions, atomically created the organization/profile/bootstrap/audit records, assigned matching administrator claims, and verified the result. This was a one-time bootstrap operation, not an alternative ongoing organization-creation path.

The authenticated caller becomes the first `system_administrator`; an arbitrary UID is never accepted. After completion, broad custom claims are set and the caller must refresh their token or sign in again.

## Additional users

Administrators use `createOrganizationUser`. The function resolves the actor, checks `user.manage`, validates the requested role and assignments, creates the Auth user using a random server-only password, creates the trusted profile, writes an email ownership record and idempotency result, sets minimal custom claims, and returns a password-reset invitation link once. The random password is never returned or stored.

If an Auth account already owns the email, provisioning stops with `already-exists`; it is never silently attached. Recovery requires an operator to verify ownership and either remove the unused Auth account in the correct environment or implement a separately reviewed account-adoption procedure.

`updateOrganizationUser` controls profile, role, assignment and status changes. `revokeUserSessions` revokes refresh tokens. Role/status changes also revoke sessions. The UI includes a refresh-authorization control; users should otherwise sign out and back in after an authorization change.
