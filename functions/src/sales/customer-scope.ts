import { HttpsError } from "firebase-functions/v2/https";
import { accessRoleIds, permissionsForServerRole, type AccessProfile, type Permission } from "../auth/authorize.js";

type CustomerAccess = AccessProfile & { organizationPermissions?: readonly Permission[] };
export function customerInView(actor: CustomerAccess, customer: Record<string, unknown>, permission: Permission = "customers.read"): boolean {
  if (customer.organizationId !== actor.organizationId) return false;
  const branchId = typeof customer.branchId === "string" ? customer.branchId : undefined;
  const direct = actor.directRoleIds ?? (actor.customRoleIds?.length ? [] : accessRoleIds(actor));
  const organizationWide = actor.organizationPermissions ? actor.organizationPermissions.includes(permission) : direct.some(role => (["system_administrator", "operations_administrator", "finance_officer", "auditor"] as string[]).includes(role) && permissionsForServerRole(role).includes(permission));
  if (actor.operatingContext && (actor.operatingContext.type !== "branch" || !branchId || branchId !== actor.operatingContext.id)) return false;
  return organizationWide || Boolean(branchId && actor.branchIds.includes(branchId));
}
export function requireCustomerView(actor: CustomerAccess, customer: Record<string, unknown>, permission: Permission = "customers.read"): void {
  if (!customerInView(actor, customer, permission)) throw new HttpsError("permission-denied", "This customer is outside the selected customer branch or needs ownership review.", { code: "CUSTOMER_BRANCH_REQUIRED", retryable: false });
}
export function requireCustomerBranch(customer: Record<string, unknown>, branchId: string): void {
  if (customer.branchId !== branchId) throw new HttpsError("failed-precondition", "Choose a customer assigned to this branch. Unassigned customers require ownership review.", { code: "CUSTOMER_BRANCH_REQUIRED", retryable: false });
}
