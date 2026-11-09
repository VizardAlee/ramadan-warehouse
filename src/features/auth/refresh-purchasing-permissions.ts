import type { PermissionId, UserProfile } from "@/types/domain";
import { permissionsForRoles, roleIdsForProfile } from "@/lib/permissions/roles";

const purchasingPermission = (permission: string) => permission.startsWith("procurement.") || permission.startsWith("payables.") || permission.startsWith("suppliers.");

/** Resolve mixed custom-role provenance rather than retaining old Branch Manager grants. */
export async function refreshPurchasingPermissions(profile: UserProfile, read: () => Promise<{ permissions: PermissionId[] }>): Promise<UserProfile> {
  const roles = roleIdsForProfile(profile);
  if (!roles.includes("branch_manager") && !roles.includes("purchasing_manager")) return profile;
  const current = await read();
  const existing = profile.effectivePermissions ?? [...permissionsForRoles(roles)];
  return { ...profile, effectivePermissions: [...existing.filter(permission => !purchasingPermission(permission)), ...current.permissions.filter(purchasingPermission)] };
}

/** Offline snapshots cannot prove the provenance of old mixed custom grants. */
export function safeOfflinePurchasingPermissions(profile: UserProfile): UserProfile {
  if (!roleIdsForProfile(profile).includes("branch_manager") || !profile.customRoleIds?.length) return profile;
  const direct = profile.directRoleIds ?? [];
  const directPermissions = permissionsForRoles(direct);
  return { ...profile, effectivePermissions: profile.effectivePermissions?.filter(permission => !purchasingPermission(permission) || directPermissions.has(permission)) };
}
