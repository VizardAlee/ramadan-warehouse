import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import type { AccessProfile } from "../auth/authorize.js";
import { assertAssignmentScope } from "../auth/authorize.js";

export async function validateAssignments(actor: AccessProfile, branchIds: readonly string[], warehouseIds: readonly string[]): Promise<void> {
  assertAssignmentScope(actor, branchIds, warehouseIds);
  const references = [...branchIds.map((id) => db.collection("branches").doc(id)), ...warehouseIds.map((id) => db.collection("warehouses").doc(id))];
  if (references.length === 0) return;
  const snapshots = await db.getAll(...references);
  if (snapshots.some((snapshot) => !snapshot.exists || snapshot.get("organizationId") !== actor.organizationId)) throw new HttpsError("invalid-argument", "An assignment is invalid or outside the organization.");
}
