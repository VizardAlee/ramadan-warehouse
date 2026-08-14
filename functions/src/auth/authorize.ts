import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { db } from "../admin.js";

export const roles = [
  "system_administrator",
  "operations_administrator",
  "warehouse_manager",
  "warehouse_officer",
  "branch_requester",
  "branch_manager",
  "logistics_officer",
  "finance_officer",
  "auditor",
] as const;
export type RoleId = (typeof roles)[number];
export type Permission =
  | "organization.manage"
  | "branch.manage"
  | "warehouse.manage"
  | "location.manage"
  | "user.manage"
  | "role.manage"
  | "audit.read"
  | "products.read"
  | "products.create"
  | "products.update"
  | "inventory.read"
  | "inventory.receive"
  | "inventory.opening_stock"
  | "inventory.move_internal"
  | "inventory.adjust"
  | "inventory.reverse"
  | "inventory.count"
  | "inventory.count_review"
  | "inventory.reconcile"
  | "inventory.cost.read"
  | "inventory.cost.manage"
  | "reports.inventory.read"
  | "reports.inventory.export"
  | "requests.read.own_branch"
  | "requests.read.all"
  | "requests.create"
  | "requests.update_draft"
  | "requests.submit"
  | "requests.cancel_own"
  | "requests.review"
  | "requests.request_changes"
  | "requests.approve"
  | "requests.reject"
  | "requests.cancel_approved"
  | "requests.close"
  | "requests.cost.read"
  | "reports.requests.read"
  | "reports.requests.export"
  | "transfers.read.own_branch"
  | "transfers.read.assigned_warehouse"
  | "transfers.read.all"
  | "transfers.create.from_request"
  | "transfers.create.direct"
  | "transfers.update_draft"
  | "transfers.submit"
  | "transfers.review"
  | "transfers.approve"
  | "transfers.cancel"
  | "transfers.reserve"
  | "transfers.release_reservation"
  | "transfers.pick"
  | "transfers.check_pick"
  | "transfers.pack"
  | "transfers.check_pack"
  | "transfers.dispatch"
  | "transfers.verify_dispatch"
  | "transfers.receive"
  | "transfers.report_discrepancy"
  | "transfers.resolve_discrepancy"
  | "transfers.cost.read"
  | "transfers.cost.create"
  | "transfers.cost.approve"
  | "transfers.cost.reconcile"
  | "transfers.close"
  | "reports.transfers.read"
  | "reports.transfers.export";

