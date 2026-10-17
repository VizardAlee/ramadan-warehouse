import { HttpsError } from "firebase-functions/v2/https";
import { hasServerPermission, requirePermission, type AccessProfile, type Permission } from "../auth/authorize.js";
import { scopedAccess } from "../auth/permission-scope.js";

export type ProcurementAccess = AccessProfile & { readonly organizationProcurementPermissions: readonly Permission[] };

export async function procurementAccess(actor: AccessProfile): Promise<ProcurementAccess> {
  const access = await scopedAccess(actor);
  return { ...access, organizationProcurementPermissions: access.organizationPermissions };
}

export function hasOrganizationProcurementPermission(actor: ProcurementAccess, permission: Permission) {
  return actor.organizationProcurementPermissions.includes(permission);
}

/** Read projections must use the provenance of the data's own permission. */
export function hasProcurementScope(actor: ProcurementAccess, scope: { branchId?: string; warehouseId?: string }, permission: Permission) {
  if (!hasServerPermission(actor, permission)) return false;
  if (hasOrganizationProcurementPermission(actor, permission)) return true;
  return Boolean(scope.branchId || scope.warehouseId) &&
    (!scope.branchId || actor.branchIds.includes(scope.branchId)) &&
    (!scope.warehouseId || actor.warehouseIds.includes(scope.warehouseId));
}

/** Every required action needs its own global grant or an assigned recording store. */
export function requireProcurementScope(actor: ProcurementAccess, scope: { branchId?: string; warehouseId?: string }, permissions: Permission | readonly Permission[]) {
  const required = typeof permissions === "string" ? [permissions] : permissions;
  for (const permission of required) {
    requirePermission(actor, permission);
    if (hasOrganizationProcurementPermission(actor, permission)) continue;
    if ((scope.branchId && !actor.branchIds.includes(scope.branchId)) ||
      (scope.warehouseId && !actor.warehouseIds.includes(scope.warehouseId)))
      throw new HttpsError("permission-denied", "This procurement action is outside your assigned store authority.");
  }
  if (!scope.branchId && !scope.warehouseId)
    throw new HttpsError("failed-precondition", "The procurement record has no operating location.");
}
