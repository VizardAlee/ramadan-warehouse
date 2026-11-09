import { HttpsError } from "firebase-functions/v2/https";
import { accessRoleIds, permissionsForServerRole, type AccessProfile, type Permission, type RoleId } from "./authorize.js";
import { loadCustomRoles } from "./custom-roles.js";

const globalRoles: readonly RoleId[] = ["system_administrator", "operations_administrator", "finance_officer", "auditor"];
export type ScopedAccess = AccessProfile & { readonly organizationPermissions: readonly Permission[]; readonly allBranchPermissions?: readonly Permission[]; readonly assignedPermissions?: readonly Permission[] };

/** Resolve current grants and preserve the scope of each permission's granting role. */
export async function scopedAccess(actor: AccessProfile, options: { excludeRoles?: readonly RoleId[] } = {}): Promise<ScopedAccess> {
  const direct = (actor.directRoleIds ?? (actor.customRoleIds?.length || actor.effectivePermissions ? [] : accessRoleIds(actor))).filter(role => !options.excludeRoles?.includes(role));
  const custom = actor.customRoleIds?.length ? await loadCustomRoles(actor.organizationId, actor.customRoleIds) : [];
  const grants = custom.filter(role => role.baseRoleId !== "system_administrator" && !options.excludeRoles?.includes(role.baseRoleId)).map(role => ({
    ...role, permissionIds: role.permissionIds.filter(permission => permissionsForServerRole(role.baseRoleId).includes(permission)),
  }));
  return { ...actor, directRoleIds: direct,
    effectivePermissions: [...new Set([...direct.flatMap(permissionsForServerRole), ...grants.flatMap(role => role.permissionIds)])],
    assignedPermissions: [...new Set([
      ...direct.filter(role => role !== "purchasing_manager").flatMap(permissionsForServerRole),
      ...grants.filter(role => role.baseRoleId !== "purchasing_manager").flatMap(role => role.permissionIds),
    ])],
    // Branch-only purchasing authority never lends warehouse or general finance scope.
    allBranchPermissions: [...new Set([
      ...direct.filter(role => role === "purchasing_manager").flatMap(permissionsForServerRole),
      ...grants.filter(role => role.baseRoleId === "purchasing_manager").flatMap(role => role.permissionIds),
    ])],
    organizationPermissions: [...new Set([
      ...direct.filter(role => globalRoles.includes(role)).flatMap(permissionsForServerRole),
      ...grants.filter(role => globalRoles.includes(role.baseRoleId)).flatMap(role => role.permissionIds),
    ])],
  };
}
export function hasOrganizationPermission(actor: ScopedAccess, permission: Permission) {
  return actor.organizationPermissions.includes(permission);
}
export function hasPermissionScope(actor: ScopedAccess, scope: { branchId?: string; warehouseId?: string }, permission: Permission) {
  const selected = actor.operatingContext;
  if (selected && (scope.branchId || scope.warehouseId) && (selected.type === "branch" ? scope.branchId !== selected.id : scope.warehouseId !== selected.id)) return false;
  return Boolean(actor.effectivePermissions?.includes(permission)) && (hasOrganizationPermission(actor, permission) ||
    Boolean(scope.branchId || scope.warehouseId) && (!scope.branchId || actor.branchIds.includes(scope.branchId)) &&
    (!scope.warehouseId || actor.warehouseIds.includes(scope.warehouseId)));
}
export function requirePermissionScope(actor: ScopedAccess, scope: { branchId?: string; warehouseId?: string }, permission: Permission) {
  if (!hasPermissionScope(actor, scope, permission))
    throw new HttpsError("permission-denied", "This financial action requires its own permission for the selected store. Choose an assigned store or ask authorized finance staff.");
}