const rolePermissions: Readonly<Record<RoleId, readonly Permission[]>> = {
  system_administrator: [
    "organization.manage",
    "branch.manage",
    "warehouse.manage",
    "location.manage",
    "user.manage",
    "role.manage",
    "audit.read",
    "products.read",
    "products.create",
    "products.update",
    "inventory.read",
    "inventory.receive",
    "inventory.opening_stock",
    "inventory.move_internal",
    "inventory.adjust",
    "inventory.reverse",
    "inventory.count",
    "inventory.count_review",
    "inventory.reconcile",
    "inventory.cost.read",
    "inventory.cost.manage",
    "reports.inventory.read",
    "reports.inventory.export",
    "requests.read.all",
    "requests.create",
    "requests.update_draft",
    "requests.submit",
    "requests.cancel_own",
    "requests.review",
    "requests.request_changes",
    "requests.approve",
    "requests.reject",
    "requests.cancel_approved",
    "requests.close",
    "requests.cost.read",
    "reports.requests.read",
    "reports.requests.export",
    "transfers.read.all",
    "transfers.create.from_request",
    "transfers.create.direct",
    "transfers.update_draft",
    "transfers.submit",
    "transfers.review",
    "transfers.approve",
    "transfers.cancel",
    "transfers.reserve",
    "transfers.release_reservation",
    "transfers.pick",
    "transfers.check_pick",
    "transfers.pack",
    "transfers.check_pack",
    "transfers.dispatch",
    "transfers.verify_dispatch",
    "transfers.receive",
    "transfers.report_discrepancy",
    "transfers.resolve_discrepancy",
    "transfers.cost.read",
    "transfers.cost.create",
    "transfers.cost.approve",
    "transfers.cost.reconcile",
    "transfers.close",
    "reports.transfers.read",
    "reports.transfers.export",
  ],
  operations_administrator: [
    "user.manage",
    "products.read",
    "inventory.read",
    "inventory.reconcile",
    "reports.inventory.read",
    "reports.inventory.export",
    "requests.read.all",
    "requests.create",
    "requests.update_draft",
    "requests.submit",
    "requests.review",
    "requests.request_changes",
    "requests.approve",
    "requests.reject",
    "requests.cancel_approved",
    "requests.close",
    "reports.requests.read",
    "reports.requests.export",
    "transfers.read.all",
    "transfers.create.from_request",
    "transfers.create.direct",
    "transfers.update_draft",
    "transfers.submit",
    "transfers.review",
    "transfers.approve",
    "transfers.cancel",
    "transfers.reserve",
    "transfers.release_reservation",
    "transfers.resolve_discrepancy",
    "transfers.close",
    "reports.transfers.read",
    "reports.transfers.export",
  ],
  warehouse_manager: [
    "products.read",
    "products.create",
    "products.update",
    "inventory.read",
    "inventory.receive",
    "inventory.opening_stock",
    "inventory.move_internal",
    "inventory.adjust",
    "inventory.reverse",
    "inventory.count",
    "inventory.count_review",
    "inventory.reconcile",
    "inventory.cost.read",
    "inventory.cost.manage",
    "reports.inventory.read",
    "reports.inventory.export",
    "requests.read.all",
    "requests.review",
    "requests.request_changes",
    "requests.approve",
    "requests.reject",
    "requests.cancel_approved",
    "requests.close",
    "requests.cost.read",
    "reports.requests.read",
    "reports.requests.export",
    "transfers.read.assigned_warehouse",
    "transfers.create.from_request",
    "transfers.update_draft",
    "transfers.submit",
    "transfers.review",
    "transfers.approve",
    "transfers.cancel",
    "transfers.reserve",
    "transfers.release_reservation",
    "transfers.pick",
    "transfers.check_pick",
    "transfers.pack",
    "transfers.check_pack",
    "transfers.dispatch",
    "transfers.verify_dispatch",
    "transfers.report_discrepancy",
    "transfers.resolve_discrepancy",
    "transfers.cost.read",
    "transfers.cost.create",
    "transfers.cost.approve",
    "transfers.cost.reconcile",
    "transfers.close",
    "reports.transfers.read",
    "reports.transfers.export",
  ],
  warehouse_officer: [
    "products.read",
    "inventory.read",
    "inventory.count",
    "requests.read.all",
    "transfers.read.assigned_warehouse",
    "transfers.pick",
    "transfers.pack",
    "transfers.report_discrepancy",
  ],
  branch_requester: [
    "products.read",
    "requests.read.own_branch",
    "requests.create",
    "requests.update_draft",
    "requests.submit",
    "requests.cancel_own",
    "transfers.read.own_branch",
    "transfers.report_discrepancy",
  ],
  branch_manager: [
    "products.read",
    "inventory.read",
    "inventory.receive",
    "inventory.opening_stock",
    "inventory.move_internal",
    "inventory.adjust",
    "inventory.reverse",
    "inventory.count",
    "inventory.count_review",
    "inventory.reconcile",
    "reports.inventory.read",
    "reports.inventory.export",
    "requests.read.own_branch",
    "requests.create",
    "requests.update_draft",
    "requests.submit",
    "requests.cancel_own",
    "requests.cancel_approved",
    "requests.close",
    "reports.requests.read",
    "reports.requests.export",
    "transfers.read.own_branch",
    "transfers.receive",
    "transfers.report_discrepancy",
    "reports.transfers.read",
    "reports.transfers.export",
  ],
  logistics_officer: [
    "transfers.read.all",
    "transfers.pack",
    "transfers.dispatch",
    "transfers.cost.create",
    "transfers.report_discrepancy",
    "reports.transfers.read",
  ],
  finance_officer: [
    "products.read",
    "inventory.read",
    "inventory.cost.read",
    "reports.inventory.read",
    "reports.inventory.export",
    "requests.read.all",
    "requests.cost.read",
    "reports.requests.read",
    "reports.requests.export",
    "transfers.read.all",
    "transfers.cost.read",
    "transfers.cost.create",
    "transfers.cost.approve",
    "transfers.cost.reconcile",
    "reports.transfers.read",
    "reports.transfers.export",
  ],
  auditor: [
    "audit.read",
    "products.read",
    "inventory.read",
    "inventory.cost.read",
    "reports.inventory.read",
    "reports.inventory.export",
    "requests.read.all",
    "requests.cost.read",
    "reports.requests.read",
    "reports.requests.export",
    "transfers.read.all",
    "transfers.cost.read",
    "reports.transfers.read",
    "reports.transfers.export",
  ],
};
const assignableRoles: Readonly<Partial<Record<RoleId, readonly RoleId[]>>> = {
  system_administrator: roles,
  operations_administrator: [
    "warehouse_manager",
    "warehouse_officer",
    "branch_requester",
    "branch_manager",
    "logistics_officer",
    "auditor",
  ],
  warehouse_manager: ["warehouse_officer"],
  branch_manager: ["branch_requester"],
};

