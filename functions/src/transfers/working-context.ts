import { HttpsError } from "firebase-functions/v2/https";
import type { AccessProfile } from "../auth/authorize.js";

export type TransferActionSide = "source" | "destination" | "either" | "catalog";
/** A global reader base must not bypass the working-location selection of a
 * scoped mutation. Explicit organization authority remains action-specific. */
export function narrowTransferWorkingContext<T extends AccessProfile>(actor: T, data: unknown, globalAction: boolean, side: TransferActionSide): T {
  if (globalAction) return actor;
  const value = data && typeof data === "object" ? (data as Record<string, unknown>).operatingContext : undefined;
  if (value === undefined || value === null) {
    const count = side === "source" || side === "catalog" ? actor.warehouseIds.length : side === "destination" ? actor.branchIds.length : actor.warehouseIds.length + actor.branchIds.length;
    if (count > 1) throw new HttpsError("failed-precondition", "Select the working source or destination location before this transfer action.", { code: "OPERATING_CONTEXT_REQUIRED" });
    return actor;
  }
  if (typeof value !== "object" || Array.isArray(value)) throw new HttpsError("permission-denied", "Invalid working location.", { code: "OPERATING_CONTEXT_INVALID" });
  const { type, id } = value as Record<string, unknown>;
  if (typeof id !== "string" || !((type === "warehouse" && actor.warehouseIds.includes(id)) || (type === "branch" && actor.branchIds.includes(id))))
    throw new HttpsError("permission-denied", "The working location is outside your current assignment.", { code: "OPERATING_CONTEXT_INVALID" });
  return { ...actor, warehouseIds: type === "warehouse" ? [id] : [], branchIds: type === "branch" ? [id] : [] };
}
