# Authorization model

Firestore `users/{uid}` profiles are the detailed source of truth. Each profile has a non-empty `roleIds` array, a compatibility `roleId` containing the first role in the canonical order, organization, independent branch and warehouse assignments, status, Auth-disabled mirror, authorization version, and creation/update provenance. Derived permission arrays are not copied into profiles. Legacy profiles that contain only `roleId` remain valid and are normalized to a one-role set when read; the next administrative update writes both fields.

Permissions are the union of all assigned roles, but scoped users operate in one explicit branch or warehouse context at a time. Holding both `branch_manager` and `warehouse_manager` grants branch-manager operations only for assigned `branchIds` and warehouse-manager operations only for assigned `warehouseIds`; it never creates organization-wide authority. The application selector sends the chosen context with every callable, and the server independently validates and narrows the roles and location IDs. A missing context is accepted only when exactly one valid scoped location exists; otherwise the operation is rejected until the user selects a location.

Navigation and feature tabs are permission-filtered. Ordinary users see only workspaces supported by their assigned role. Branch and warehouse managers receive the complete inventory workflow for their selected location, including receipts, opening balances while enabled, internal movement, adjustments, reversals, counts, review, reconciliation, and scoped reporting. This does not grant organization administration, shared catalogue mutation, cross-location access, or the opposite side of a transfer. Branch managers retain branch-side request and receipt authority; warehouse managers retain warehouse-side approval, reservation, fulfilment, dispatch, and cost authority. Existing maker-checker restrictions still prohibit a user from reviewing or approving their own controlled action.

The `sales_cashier` role may read the organization product catalogue and operate
paid POS sales and device shifts only for assigned branches. Branch managers
inherit those branch POS actions and may publish branch markups. Warehouse
managers establish central base selling prices. System administrators may work
across every branch and are the only role allowed to approve a branch price
below the current central base. Customer records may be created by authorized
administrators and branch managers, but only a system administrator can approve
or change customer credit authority. Cashiers and branch managers may use an
approved customer's available credit at POS; finance officers and authorized
branch managers may record repayments. Finance officers and auditors can read
sales, customer balances, and journals organization-wide, but no role may
mutate authoritative records directly from a client.

Custom claims contain only `organizationId`, an optional broad bootstrap platform marker, and `authorizationVersion`. Claims improve routing and token invalidation but never replace a fresh trusted-profile check for sensitive operations.

Server controls are centralized in `functions/src/auth/authorize.ts`:

- Active profile and Auth identity are required.
- Organization boundaries cannot be selected by clients.
- System administrators can assign, remove, and replace any non-empty set of centrally defined roles except changing their own roles through the user-management operation.
- Operations administrators can provision combinations of selected operational roles but cannot include system, operations, or finance administrator roles.
- Scoped assignment helpers reject branch and warehouse IDs outside the actor's authority.
- Scoped callables reject unassigned operating contexts and queries apply the selected branch or warehouse before reading records.
- The final active system administrator cannot have that role removed or be deactivated.
- Deactivated or suspended profiles cannot call protected functions.

All administrative Firestore mutations use Admin SDK callables. Rules allow scoped reads and deny all client writes to users, organizations, branches, warehouses, locations, bootstrap state, audit logs, code registries, and idempotency records.

Callable App Check enforcement is enabled outside the Emulator Suite. Production must register the web application and approved origins with an App Check provider before these callables are used.
