import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredRole } from "../functions/src/auth/custom-roles";
const state = vi.hoisted(() => ({ roles: [] as StoredRole[], branches: ["one", "two"] }));
vi.mock("../functions/src/admin.js", () => ({ db: { collection: () => ({ where: () => ({ select: () => ({ limit: () => ({ get: async () => ({ size: state.branches.length, docs: state.branches.map(id => ({ id })) }) }) }) }) }) } }));
vi.mock("../functions/src/auth/custom-roles.js", async original => ({ ...await original<typeof import("../functions/src/auth/custom-roles")>(), loadCustomRoles: vi.fn(async () => state.roles) }));
import { accessProfileFromRecord, type RoleId, type Permission } from "../functions/src/auth/authorize";
import { buildRoleAssignment } from "../functions/src/auth/custom-roles";
import { inventoryReadAccess, inventoryReadCosts, inventoryReadScope, inventoryLocationGroupSize } from "../functions/src/inventory/read-scope";
function profile(direct: RoleId[], base?: RoleId, permissions: Permission[] = []) {
  state.roles = base ? [{ id: "reader", organizationId: "org", name: "Reader", baseRoleId: base, permissionIds: permissions, status: "active" }] : [];
  return accessProfileFromRecord("reader", { organizationId: "org", status: "active", branchIds: ["own"], warehouseIds: ["assigned-warehouse"], ...buildRoleAssignment(direct, state.roles) });
}
beforeEach(() => { state.roles = []; state.branches = ["one", "two"]; });
describe("inventory read-only grant provenance", () => {
  it("gives Purchasing Manager branch quantities without organization or cost authority", async () => {
    const actor = await inventoryReadAccess(profile(["purchasing_manager"]));
    expect(inventoryReadScope(actor)).toEqual({ organization: false, allBranches: true, assigned: false });
    expect(actor.inventoryReadBranchIds).toEqual(["one", "two"]);
    expect(inventoryReadCosts(actor)).toBe(false);
    for (const permission of ["inventory.adjust", "inventory.opening_stock", "inventory.reconcile", "inventory.cost.read"]) expect(actor.effectivePermissions).not.toContain(permission);
  });
  it("uses any selected branch without widening warehouse stock reads", async () => {
    const profileValue = profile(["purchasing_manager"]);
    const branch = await inventoryReadAccess({ ...profileValue, operatingContext: { type: "branch", id: "remote" } });
    expect(branch.inventoryReadBranchIds).toEqual(["remote"]);
    const warehouse = await inventoryReadAccess({ ...profileValue, operatingContext: { type: "warehouse", id: "remote" } });
    expect(warehouse.inventoryReadBranchIds).toEqual([]);
    expect(inventoryReadScope(warehouse).assigned).toBe(false);
  });
  it("refreshes revoked custom purchasing grants rather than trusting stale effectivePermissions", async () => {
    const stale = profile([], "purchasing_manager", ["inventory.read"]);
    expect(inventoryReadScope(await inventoryReadAccess(stale)).allBranches).toBe(true);
    state.roles[0]!.permissionIds = ["procurement.read"];
    const actor = await inventoryReadAccess(stale);
    expect(actor.effectivePermissions).not.toContain("inventory.read");
    expect(inventoryReadScope(actor)).toEqual({ organization: false, allBranches: false, assigned: false });
  });
  it("does not lend an unrelated global custom role to local inventory", async () => {
    const actor = await inventoryReadAccess(profile(["branch_manager"], "finance_officer", ["finance.journal.read"]));
    expect(inventoryReadScope(actor)).toEqual({ organization: false, allBranches: false, assigned: true });
  });
  it("does not lend a purchasing custom role lacking inventory to local inventory", async () => {
    const actor = await inventoryReadAccess(profile(["branch_manager"], "purchasing_manager", ["procurement.read"]));
    expect(inventoryReadScope(actor)).toEqual({ organization: false, allBranches: false, assigned: true });
  });
  it("does not lend assigned warehouse cost authority to all-branch or remote branch reads", async () => {
    const base = profile(["purchasing_manager", "warehouse_manager"]);
    expect(inventoryReadCosts(await inventoryReadAccess(base))).toBe(false);
    expect(inventoryReadCosts(await inventoryReadAccess({ ...base, operatingContext: { type: "branch", id: "remote" } }))).toBe(false);
    expect(inventoryReadCosts(await inventoryReadAccess({ ...base, operatingContext: { type: "warehouse", id: "assigned-warehouse" } }))).toBe(true);
  });
  it("never lends warehouse costs to the user's own branch", async () => {
    const base = profile(["purchasing_manager", "warehouse_manager"]);
    const ownBranch = await inventoryReadAccess({ ...base, operatingContext: { type: "branch", id: "own" } });
    expect(ownBranch.inventoryReadBranchIds).toEqual(["own"]);
    expect(ownBranch.inventoryCostBranchIds).toEqual([]);
    expect(inventoryReadCosts(ownBranch)).toBe(false);
  });
  it("does not lend branch inventory to a custom warehouse base with no inventory grant", async () => {
    const base = profile(["branch_manager"], "warehouse_manager", ["products.read"]);
    const actor = await inventoryReadAccess(base);
    expect(actor.inventoryReadBranchIds).toEqual(["own"]);
    expect(actor.inventoryReadWarehouseIds).toEqual([]);
    expect((await inventoryReadAccess({ ...base, operatingContext: { type: "warehouse", id: "assigned-warehouse" } })).inventoryReadWarehouseIds).toEqual([]);
  });
  it("retains custom warehouse quantities but only explicit current warehouse cost grants", async () => {
    const base = profile(["purchasing_manager"], "warehouse_manager", ["inventory.read", "inventory.cost.read"]);
    const warehouse = { ...base, operatingContext: { type: "warehouse" as const, id: "assigned-warehouse" } };
    expect(inventoryReadCosts(await inventoryReadAccess(warehouse))).toBe(true);
    expect(inventoryReadCosts(await inventoryReadAccess({ ...base, operatingContext: { type: "branch", id: "own" } }))).toBe(false);
    state.roles[0]!.permissionIds = ["inventory.read"];
    const revoked = await inventoryReadAccess(warehouse);
    expect(revoked.inventoryReadWarehouseIds).toEqual(["assigned-warehouse"]);
    expect(inventoryReadCosts(revoked)).toBe(false);
  });
  it("does not lend warehouse inventory to a custom branch base with no inventory grant", async () => {
    const actor = await inventoryReadAccess(profile(["warehouse_manager"], "branch_manager", ["products.read"]));
    expect(actor.inventoryReadBranchIds).toEqual([]);
    expect(actor.inventoryReadWarehouseIds).toEqual(["assigned-warehouse"]);
  });
  it("bounds location IN groups by scope disjuncts and narrows selected views first", async () => {
    const base = profile(["branch_manager", "warehouse_manager"]);
    const actor = await inventoryReadAccess({ ...base, branchIds: ["a", "b"], warehouseIds: ["w"] });
    expect(inventoryLocationGroupSize(actor)).toBe(10);
    const selected = await inventoryReadAccess({ ...base, branchIds: ["a", "b"], warehouseIds: ["w"], operatingContext: { type: "branch", id: "a" } });
    expect(selected.inventoryReadBranchIds).toEqual(["a"]);
    expect(selected.inventoryReadWarehouseIds).toEqual([]);
    expect(inventoryLocationGroupSize(selected)).toBe(30);
  });
  it("retains independently granted global costs", async () => {
    const actor = await inventoryReadAccess(profile(["purchasing_manager", "finance_officer"]));
    expect(inventoryReadScope(actor).organization).toBe(true);
    expect(inventoryReadCosts(actor)).toBe(true);
  });
  it("fails explicitly above the All-branches bound while allowing a selected branch", async () => {
    state.branches = Array.from({ length: 31 }, (_, index) => `branch-${index}`);
    const base = profile(["purchasing_manager"]);
    await expect(inventoryReadAccess(base)).rejects.toThrow("Choose one branch");
    expect((await inventoryReadAccess({ ...base, operatingContext: { type: "branch", id: "branch-30" } })).inventoryReadBranchIds).toEqual(["branch-30"]);
  });
});