export interface AccessProfile {
  readonly userId: string;
  readonly organizationId: string;
  readonly roleId: RoleId;
  readonly roleIds?: readonly RoleId[];
  readonly branchIds: readonly string[];
  readonly warehouseIds: readonly string[];
  readonly authorizationVersion: number;
}
export interface OperatingContext {
  readonly type: "warehouse" | "branch";
  readonly id: string;
}

const organizationWideRoles: readonly RoleId[] = [
  "system_administrator",
  "operations_administrator",
  "finance_officer",
  "auditor",
];
const warehouseOperatingRoles: readonly RoleId[] = [
  "warehouse_manager",
  "warehouse_officer",
];
const branchOperatingRoles: readonly RoleId[] = [
  "branch_manager",
  "branch_requester",
];
function stringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : [];
}
function isRole(value: unknown): value is RoleId {
  return (
    typeof value === "string" && (roles as readonly string[]).includes(value)
  );
}

export function normalizeRoleIds(
  roleIds: unknown,
  legacyRoleId?: unknown,
): RoleId[] {
  const selected = new Set<RoleId>();
  if (Array.isArray(roleIds)) {
    for (const roleId of roleIds) if (isRole(roleId)) selected.add(roleId);
  }
  if (selected.size === 0 && isRole(legacyRoleId)) selected.add(legacyRoleId);
  return roles.filter((roleId) => selected.has(roleId));
}

export function accessRoleIds(
  actor: Pick<AccessProfile, "roleId" | "roleIds">,
): readonly RoleId[] {
  return normalizeRoleIds(actor.roleIds, actor.roleId);
}

export function hasRole(
  actor: Pick<AccessProfile, "roleId" | "roleIds">,
  roleId: RoleId,
): boolean {
  return accessRoleIds(actor).includes(roleId);
}

function requestedOperatingContext(data: unknown): OperatingContext | null {
  if (typeof data !== "object" || data === null) return null;
  const value = (data as Record<string, unknown>).operatingContext;
  if (typeof value !== "object" || value === null) return null;
  const { type, id } = value as Record<string, unknown>;
  return (type === "warehouse" || type === "branch") &&
    typeof id === "string" &&
    id.length > 0
    ? { type, id }
    : null;
}

