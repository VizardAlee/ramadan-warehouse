import type { UserProfile } from "@/types/domain";
/** Client guard mirrors stored rules. The callable rechecks the live record. */
export function canReadAudit(profile: UserProfile | null): boolean {
  if (!profile || profile.status !== "active" || profile.authDisabled === true) return false;
  const has = (key: string) => Object.prototype.hasOwnProperty.call(profile, key);
  const roles = has("roleIds") ? (Array.isArray(profile.roleIds) ? profile.roleIds : []) : [profile.roleId];
  return roles.some(role => role === "auditor" || role === "system_administrator") &&
    (!has("effectivePermissions") || (Array.isArray(profile.effectivePermissions) && profile.effectivePermissions.includes("audit.read")));
}
