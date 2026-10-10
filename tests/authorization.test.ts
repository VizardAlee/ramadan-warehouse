import { describe, expect, it } from "vitest";
import { accessProfileFromRecord, applyOperatingContext, assertAssignableRole, assertAssignableRoles, assertAssignmentScope, canAssignRole, hasServerPermission, requireBranchScope, requireWarehouseScope, type AccessProfile } from "../functions/src/auth/authorize";
import { buildRoleAssignment } from "../functions/src/auth/custom-roles";
import { hasPermission } from "../src/lib/permissions/roles";

const actor = (roleId: AccessProfile["roleId"]): AccessProfile => ({ userId: "actor", organizationId: "org", roleId, branchIds: ["b1"], warehouseIds: ["w1"], authorizationVersion: 1 });
describe("server authorization controls", () => {
  it("uses all current roles and explicit custom permissions for stored counter profiles", () => {
    const record = { organizationId: "org", status: "active", roleId: "sales_cashier", roleIds: ["sales_cashier", "system_administrator"], branchIds: [], warehouseIds: [] };
    const global = accessProfileFromRecord("counter", record);
    expect(hasServerPermission(global, "inventory.count")).toBe(true);
    expect(() => requireBranchScope(global, "hq")).not.toThrow();
    expect(() => requireWarehouseScope(global, "historical-hq")).not.toThrow();
    const restricted = accessProfileFromRecord("restricted", { ...record, roleIds: ["warehouse_officer"], customRoleIds: ["limited-counter"], effectivePermissions: [], warehouseIds: ["historical-hq"] });
    expect(hasServerPermission(restricted, "inventory.count")).toBe(false);
    expect(() => requireBranchScope(restricted, "hq")).toThrow();
    expect(accessProfileFromRecord("custom", { ...record, roleIds: ["branch_requester"], customRoleIds: ["count-only"], effectivePermissions: ["inventory.count", "not-a-permission"], branchIds: ["hq"] }).effectivePermissions).toEqual(["inventory.count"]);
  });
  it("rejects deactivated, Auth-disabled or invalid stored profiles", () => {
    const record = { organizationId: "org", status: "active", roleId: "system_administrator" };
    for (const change of [{ status: "inactive" }, { authDisabled: true }, { organizationId: null }, { roleId: "unknown" }])
      expect(() => accessProfileFromRecord("counter", { ...record, ...change })).toThrow();
  });
  it("keeps manual accounting permissions explicit for custom and multiple roles", () => {
    for (const permission of ["finance.journal.create", "finance.journal.reverse", "finance.accounts.manage", "finance.tax.manage", "finance.budget.manage"] as const) {
      expect(hasServerPermission({ ...actor("finance_officer"), directRoleIds: ["finance_officer"], effectivePermissions: [] }, permission)).toBe(true);
      expect(hasServerPermission({ ...actor("finance_officer"), directRoleIds: [], effectivePermissions: ["finance.journal.read"] }, permission)).toBe(false);
      expect(hasServerPermission(actor("sales_cashier"), permission)).toBe(false);
      expect(hasPermission({ status: "active", roleId: "finance_officer", directRoleIds: ["finance_officer"], effectivePermissions: [] }, permission)).toBe(true);
      expect(hasPermission({ status: "active", roleId: "finance_officer", directRoleIds: [], effectivePermissions: ["finance.journal.read"] }, permission)).toBe(false);
      expect(hasServerPermission({ ...actor("branch_manager"), roleIds: ["branch_manager", "finance_officer"] }, permission)).toBe(true);
    }
  });
  it("grants funds transfer only to authorized finance roles, not restricted custom bases", () => {
    expect(hasServerPermission({ ...actor("finance_officer"), directRoleIds: ["finance_officer"], effectivePermissions: [] }, "banking.transfer")).toBe(true);
    expect(hasServerPermission({ ...actor("finance_officer"), directRoleIds: [], effectivePermissions: ["banking.read"] }, "banking.transfer")).toBe(false);
    expect(hasServerPermission(actor("sales_cashier"), "banking.transfer")).toBe(false);
    expect(hasServerPermission({ ...actor("branch_manager"), roleIds: ["branch_manager", "finance_officer"] }, "banking.transfer")).toBe(true);
    expect(hasPermission({ status: "active", roleId: "finance_officer", directRoleIds: ["finance_officer"], effectivePermissions: [] }, "banking.transfer")).toBe(true);
    expect(hasPermission({ status: "active", roleId: "finance_officer", directRoleIds: [], effectivePermissions: ["banking.read"] }, "banking.transfer")).toBe(false);
  });
  it("adds daily close to direct manager roles but not restricted custom-role bases", () => {
    expect(hasServerPermission({ ...actor("branch_manager"), directRoleIds: ["branch_manager"], effectivePermissions: [] }, "daily.close.approve")).toBe(true);
    expect(hasServerPermission({ ...actor("branch_manager"), directRoleIds: [], effectivePermissions: [] }, "daily.close.approve")).toBe(false);
    expect(hasServerPermission({ ...actor("branch_manager"), directRoleIds: [], effectivePermissions: ["daily.close.read"] }, "daily.close.read")).toBe(true);
    expect(hasServerPermission(actor("sales_cashier"), "daily.close.prepare")).toBe(false);
  });
  it("adds stock release to directly assigned managers without broadening a restricted custom role", () => {
    expect(hasServerPermission({ ...actor("branch_manager"), directRoleIds: ["branch_manager"], effectivePermissions: ["sales.payment.confirm"] }, "sales.stock.release")).toBe(true);
    expect(hasServerPermission({ ...actor("branch_manager"), directRoleIds: [], effectivePermissions: ["sales.payment.confirm"] }, "sales.stock.release")).toBe(false);
  });
  it("allows a system administrator to assign an allowed role", () => expect(canAssignRole("system_administrator", "finance_officer")).toBe(true));
  it("limits a custom role to its selected permissions while retaining branch scope", () => {
    const assignment = buildRoleAssignment([], [{ id: "sales-helper", organizationId: "org", name: "Sales helper", baseRoleId: "branch_manager", permissionIds: ["sales.order.create"], status: "active" }]);
    const user = { ...actor("branch_manager"), roleIds: assignment.roleIds, effectivePermissions: assignment.effectivePermissions } satisfies AccessProfile;
    expect(hasServerPermission(user, "sales.order.create")).toBe(true);
    expect(hasServerPermission(user, "sales.credit.create")).toBe(false);
    expect(hasServerPermission(user, "inventory.adjust")).toBe(false);
  });
  it("gives a system administrator every server action regardless of location scope", () => {
    const administrator = actor("system_administrator");
    expect(hasServerPermission(administrator, "inventory.reconcile")).toBe(true);
    expect(hasServerPermission(administrator, "inventory.cost.read")).toBe(true);
    expect(hasServerPermission(administrator, "inventory.cost.manage")).toBe(true);
    expect(hasServerPermission(administrator, "requests.read.own_branch")).toBe(true);
    expect(hasServerPermission(administrator, "transfers.read.assigned_warehouse")).toBe(true);
    expect(hasServerPermission(administrator, "transfers.receive")).toBe(true);
  });
  it("prevents operations administrators creating system administrators", () => expect(() => assertAssignableRole(actor("operations_administrator"), undefined, "system_administrator")).toThrow());
  it("prevents users changing their own role", () => expect(() => assertAssignableRole(actor("system_administrator"), "actor", "auditor")).toThrow());
  it("prevents warehouse users assigning finance roles", () => expect(canAssignRole("warehouse_manager", "finance_officer")).toBe(false));
  it("prevents scoped assignment outside authority", () => expect(() => assertAssignmentScope(actor("branch_manager"), ["b2"], [])).toThrow());
  it("unions permissions across every assigned role", () => {
    const manager = { ...actor("warehouse_manager"), roleIds: ["warehouse_manager", "branch_manager"] } satisfies AccessProfile;
    expect(hasServerPermission(manager, "inventory.adjust")).toBe(true);
    expect(hasServerPermission(manager, "transfers.receive")).toBe(true);
  });
  it("treats canonical roleIds as authoritative over a stale compatibility role", () => {
    const canonical = { ...actor("branch_manager"), roleIds: ["warehouse_manager"] } satisfies AccessProfile;
    expect(hasServerPermission(canonical, "inventory.adjust")).toBe(true);
    expect(hasServerPermission(canonical, "transfers.receive")).toBe(false);
  });
  it("allows an administrator to grant multiple roles and rejects a partially forbidden set", () => {
    expect(() => assertAssignableRoles(actor("system_administrator"), undefined, ["branch_manager", "warehouse_manager"])).not.toThrow();
    expect(() => assertAssignableRoles(actor("operations_administrator"), undefined, ["branch_manager", "finance_officer"])).toThrow();
  });
  it("enforces the selected branch context for a dual manager", () => {
    const manager = { ...actor("warehouse_manager"), roleIds: ["warehouse_manager", "branch_manager"] } satisfies AccessProfile;
    const scoped = applyOperatingContext(manager, { type: "branch", id: "b1" });
    expect(scoped).toMatchObject({ roleId: "branch_manager", roleIds: ["warehouse_manager", "branch_manager"], branchIds: ["b1"], warehouseIds: [] });
    expect(hasServerPermission(scoped, "transfers.receive")).toBe(true);
    expect(hasServerPermission(scoped, "inventory.adjust")).toBe(true);
    expect(hasServerPermission(scoped, "inventory.reconcile")).toBe(true);
    expect(hasServerPermission(scoped, "transfers.dispatch")).toBe(true);
    expect(hasServerPermission(scoped, "products.create")).toBe(true);
  });
  it("gives warehouse managers complete warehouse operations without branch receiving authority", () => {
    const manager = actor("warehouse_manager");
    expect(hasServerPermission(manager, "inventory.opening_stock")).toBe(true);
    expect(hasServerPermission(manager, "inventory.reconcile")).toBe(true);
    expect(hasServerPermission(manager, "transfers.create.from_request")).toBe(true);
    expect(hasServerPermission(manager, "transfers.cost.reconcile")).toBe(true);
    expect(hasServerPermission(manager, "transfers.create.direct")).toBe(false);
    expect(hasServerPermission(manager, "transfers.receive")).toBe(false);
  });
  it("rejects an operating context outside the user's assignments", () => {
    expect(() => applyOperatingContext(actor("branch_manager"), { type: "branch", id: "b2" })).toThrow();
  });
  it("requires an explicit context when a scoped user has multiple locations", () => {
    const manager = { ...actor("warehouse_manager"), roleIds: ["warehouse_manager", "branch_manager"] } satisfies AccessProfile;
    expect(() => applyOperatingContext(manager, null)).toThrow();
  });
  it("automatically narrows a single-location manager when older clients omit context", () => {
    const scoped = applyOperatingContext({ ...actor("branch_manager"), warehouseIds: [] }, null);
    expect(scoped).toMatchObject({ branchIds: ["b1"], warehouseIds: [], roleIds: ["branch_manager"] });
  });
});
