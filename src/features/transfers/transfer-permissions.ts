import { hasPermission, roleIdsForProfile } from "@/lib/permissions/roles";
import type { UserProfile } from "@/types/domain";

/** Match the simple-transfer callable's existing direct-manager compatibility. */
export function canCreateStockTransfer(profile: UserProfile | null, fromRequest = false): boolean {
  if (!profile || profile.status !== "active") return false;
  if (hasPermission(profile, fromRequest ? "transfers.create.from_request" : "transfers.create.direct")) return true;
  const direct = profile.directRoleIds ?? (profile.effectivePermissions || profile.customRoleIds?.length ? [] : roleIdsForProfile(profile));
  return direct.some(role => ["system_administrator", "operations_administrator", "warehouse_manager", "branch_manager"].includes(role));
}
