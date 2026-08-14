# Authorization model

Firestore `users/{uid}` profiles are the detailed source of truth. Each profile has a non-empty `roleIds` array, a compatibility `roleId` containing the first role in the canonical order, organization, independent branch and warehouse assignments, status, Auth-disabled mirror, authorization version, and creation/update provenance. Derived permission arrays are not copied into profiles. Legacy profiles that contain only `roleId` remain valid and are normalized to a one-role set when read; the next administrative update writes both fields.

Permissions are the union of all assigned roles. Scope is still restrictive: holding both `branch_manager` and `warehouse_manager` grants branch-manager operations only for `branchIds` and warehouse-manager operations only for `warehouseIds`. A user may therefore manage one or more branches and warehouses at the same time without creating a duplicate account.

Custom claims contain only `organizationId`, an optional broad bootstrap platform marker, and `authorizationVersion`. Claims improve routing and token invalidation but never replace a fresh trusted-profile check for sensitive operations.

Server controls are centralized in `functions/src/auth/authorize.ts`:

- Active profile and Auth identity are required.
- Organization boundaries cannot be selected by clients.
- System administrators can assign, remove, and replace any non-empty set of centrally defined roles except changing their own roles through the user-management operation.
- Operations administrators can provision combinations of selected operational roles but cannot include system, operations, or finance administrator roles.
- Scoped assignment helpers reject branch and warehouse IDs outside the actor's authority.
- The final active system administrator cannot have that role removed or be deactivated.
- Deactivated or suspended profiles cannot call protected functions.

All administrative Firestore mutations use Admin SDK callables. Rules allow scoped reads and deny all client writes to users, organizations, branches, warehouses, locations, bootstrap state, audit logs, code registries, and idempotency records.

Callable App Check enforcement is enabled outside the Emulator Suite. Production must register the web application and approved origins with an App Check provider before these callables are used.
