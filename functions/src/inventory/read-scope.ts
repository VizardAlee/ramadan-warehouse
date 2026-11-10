import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import { scopedAccess, type ScopedAccess } from "../auth/permission-scope.js";
import { permissionsForServerRole, type AccessProfile, type Permission, type RoleId } from "../auth/authorize.js";
import { loadCustomRoles } from "../auth/custom-roles.js";

export type InventoryReadAccess = ScopedAccess & {
  readonly inventoryReadBranchIds: readonly string[];
  readonly inventoryReadWarehouseIds: readonly string[];
  readonly inventoryCostBranchIds: readonly string[];
  readonly inventoryCostWarehouseIds: readonly string[];
};
export function inventoryLocationGroupSize(actor: InventoryReadAccess) {
  if (inventoryReadScope(actor).organization) return 30;
  const count = actor.inventoryReadBranchIds.length + actor.inventoryReadWarehouseIds.length;
  if (count > 30) throw new HttpsError("resource-exhausted", "Choose one location to view inventory.");
  return Math.floor(30 / Math.max(1, count));
}
export function inventoryReadScope(actor: ScopedAccess) {
  const allowed = actor.effectivePermissions?.includes("inventory.read");
  return {
    organization: Boolean(allowed && actor.organizationPermissions.includes("inventory.read")),
    allBranches: Boolean(allowed && actor.allBranchPermissions?.includes("inventory.read")),
    assigned: Boolean(allowed && actor.assignedPermissions?.includes("inventory.read")),
  };
}
/** Refresh custom-role grants before deriving inventory-specific read authority. */
export async function inventoryReadAccess(profile: AccessProfile): Promise<InventoryReadAccess> {
  const actor = await scopedAccess(profile);
  const scope = inventoryReadScope(actor);
  // Keep each location kind tied to the role that actually grants this permission.
  // A custom role's base alone is not a grant, and another role cannot lend it one.
  const custom = actor.customRoleIds?.length ? await loadCustomRoles(actor.organizationId, actor.customRoleIds) : [];
  const grants = [
    ...(actor.directRoleIds ?? []).map(role => ({ role, permissions: permissionsForServerRole(role) })),
    ...custom.filter(role => role.baseRoleId !== "system_administrator").map(role => ({ role: role.baseRoleId,
      permissions: role.permissionIds.filter(permission => permissionsForServerRole(role.baseRoleId).includes(permission)) })),
  ];
  const grantsKind = (roles: readonly RoleId[], permission: Permission) => grants.some(grant => roles.includes(grant.role) && grant.permissions.includes(permission));
  const branchRoles: readonly RoleId[] = ["branch_manager"];
  const warehouseRoles: readonly RoleId[] = ["warehouse_manager", "warehouse_officer"];
  let ids: string[] = [];
  if (scope.allBranches && !scope.organization) {
    if (actor.operatingContext?.type === "branch") ids = [actor.operatingContext.id];
    else if (!actor.operatingContext) {
      const branches = await db.collection("branches").where("organizationId", "==", actor.organizationId).select().limit(31).get();
      if (branches.size > 30) throw new HttpsError("resource-exhausted", "Choose one branch to view inventory; All branches supports at most 30 branches.");
      ids = branches.docs.map(document => document.id);
    }
  }
  const context = actor.operatingContext;
  const narrow = (kind: "branch" | "warehouse", values: readonly string[]) => [...new Set(values)].filter(id => !context || context.type === kind && context.id === id);
  return { ...actor,
    inventoryReadBranchIds: narrow("branch", [...ids, ...(grantsKind(branchRoles, "inventory.read") ? actor.branchIds : [])]),
    inventoryReadWarehouseIds: narrow("warehouse", grantsKind(warehouseRoles, "inventory.read") ? actor.warehouseIds : []),
    inventoryCostBranchIds: narrow("branch", grantsKind(branchRoles, "inventory.cost.read") ? actor.branchIds : []),
    inventoryCostWarehouseIds: narrow("warehouse", grantsKind(warehouseRoles, "inventory.cost.read") ? actor.warehouseIds : []),
  };
}
export function inventoryReadCosts(actor: InventoryReadAccess) {
  if (!actor.effectivePermissions?.includes("inventory.cost.read")) return false;
  if (actor.organizationPermissions.includes("inventory.cost.read")) return true;
  const scope = inventoryReadScope(actor);
  // Every readable location must be covered by its own cost grant. In particular,
  // warehouse costs cannot accompany branch reads granted by Purchasing Manager.
  if (scope.organization) return false;
  const hasLocations = actor.inventoryReadBranchIds.length + actor.inventoryReadWarehouseIds.length > 0;
  return hasLocations && actor.inventoryReadBranchIds.every(id => actor.inventoryCostBranchIds.includes(id)) &&
    actor.inventoryReadWarehouseIds.every(id => actor.inventoryCostWarehouseIds.includes(id));
}
