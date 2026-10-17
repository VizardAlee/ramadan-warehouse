import type { PermissionId } from "@/types/domain";

export interface ExpenseScope { branchId?: string; warehouseId?: string }
export interface ExpenseAccess {
  permissions: PermissionId[]; organizationPermissions: PermissionId[];
  branchIds: string[]; warehouseIds: string[];
}
export function hasExpenseScope(access: ExpenseAccess | undefined, scope: ExpenseScope, permission: PermissionId) {
  return Boolean(access?.permissions.includes(permission) && (access.organizationPermissions.includes(permission) ||
    Boolean(scope.branchId || scope.warehouseId) && (!scope.branchId || access.branchIds.includes(scope.branchId)) &&
    (!scope.warehouseId || access.warehouseIds.includes(scope.warehouseId))));
}
export function defaultExpenseScope(access: ExpenseAccess, permission: PermissionId, preferred?: ExpenseScope): ExpenseScope | null {
  if (preferred) return hasExpenseScope(access, preferred, permission) ? preferred : null;
  if (hasExpenseScope(access, {}, permission)) return {};
  if (!access.permissions.includes(permission)) return null;
  if (access.branchIds[0]) return { branchId: access.branchIds[0] };
  if (access.warehouseIds[0]) return { warehouseId: access.warehouseIds[0] };
  return null;
}
export function expenseScopeKey(scope: ExpenseScope | null) {
  return scope?.branchId ? `branch:${scope.branchId}` : scope?.warehouseId ? `warehouse:${scope.warehouseId}` : scope ? "organization" : "";
}
export function expenseScopeFromKey(key: string): ExpenseScope | undefined {
  return key.startsWith("branch:") ? { branchId: key.slice(7) } : key.startsWith("warehouse:") ? { warehouseId: key.slice(10) } : key === "organization" ? {} : undefined;
}
