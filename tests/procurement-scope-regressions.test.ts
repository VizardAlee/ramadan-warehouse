import { beforeEach, describe, expect, it, vi } from "vitest";
import { accessProfileFromRecord, permissionsForServerRole, type Permission, type RoleId } from "../functions/src/auth/authorize";
import { buildRoleAssignment, type StoredRole } from "../functions/src/auth/custom-roles";
const state = vi.hoisted(() => ({ roles: [] as StoredRole[] }));
vi.mock("../functions/src/admin.js", () => ({ db: {} }));
vi.mock("../functions/src/auth/custom-roles.js", async original => ({
  ...await original<typeof import("../functions/src/auth/custom-roles")>(),
  loadCustomRoles: vi.fn(async () => state.roles),
}));
import { procurementAccess, requireProcurementScope, hasOrganizationProcurementPermission } from "../functions/src/procurement/authorize";

const writes: Permission[] = ["procurement.create", "procurement.approve", "procurement.receive", "payables.create", "payables.approve", "payables.pay", "inventory.reverse"];
function actor(direct: RoleId[] = ["warehouse_manager"], base: RoleId = "operations_administrator", permissions: Permission[] = ["procurement.read", "payables.read"]) {
  state.roles = [{ id: "procurement-scope-unit-reader", organizationId: "org", name: "Unit-only reader", baseRoleId: base, permissionIds: permissions, status: "active" }];
  return accessProfileFromRecord("staff", { status: "active", organizationId: "org", branchIds: ["own-branch"], warehouseIds: ["own-warehouse"], ...buildRoleAssignment(direct, state.roles) });
}
beforeEach(() => { state.roles = []; });
describe("procurement permission provenance and assigned store scope", () => {
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
});
