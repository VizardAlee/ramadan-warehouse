import { describe, expect, it } from "vitest";
import { customerInView, requireCustomerBranch } from "../functions/src/sales/customer-scope";
import type { AccessProfile } from "../functions/src/auth/authorize";
const actor: AccessProfile = { userId: "u", organizationId: "org", roleId: "branch_manager", branchIds: ["a", "b"], warehouseIds: [], authorizationVersion: 1 };
describe("customer branch ownership", () => {
  it("limits a branch view even for an organization administrator", () => {
    const selected = { ...actor, roleId: "system_administrator" as const, operatingContext: { type: "branch" as const, id: "a" } };
    expect(customerInView(selected, { organizationId: "org", branchId: "a" })).toBe(true);
    expect(customerInView(selected, { organizationId: "org", branchId: "b" })).toBe(false);
    expect(customerInView(selected, { organizationId: "org" })).toBe(false);
  });
  it("clips All to assigned branches and denies unknown and cross-organization ownership", () => {
    expect(customerInView(actor, { organizationId: "org", branchId: "b" })).toBe(true);
    expect(customerInView(actor, { organizationId: "org", branchId: "c" })).toBe(false);
    expect(customerInView(actor, { organizationId: "org" })).toBe(false);
    expect(customerInView(actor, { organizationId: "foreign", branchId: "a" })).toBe(false);
  });
  it("allows unknown records in the organization review view without assigning them", () => {
    const record = { organizationId: "org", name: "Legacy" };
    expect(customerInView({ ...actor, roleId: "system_administrator" }, record)).toBe(true);
    expect(() => requireCustomerBranch(record, "a")).toThrow();
    expect(record).not.toHaveProperty("branchId");
  });
  it("uses the granting permission rather than another global role to widen customer access", () => {
    const mixed = { ...actor, roleId: "operations_administrator" as const, organizationPermissions: [] };
    expect(customerInView(mixed, { organizationId: "org", branchId: "c" })).toBe(false);
    expect(customerInView(mixed, { organizationId: "org", branchId: "b" })).toBe(true);
    const reader = { ...mixed, organizationPermissions: ["customers.read" as const] };
    expect(customerInView(reader, { organizationId: "org", branchId: "c" })).toBe(true);
    expect(customerInView(reader, { organizationId: "org", branchId: "c" }, "customers.manage")).toBe(false);
  });
  it("does not infer organization authority from a custom role's base role", () => {
    const custom = { ...actor, roleId: "operations_administrator" as const, customRoleIds: ["custom"], directRoleIds: [] };
    expect(customerInView(custom, { organizationId: "org", branchId: "c" })).toBe(false);
    expect(customerInView({ ...custom, operatingContext: { type: "branch", id: "c" } }, { organizationId: "org", branchId: "c" })).toBe(false);
  });

});
