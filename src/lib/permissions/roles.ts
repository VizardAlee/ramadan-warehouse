import type { PermissionId, RoleId, UserProfile } from "@/types/domain";

const permissionsByRole: Readonly<Record<RoleId, readonly PermissionId[]>> = {
  system_administrator: ["organization.manage", "branch.manage", "warehouse.manage", "location.manage", "user.manage", "role.manage"],
  operations_administrator: ["report.read", "request.approve", "transfer.create", "transfer.approve"],
  warehouse_manager: ["report.read", "request.approve", "transfer.approve", "inventory.operate", "logistics.manage"],
  warehouse_officer: ["inventory.operate"],
  branch_requester: ["request.create"],
  branch_manager: ["request.create", "request.approve", "receipt.confirm"],
  logistics_officer: ["logistics.manage", "cost.create"],
  finance_officer: ["report.read", "cost.create", "cost.approve"],
  auditor: ["audit.read", "report.read", "report.export"],
};

export function permissionsForRoles(roleIds: readonly RoleId[]): ReadonlySet<PermissionId> {
  return new Set(roleIds.flatMap((roleId) => permissionsByRole[roleId]));
}

export function hasPermission(
  profile: Pick<UserProfile, "status" | "roleIds" | "permissionOverrides">,
  permission: PermissionId,
): boolean {
  if (profile.status !== "active") return false;
  return profile.permissionOverrides.includes(permission) || permissionsForRoles(profile.roleIds).has(permission);
}

export function isAssignedToBranch(profile: Pick<UserProfile, "branchIds">, branchId: string): boolean {
  return profile.branchIds.includes(branchId);
}
