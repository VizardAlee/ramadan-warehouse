# Bootstrap and provisioning

## First organization

`bootstrapOrganization` is the only organization-creation path in Phase 1. It requires a signed-in Firebase Auth account and is callable without an existing warehouse profile only while `system/bootstrap` does not exist. A Firestore transaction reads the bootstrap state, organizations, trusted administrators, and caller profile before atomically creating the organization, caller profile, bootstrap state, and audit event. Concurrent calls contend on the same state document, so only one can commit.

The function runs without a secret only in the Emulator Suite. Production configures the Cloud Functions secret `WAREHOUSE_BOOTSTRAP_SECRET`; it must never be stored in `NEXT_PUBLIC_*`, source control, logs, or audit records.

Production bootstrap completed on 2026-08-12 for `AB Ramadan Ltd.` (`ABR`) through a trusted authenticated GCP administrative procedure because the owner intentionally had no Firestore profile from which to invoke the App-Check-protected callable. The procedure enforced the same empty-state and sole-verified-owner preconditions, atomically created the organization/profile/bootstrap/audit records, assigned matching administrator claims, and verified the result. This was a one-time bootstrap operation, not an alternative ongoing organization-creation path.

The authenticated caller becomes the first `system_administrator`; an arbitrary UID is never accepted. After completion, broad custom claims are set and the caller must refresh their token or sign in again.

## Additional users

The application is invite-only. It exposes no public sign-up workflow. Administrators use the **Invite user** workflow, backed by `createOrganizationUser`, to invite every additional user—including branch and warehouse managers. The function resolves the actor, checks `user.manage`, validates every requested role and assignment, creates the Auth user using a random server-only password, creates the trusted profile, writes an email ownership record and idempotency result, sets minimal custom claims, and returns a one-time password-setup invitation link. The random password is never returned or stored, so the invited user cannot sign in with a password before completing the invitation.

An Auth identity by itself grants no application access. The signed-in identity must also have an active, organization-scoped trusted user profile whose authorization version matches its claims. Accounts created outside the invitation workflow therefore cannot enter the protected application. The one-time bootstrap administrator is the sole documented exception to additional-user invitation because that identity establishes the first organization and its initial administrator.

For branch setup, create the branch without a manager if necessary, invite a user with the `branch_manager` role and assign that branch, then edit the branch to select the accepted manager. Warehouse managers follow the equivalent warehouse workflow. The same invited user may hold both `branch_manager` and `warehouse_manager`, may have both branch and warehouse assignments, and is then eligible in both manager selectors. Manager designation may be reassigned independently from role and scope assignment; selectors show only active users who currently hold the required manager role.

User phone numbers may be entered in the familiar Nigerian 11-digit format, for example `07032545288`. The server preserves that profile value and converts it to Firebase Authentication's required international form (`+2347032545288`) only at the Auth boundary. The phone field is optional.

If an Auth account already owns the email, provisioning stops with `already-exists`; it is never silently attached. Recovery requires an operator to verify ownership and either remove the unused Auth account in the correct environment or implement a separately reviewed account-adoption procedure.

`updateOrganizationUser` controls profile, multi-role, assignment and status changes. Administrators can add, remove, or replace roles and independently reassign branches and warehouses, subject to role-escalation and scope controls. At least one role is always required. `revokeUserSessions` revokes refresh tokens. Role/status changes also revoke sessions. The UI includes a refresh-authorization control; users should otherwise sign out and back in after an authorization change.
