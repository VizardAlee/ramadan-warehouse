import { Filter, type Query } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import type { AccessProfile } from "./authorize.js";

/** View filtering never grants permission; callers retain their authorization checks. */
export function viewQuery<T extends FirebaseFirestore.DocumentData>(actor: AccessProfile, query: Query<T>, fields?: { branch?: string[]; warehouse?: string[] }): Query<T> {
  const context = actor.operatingContext;
  if (!context) return query;
  const keys = context.type === "branch" ? fields?.branch ?? ["branchId"] : fields?.warehouse ?? ["warehouseId"];
  if (!keys.length) throw new HttpsError("failed-precondition", "This organization-wide workspace requires All locations.");
  const filters = keys.map(key => Filter.where(key, "==", context.id));
  return query.where(filters.length === 1 ? filters[0]! : Filter.or(...filters));
}

export function matchesView(actor: AccessProfile, record: Record<string, unknown>, fields?: { branch?: string[]; warehouse?: string[] }): boolean {
  const context = actor.operatingContext;
  if (!context) return true;
  const keys = context.type === "branch" ? fields?.branch ?? ["branchId"] : fields?.warehouse ?? ["warehouseId"];
  return keys.some(key => record[key] === context.id);
}

export function requireView(actor: AccessProfile, record: Record<string, unknown>, fields?: { branch?: string[]; warehouse?: string[] }): void {
  if (!matchesView(actor, record, fields)) throw new HttpsError("failed-precondition", "This record belongs to another operating location. Select that location to open it.", { code: "OPERATING_CONTEXT_MISMATCH", retryable: false });
}

export function requireAllLocations(actor: AccessProfile): void {
  if (actor.operatingContext) throw new HttpsError("failed-precondition", "This company-wide action requires All locations. Select All locations before continuing.", { code: "ALL_LOCATIONS_REQUIRED", retryable: false });
}

/** Clip an All-branches read to the existing branch assignments, before paging or aggregation. */
export function assignedBranchQuery<T extends FirebaseFirestore.DocumentData>(actor: AccessProfile, query: Query<T>, organizationWide: boolean, branchId?: string): Query<T> {
  if (branchId) return query.where("branchId", "==", branchId);
  if (organizationWide) return viewQuery(actor, query);
  const ids = [...new Set(actor.branchIds)];
  if (!ids.length) throw new HttpsError("permission-denied", "No branches are assigned for this read.");
  if (ids.length > 30) throw new HttpsError("resource-exhausted", "Choose one branch to read this register; no partial All-branches results were returned.");
  return query.where("branchId", "in", ids);
}
