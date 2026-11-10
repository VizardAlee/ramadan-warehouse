import { matchesView, requireView } from "../auth/view-scope.js";
import { HttpsError } from "firebase-functions/v2/https";
import { hasServerPermission, requirePermission, type AccessProfile, type Permission, type RoleId } from "../auth/authorize.js";
import { scopedAccess } from "../auth/permission-scope.js";

export type ProcurementAccess = AccessProfile & { readonly organizationProcurementPermissions: readonly Permission[]; readonly allBranchProcurementPermissions?: readonly Permission[]; readonly assignedProcurementPermissions?: readonly Permission[] };

export async function procurementAccess(actor: AccessProfile, options: { excludeRoles?: readonly RoleId[] } = {}): Promise<ProcurementAccess> {
  const access = await scopedAccess(actor, options);
  return { ...access, organizationProcurementPermissions: access.organizationPermissions, allBranchProcurementPermissions: access.allBranchPermissions, assignedProcurementPermissions: access.assignedPermissions };
}

export function hasOrganizationProcurementPermission(actor: ProcurementAccess, permission: Permission) {
  return actor.organizationProcurementPermissions.includes(permission);
}

export function hasAllBranchProcurementPermission(actor: ProcurementAccess, permission: Permission) {
  return actor.allBranchProcurementPermissions?.includes(permission) ?? false;
}
// The purchasing grant is intentionally interpreted here, not by generic
// financial/inventory authorization. Each custom permission retains provenance.
const purchasingLocationPermissions: readonly Permission[] = [
  "procurement.read", "procurement.create", "procurement.approve", "procurement.receive",
  "payables.read", "payables.create", "payables.approve",
];
function allPurchasingLocationGrant(actor: ProcurementAccess, scope: { branchId?: string; warehouseId?: string }, permission: Permission) {
  return Boolean(scope.branchId) !== Boolean(scope.warehouseId) && purchasingLocationPermissions.includes(permission) && hasAllBranchProcurementPermission(actor, permission);
}

/** Read projections must use the provenance of the data's own permission. */
export function hasProcurementScope(actor: ProcurementAccess, scope: { branchId?: string; warehouseId?: string }, permission: Permission) {
  if (!matchesView(actor, scope)) return false;
  if (!hasServerPermission(actor, permission)) return false;
  if (hasOrganizationProcurementPermission(actor, permission) || allPurchasingLocationGrant(actor, scope, permission)) return true;
  return (actor.assignedProcurementPermissions?.includes(permission) ?? true) && Boolean(scope.branchId || scope.warehouseId) &&
    (!scope.branchId || actor.branchIds.includes(scope.branchId)) &&
    (!scope.warehouseId || actor.warehouseIds.includes(scope.warehouseId));
}

/** Every required action needs its own global grant or an assigned recording store. */
export function requireProcurementScope(actor: ProcurementAccess, scope: { branchId?: string; warehouseId?: string }, permissions: Permission | readonly Permission[]) {
  requireView(actor, scope);
  const required = typeof permissions === "string" ? [permissions] : permissions;
  for (const permission of required) {
    requirePermission(actor, permission);
    if (hasOrganizationProcurementPermission(actor, permission) || allPurchasingLocationGrant(actor, scope, permission)) continue;
    if (((scope.branchId || scope.warehouseId) && actor.assignedProcurementPermissions && !actor.assignedProcurementPermissions.includes(permission)) ||
      (scope.branchId && !actor.branchIds.includes(scope.branchId)) ||
      (scope.warehouseId && !actor.warehouseIds.includes(scope.warehouseId)))
      throw new HttpsError("permission-denied", "This procurement action is outside your assigned store authority.");
  }
  if (!scope.branchId && !scope.warehouseId)
    throw new HttpsError("failed-precondition", "The procurement record has no operating location.");
}

/** A validated purchase receipt may post inventory only into its order's store.
 * This does not grant generic inventory actions or persist new assignments.
 */
export function purchaseReceiptInventoryActor(actor: ProcurementAccess, scope: { branchId?: string; warehouseId?: string }): ProcurementAccess {
  requireProcurementScope(actor, scope, "procurement.receive");
  return { ...actor, branchIds: scope.branchId ? [scope.branchId] : [], warehouseIds: scope.warehouseId ? [scope.warehouseId] : [] };
}