export function applyOperatingContext(
  actor: AccessProfile,
  context: OperatingContext | null,
): AccessProfile {
  const assignedRoles = accessRoleIds(actor);
  if (assignedRoles.some((role) => organizationWideRoles.includes(role)))
    return actor;
  const availableContexts: OperatingContext[] = [
    ...(assignedRoles.some((role) => warehouseOperatingRoles.includes(role))
      ? actor.warehouseIds.map((id) => ({ type: "warehouse" as const, id }))
      : []),
    ...(assignedRoles.some((role) => branchOperatingRoles.includes(role))
      ? actor.branchIds.map((id) => ({ type: "branch" as const, id }))
      : []),
  ];
  const selectedContext = context ?? availableContexts[0] ?? null;
  if (!selectedContext) return actor;
  if (!context && availableContexts.length > 1)
    throw new HttpsError(
      "failed-precondition",
      "Select a branch or warehouse before continuing.",
      { code: "OPERATING_CONTEXT_REQUIRED", retryable: false },
    );
  const allowedRoles =
    selectedContext.type === "warehouse"
      ? warehouseOperatingRoles
      : branchOperatingRoles;
  const scopedRoles = assignedRoles.filter((role) => allowedRoles.includes(role));
  const assignedIds =
    selectedContext.type === "warehouse" ? actor.warehouseIds : actor.branchIds;
  if (scopedRoles.length === 0 || !assignedIds.includes(selectedContext.id)) {
    throw new HttpsError(
      "permission-denied",
      "The selected operating context is outside your assigned authority.",
      { code: "OPERATING_CONTEXT_INVALID", retryable: false },
    );
  }
  return {
    ...actor,
    roleId: scopedRoles[0]!,
    roleIds: scopedRoles,
    branchIds: selectedContext.type === "branch" ? [selectedContext.id] : [],
    warehouseIds:
      selectedContext.type === "warehouse" ? [selectedContext.id] : [],
  };
}

