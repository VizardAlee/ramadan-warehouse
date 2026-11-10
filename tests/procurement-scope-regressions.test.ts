import { beforeEach, describe, expect, it, vi } from "vitest";
import { accessProfileFromRecord, permissionsForServerRole, type Permission, type RoleId } from "../functions/src/auth/authorize";
import { buildRoleAssignment, type StoredRole } from "../functions/src/auth/custom-roles";
const state = vi.hoisted(() => ({ roles: [] as StoredRole[] }));
vi.mock("../functions/src/admin.js", () => ({ db: {} }));
vi.mock("../functions/src/auth/custom-roles.js", async original => ({
  ...await original<typeof import("../functions/src/auth/custom-roles")>(),
  loadCustomRoles: vi.fn(async () => state.roles),
}));
import { procurementAccess, requireProcurementScope, hasOrganizationProcurementPermission, hasProcurementScope, purchaseReceiptInventoryActor } from "../functions/src/procurement/authorize";

const writes: Permission[] = ["procurement.create", "procurement.approve", "procurement.receive", "payables.create", "payables.approve", "payables.pay", "inventory.reverse"];
function actor(direct: RoleId[] = ["warehouse_manager"], base: RoleId = "operations_administrator", permissions: Permission[] = ["procurement.read", "payables.read"]) {
  state.roles = [{ id: "procurement-scope-unit-reader", organizationId: "org", name: "Unit-only reader", baseRoleId: base, permissionIds: permissions, status: "active" }];
  return accessProfileFromRecord("staff", { status: "active", organizationId: "org", branchIds: ["own-branch"], warehouseIds: ["own-warehouse"], ...buildRoleAssignment(direct, state.roles) });
}
beforeEach(() => { state.roles = []; });
describe("procurement permission provenance and assigned store scope", () => {
  it("revokes Branch Manager purchasing even for old stored/custom grants", async () => {
    for (const profile of [actor(["branch_manager"], "branch_manager", ["procurement.read", "payables.pay"]), actor([], "branch_manager", ["procurement.read", "payables.pay"])]) {
      const access = await procurementAccess(profile);
      for (const permission of ["procurement.read", "payables.read", ...writes.filter(permission => permission !== "inventory.reverse")] as const) {
        expect(hasOrganizationProcurementPermission(access, permission)).toBe(false);
        expect(() => requireProcurementScope(access, { branchId: "own-branch" }, permission)).toThrow(/permission/);
      }
    }
  });
  it("preserves an independently granted reader without restoring Branch Manager writes", async () => {
    const access = await procurementAccess(actor(["branch_manager"], "auditor"));
    expect(() => requireProcurementScope(access, { branchId: "remote-branch" }, "procurement.read")).not.toThrow();
    for (const permission of writes.filter(permission => permission !== "inventory.reverse"))
      expect(() => requireProcurementScope(access, { branchId: "own-branch" }, permission)).toThrow(/permission/);
  });
  it.each(["operations_administrator", "auditor", "finance_officer"] as const)("does not lend a custom %s reader's global scope to manager writes", async base => {
    const access = await procurementAccess(actor(["warehouse_manager"], base));
    expect(hasOrganizationProcurementPermission(access, "procurement.read")).toBe(true);
    for (const permission of writes) {
      expect(() => requireProcurementScope(access, { warehouseId: "own-warehouse" }, permission)).not.toThrow();
      expect(() => requireProcurementScope(access, { warehouseId: "remote-warehouse" }, permission)).toThrow(/assigned store/);
      expect(() => requireProcurementScope(access, { branchId: "remote-branch" }, permission)).toThrow(/assigned store/);
    }
  });
  it("does not promote local manager writes through a direct auditor's global read", async () => {
    const access = await procurementAccess(actor(["warehouse_manager", "auditor"], "branch_manager", []));
    expect(() => requireProcurementScope(access, { branchId: "remote" }, "procurement.read")).not.toThrow();
    expect(() => requireProcurementScope(access, { warehouseId: "remote" }, "procurement.receive")).toThrow(/assigned store/);
  });
  it("keeps explicit global approval separate from local receipt and payment permissions", async () => {
    const profile = actor(["warehouse_manager"], "operations_administrator", ["procurement.read", "procurement.approve"]);
    const access = await procurementAccess(profile);
    expect(() => requireProcurementScope(access, { warehouseId: "remote" }, "procurement.approve")).not.toThrow();
    for (const permission of ["procurement.receive", "payables.approve", "payables.pay"] as const)
      expect(() => requireProcurementScope(access, { warehouseId: "remote" }, permission)).toThrow(/assigned store/);
    expect(() => requireProcurementScope(access, { warehouseId: "remote" }, ["procurement.receive", "procurement.approve"])).toThrow(/assigned store/);
    state.roles[0]!.permissionIds = ["procurement.read"];
    const refreshed = await procurementAccess(profile);
    expect(() => requireProcurementScope(refreshed, { warehouseId: "remote" }, "procurement.approve")).toThrow(/assigned store/);
  });
  it("honors explicit custom finance payment grants without widening receiving", async () => {
    const profile = actor(["warehouse_manager"], "finance_officer", ["payables.read", "payables.pay"]);
    const access = await procurementAccess(profile);
    expect(() => requireProcurementScope(access, { branchId: "remote" }, "payables.pay")).not.toThrow();
    expect(() => requireProcurementScope(access, { branchId: "remote" }, "procurement.receive")).toThrow(/assigned store/);
    state.roles[0]!.permissionIds = ["payables.read"];
    const refreshed = await procurementAccess(profile);
    expect(() => requireProcurementScope(refreshed, { branchId: "remote" }, "payables.pay")).toThrow(/assigned store/);
  });
  it("refreshes scoped custom permissions instead of trusting a stale effective-permission union", async () => {
    const profile = actor([], "warehouse_manager", ["procurement.read", "procurement.receive"]);
    expect(() => requireProcurementScope({ ...profile, organizationProcurementPermissions: [] }, { warehouseId: "own-warehouse" }, "procurement.receive")).not.toThrow();
    state.roles[0]!.permissionIds = ["procurement.read"];
    const access = await procurementAccess(profile);
    expect(() => requireProcurementScope(access, { warehouseId: "own-warehouse" }, "procurement.receive")).toThrow(/permission/);
  });
  it.each(["system_administrator", "operations_administrator", "finance_officer"] as const)("preserves legacy direct %s global grants", async role => {
    const profile = accessProfileFromRecord("legacy", { status: "active", organizationId: "org", roleId: role, roleIds: [role], branchIds: [], warehouseIds: [] });
    const access = await procurementAccess(profile);
    for (const permission of permissionsForServerRole(role))
      expect(() => requireProcurementScope(access, { warehouseId: "remote" }, permission)).not.toThrow();
  });
  it("fails closed with no recording store and checks both supplied store IDs", async () => {
    const access = await procurementAccess(actor());
    expect(() => requireProcurementScope(access, {}, "procurement.receive")).toThrow(/no operating location/);
    expect(() => requireProcurementScope(access, { branchId: "own-branch", warehouseId: "remote" }, "procurement.receive")).toThrow(/assigned store/);
  });
  it("grants Purchasing Manager the purchase workflow in branches and warehouses, not finance or direct stock writes", async () => {
    const access = await procurementAccess(actor(["purchasing_manager"], "purchasing_manager", []));
    for (const scope of [{ branchId: "future-branch" }, { warehouseId: "future-warehouse" }]) {
      for (const permission of ["procurement.read", "procurement.create", "procurement.approve", "procurement.receive", "payables.read", "payables.create", "payables.approve"] as const) {
        expect(hasProcurementScope(access, scope, permission)).toBe(true);
        expect(() => requireProcurementScope(access, scope, permission)).not.toThrow();
      }
      for (const permission of ["payables.pay", "inventory.adjust", "inventory.reverse", "banking.manage", "finance.journal.create"] as const)
        expect(() => requireProcurementScope(access, scope, permission)).toThrow();
    }
    const receiver = purchaseReceiptInventoryActor(access, { warehouseId: "future-warehouse" });
    expect(receiver.warehouseIds).toEqual(["future-warehouse"]);
    expect(receiver.branchIds).toEqual([]);
    expect(access.warehouseIds).toEqual(["own-warehouse"]);
  });
  it("isolates Purchasing Manager's selected warehouse and rejects ambiguous scope", async () => {
    const access = await procurementAccess(actor(["purchasing_manager"], "purchasing_manager", []));
    const selected = { ...access, operatingContext: { type: "warehouse" as const, id: "selected" } };
    expect(() => requireProcurementScope(selected, { warehouseId: "selected" }, "procurement.receive")).not.toThrow();
    for (const scope of [{ warehouseId: "other" }, { branchId: "other" }]) {
      expect(hasProcurementScope(selected, scope, "procurement.read")).toBe(false);
      expect(() => requireProcurementScope(selected, scope, "procurement.receive")).toThrow(/another operating location/);
    }
    expect(() => requireProcurementScope(access, { branchId: "remote", warehouseId: "remote" }, "procurement.receive")).toThrow();
  });
  it("does not lend custom purchasing read authority to warehouse-manager writes and refreshes revoked grants", async () => {
    const profile = actor(["warehouse_manager"], "purchasing_manager", ["procurement.read", "procurement.approve"]);
    const access = await procurementAccess(profile);
    expect(() => requireProcurementScope(access, { warehouseId: "remote" }, "procurement.read")).not.toThrow();
    expect(() => requireProcurementScope(access, { warehouseId: "remote" }, "procurement.approve")).not.toThrow();
    for (const permission of ["procurement.receive", "payables.pay", "inventory.reverse"] as const)
      expect(() => requireProcurementScope(access, { warehouseId: "remote" }, permission)).toThrow(/assigned store/);
    state.roles[0]!.permissionIds = ["procurement.read"];
    const refreshed = await procurementAccess(profile);
    expect(() => requireProcurementScope(refreshed, { warehouseId: "remote" }, "procurement.approve")).toThrow(/assigned store/);
  });

});
