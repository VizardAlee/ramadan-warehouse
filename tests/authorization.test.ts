import { describe, expect, it } from "vitest";
import { applyOperatingContext, assertAssignableRole, assertAssignableRoles, assertAssignmentScope, canAssignRole, hasServerPermission, type AccessProfile } from "../functions/src/auth/authorize";

const actor = (roleId: AccessProfile["roleId"]): AccessProfile => ({ userId: "actor", organizationId: "org", roleId, branchIds: ["b1"], warehouseIds: ["w1"], authorizationVersion: 1 });
describe("server authorization controls", () => {
  it("allows a system administrator to assign an allowed role", () => expect(canAssignRole("system_administrator", "finance_officer")).toBe(true));
  it("preserves complete system-administrator inventory and cost authority", () => {
    const administrator = actor("system_administrator");
    expect(hasServerPermission(administrator, "inventory.reconcile")).toBe(true);
    expect(hasServerPermission(administrator, "inventory.cost.read")).toBe(true);
    expect(hasServerPermission(administrator, "inventory.cost.manage")).toBe(true);
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
    expect(scoped).toMatchObject({ roleId: "branch_manager", roleIds: ["branch_manager"], branchIds: ["b1"], warehouseIds: [] });
    expect(hasServerPermission(scoped, "transfers.receive")).toBe(true);
    expect(hasServerPermission(scoped, "inventory.adjust")).toBe(true);
    expect(hasServerPermission(scoped, "inventory.reconcile")).toBe(true);
    expect(hasServerPermission(scoped, "transfers.dispatch")).toBe(false);
    expect(hasServerPermission(scoped, "products.create")).toBe(false);
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