export function canAssignRole(actorRole: RoleId, targetRole: RoleId): boolean {
  return assignableRoles[actorRole]?.includes(targetRole) ?? false;
}
export function canAssignRoles(
  actor: Pick<AccessProfile, "roleId" | "roleIds">,
  targetRoles: readonly RoleId[],
): boolean {
  return targetRoles.every((targetRole) =>
    accessRoleIds(actor).some((actorRole) => canAssignRole(actorRole, targetRole)),
  );
}
export function assertAssignableRole(
  actor: AccessProfile,
  targetUserId: string | undefined,
  targetRole: RoleId,
): void {
  if (targetUserId === actor.userId)
    throw new HttpsError(
      "permission-denied",
      "You cannot change your own role.",
    );
  if (!canAssignRoles(actor, [targetRole]))
    throw new HttpsError(
      "permission-denied",
      "You cannot assign the requested role.",
    );
}
export function assertAssignableRoles(
  actor: AccessProfile,
  targetUserId: string | undefined,
  targetRoles: readonly RoleId[],
): void {
  if (targetUserId === actor.userId)
    throw new HttpsError(
      "permission-denied",
      "You cannot change your own roles.",
    );
  if (targetRoles.length === 0 || !canAssignRoles(actor, targetRoles))
    throw new HttpsError(
      "permission-denied",
      "You cannot assign one or more of the requested roles.",
    );
}
export function assertAssignmentScope(
  actor: AccessProfile,
  branchIds: readonly string[],
  warehouseIds: readonly string[],
): void {
  if (
    hasRole(actor, "system_administrator") ||
    hasRole(actor, "operations_administrator")
  )
    return;
  if (branchIds.some((id) => !actor.branchIds.includes(id)))
    throw new HttpsError(
      "permission-denied",
      "A branch assignment is outside your authority.",
    );
  if (warehouseIds.some((id) => !actor.warehouseIds.includes(id)))
    throw new HttpsError(
      "permission-denied",
      "A warehouse assignment is outside your authority.",
    );
}
export async function requireAuthenticatedUser(
  request: CallableRequest<unknown>,
): Promise<string> {
  if (!request.auth)
    throw new HttpsError("unauthenticated", "Authentication is required.");
  return request.auth.uid;
}
export async function requireAccess(
  request: CallableRequest<unknown>,
): Promise<AccessProfile> {
  const userId = await requireAuthenticatedUser(request);
  const snapshot = await db.collection("users").doc(userId).get();
  if (!snapshot.exists)
    throw new HttpsError(
      "permission-denied",
      "No warehouse access profile exists.",
    );
  const record = snapshot.data() as Record<string, unknown>;
  if (
    record.status !== "active" ||
    record.authDisabled === true ||
    typeof record.organizationId !== "string" ||
    normalizeRoleIds(record.roleIds, record.roleId).length === 0
  )
    throw new HttpsError(
      "permission-denied",
      "The warehouse access profile is inactive or invalid.",
    );
  const tokenOrganizationId = request.auth?.token.organizationId;
  if (
    typeof tokenOrganizationId === "string" &&
    tokenOrganizationId !== record.organizationId
  )
    throw new HttpsError(
      "permission-denied",
      "Your organization authorization has changed. Sign in again.",
      { code: "ORGANIZATION_MISMATCH", retryable: false },
    );
  const tokenAuthorizationVersion = request.auth?.token.authorizationVersion;
  if (
    typeof tokenAuthorizationVersion === "number" &&
    tokenAuthorizationVersion !== record.authorizationVersion
  )
    throw new HttpsError(
      "permission-denied",
      "Your authorization has changed. Refresh your session.",
      { code: "OUTDATED_VERSION", retryable: true },
    );
  const roleIds = normalizeRoleIds(record.roleIds, record.roleId);
  return applyOperatingContext({
    userId,
    organizationId: record.organizationId,
    roleId: roleIds[0]!,
    roleIds,
    branchIds: stringArray(record.branchIds),
    warehouseIds: stringArray(record.warehouseIds),
    authorizationVersion:
      typeof record.authorizationVersion === "number"
        ? record.authorizationVersion
        : 1,
  }, requestedOperatingContext(request.data));
}
export function requirePermission(
  actor: AccessProfile,
  permission: Permission,
): void {
  if (!hasServerPermission(actor, permission))
    throw new HttpsError(
      "permission-denied",
      "You do not have permission for this operation.",
    );
}
export function hasServerPermission(
  actor: AccessProfile,
  permission: Permission,
): boolean {
  if (hasRole(actor, "system_administrator")) return true;
  return accessRoleIds(actor).some((roleId) =>
    rolePermissions[roleId].includes(permission),
  );
}
export function requireWarehouseScope(
  actor: AccessProfile,
  warehouseId: string,
): void {
  if (
    [
      "system_administrator",
      "operations_administrator",
      "auditor",
      "finance_officer",
    ].some((roleId) => hasRole(actor, roleId as RoleId))
  )
    return;
  if (!actor.warehouseIds.includes(warehouseId))
    throw new HttpsError(
      "permission-denied",
      "The warehouse is outside your assigned scope.",
    );
}
export function requireBranchScope(
  actor: AccessProfile,
  branchId: string,
): void {
  if (
    [
      "system_administrator",
      "operations_administrator",
      "auditor",
      "finance_officer",
    ].some((roleId) => hasRole(actor, roleId as RoleId))
  )
    return;
  if (!actor.branchIds.includes(branchId))
    throw new HttpsError(
      "permission-denied",
      "The branch is outside your assigned scope.",
    );
}
export function requireOrganizationAccess(
  actor: AccessProfile,
  organizationId: string,
): void {
  if (actor.organizationId !== organizationId)
    throw new HttpsError(
      "permission-denied",
      "Cross-organization access is not permitted.",
    );
}
