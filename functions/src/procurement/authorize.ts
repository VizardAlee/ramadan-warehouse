import { HttpsError } from "firebase-functions/v2/https";
import { accessRoleIds, permissionsForServerRole, hasServerPermission, requirePermission, type AccessProfile, type Permission, type RoleId } from "../auth/authorize.js";
import { loadCustomRoles } from "../auth/custom-roles.js";

const globalRoles: readonly RoleId[] = ["system_administrator", "operations_administrator", "finance_officer", "auditor"];
export type ProcurementAccess = AccessProfile & { readonly organizationProcurementPermissions: readonly Permission[] };

/** Refresh custom grants without writing profiles; retain each grant's scope provenance. */
export async function procurementAccess(actor: AccessProfile): Promise<ProcurementAccess> {
  const direct = actor.directRoleIds ?? (actor.customRoleIds?.length || actor.effectivePermissions ? [] : accessRoleIds(actor));
  const custom = actor.customRoleIds?.length ? await loadCustomRoles(actor.organizationId, actor.customRoleIds) : [];
  const directPermissions = direct.flatMap(permissionsForServerRole);
  const validCustom = custom.filter(role => role.baseRoleId !== "system_administrator");
  const grants = validCustom.map(role => ({ ...role, permissionIds: role.permissionIds.filter(permission => permissionsForServerRole(role.baseRoleId).includes(permission)) }));
  return { ...actor, directRoleIds: direct,
    effectivePermissions: [...new Set([...directPermissions, ...grants.flatMap(role => role.permissionIds)])],
    organizationProcurementPermissions: [...new Set([
      ...direct.filter(role => globalRoles.includes(role)).flatMap(permissionsForServerRole),
      ...grants.filter(role => globalRoles.includes(role.baseRoleId)).flatMap(role => role.permissionIds),
    ])],
  };
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
