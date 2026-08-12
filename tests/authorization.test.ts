import { describe, expect, it } from "vitest";
import { assertAssignableRole, assertAssignmentScope, canAssignRole, type AccessProfile } from "../functions/src/auth/authorize";

const actor = (roleId: AccessProfile["roleId"]): AccessProfile => ({ userId: "actor", organizationId: "org", roleId, branchIds: ["b1"], warehouseIds: ["w1"], authorizationVersion: 1 });
describe("server authorization controls", () => {
  it("allows a system administrator to assign an allowed role", () => expect(canAssignRole("system_administrator", "finance_officer")).toBe(true));
  it("prevents operations administrators creating system administrators", () => expect(() => assertAssignableRole(actor("operations_administrator"), undefined, "system_administrator")).toThrow());
  it("prevents users changing their own role", () => expect(() => assertAssignableRole(actor("system_administrator"), "actor", "auditor")).toThrow());
  it("prevents warehouse users assigning finance roles", () => expect(canAssignRole("warehouse_manager", "finance_officer")).toBe(false));
  it("prevents scoped assignment outside authority", () => expect(() => assertAssignmentScope(actor("branch_manager"), ["b2"], [])).toThrow());
});
