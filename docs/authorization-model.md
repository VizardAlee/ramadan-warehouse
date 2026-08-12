# Authorization model

Firestore `users/{uid}` profiles are the detailed source of truth. Each profile has one `roleId`, organization, branch and warehouse assignments, status, Auth-disabled mirror, authorization version, and creation/update provenance. Derived permission arrays are not copied into profiles.

Custom claims contain only `organizationId`, an optional broad bootstrap platform marker, and `authorizationVersion`. Claims improve routing and token invalidation but never replace a fresh trusted-profile check for sensitive operations.

Server controls are centralized in `functions/src/auth/authorize.ts`:

- Active profile and Auth identity are required.
- Organization boundaries cannot be selected by clients.
- System administrators can assign all centrally defined roles except changing their own role through the user-management operation.
- Operations administrators can provision selected operational roles but cannot create system, operations, or finance administrators.
- Scoped assignment helpers reject branch and warehouse IDs outside the actor's authority.
- The final active system administrator cannot be demoted or deactivated.
- Deactivated or suspended profiles cannot call protected functions.

All administrative Firestore mutations use Admin SDK callables. Rules allow scoped reads and deny all client writes to users, organizations, branches, warehouses, locations, bootstrap state, audit logs, code registries, and idempotency records.

Callable App Check enforcement is enabled outside the Emulator Suite. Production must register the web application and approved origins with an App Check provider before these callables are used.
