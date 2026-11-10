import { hasPermission } from "@/lib/permissions/roles";
import type { UserProfile } from "@/types/domain";

/** Only current purchasing/admin grants may initiate transfers. */
export function canCreateStockTransfer(profile: UserProfile | null, fromRequest = false): boolean {
  if (!profile || profile.status !== "active") return false;
  if (hasPermission(profile, fromRequest ? "transfers.create.from_request" : "transfers.create.direct")) return true;
  return false;
}
