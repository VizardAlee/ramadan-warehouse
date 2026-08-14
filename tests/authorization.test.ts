import { describe, expect, it } from "vitest";
import { assertAssignableRole, assertAssignableRoles, assertAssignmentScope, canAssignRole, hasServerPermission, type AccessProfile } from "../functions/src/auth/authorize";

const actor = (roleId: AccessProfile["roleId"]): AccessProfile => ({ userId: "actor", organizationId: "org", roleId, branchIds: ["b1"], warehouseIds: ["w1"], authorizationVersion: 1 });
describe("server authorization controls", () => {
  it("allows a system administrator to assign an allowed role", () => expect(canAssignRole("system_administrator", "finance_officer")).toBe(true));
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
});
