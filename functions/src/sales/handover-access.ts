import { HttpsError } from "firebase-functions/v2/https";
import { hasRole, hasServerPermission, type AccessProfile } from "../auth/authorize.js";

// The owner approved a physical handover exception only for this verified
// production organization and Civic Center branch. It is deliberately not a
// role permission: it must not grant cancellation or included-stock authority.
export const CIVIC_ORGANIZATION_ID = "I2wgZly4jehKd5Fjr4UJ";
export const CIVIC_BRANCH_ID = "gMaHGJYDkRodEfBjET6V";

type Branch = { exists: boolean; id: string; get(field: string): unknown };
export function canCollectPhysicalHandover(actor: AccessProfile, branch: Branch): boolean {
  if (hasServerPermission(actor, "sales.stock.release")) return true;
  return branch.exists && branch.id === CIVIC_BRANCH_ID &&
    actor.organizationId === CIVIC_ORGANIZATION_ID && branch.get("organizationId") === actor.organizationId &&
    branch.get("status") === "active" && actor.branchIds.includes(branch.id) &&
    (!actor.operatingContext || (actor.operatingContext.type === "branch" && actor.operatingContext.id === branch.id)) &&
    hasRole(actor, "sales_cashier") &&
    (hasServerPermission(actor, "sales.order.create") || hasServerPermission(actor, "sales.payment.accept"));
}
export function requirePhysicalHandover(actor: AccessProfile, branch: Branch): void {
  if (!canCollectPhysicalHandover(actor, branch))
    throw new HttpsError("permission-denied", "You do not have permission to record this physical handover.");
}
