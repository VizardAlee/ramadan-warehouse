import { beforeEach, describe, expect, it, vi } from "vitest";
import { accessProfileFromRecord, permissionsForServerRole, type Permission, type RoleId } from "../functions/src/auth/authorize";
import { buildRoleAssignment, type StoredRole } from "../functions/src/auth/custom-roles";
const state = vi.hoisted(() => ({ roles: [] as StoredRole[] }));
vi.mock("../functions/src/admin.js", () => ({ db: {} }));
vi.mock("../functions/src/auth/custom-roles.js", async original => ({ ...await original<typeof import("../functions/src/auth/custom-roles")>(), loadCustomRoles: vi.fn(async () => state.roles) }));
import { scopedAccess, hasOrganizationPermission, requirePermissionScope } from "../functions/src/auth/permission-scope";
function profile(direct: RoleId[], base: RoleId, permissionIds: Permission[]) {
  state.roles = [{ id: "financial-unit-role", organizationId: "org", name: "Reader", baseRoleId: base, permissionIds, status: "active" }];
  return accessProfileFromRecord("staff", { organizationId: "org", status: "active", branchIds: ["own"], warehouseIds: [], ...buildRoleAssignment(direct, state.roles) });
}
beforeEach(() => { state.roles = []; });
describe("action-specific financial scope", () => {
  it.each(["operations_administrator", "finance_officer", "auditor"] as const)("does not lend the custom %s base to a local journal reader", async base => {
    const actor = await scopedAccess(profile(["branch_manager"], base, ["procurement.read", "sales.read.all"]));
    expect(hasOrganizationPermission(actor, "finance.journal.read")).toBe(false);
    expect(() => requirePermissionScope(actor, { branchId: "own" }, "finance.journal.read")).not.toThrow();
    for (const scope of [{}, { branchId: "remote" }, { warehouseId: "remote" }, { branchId: "own", warehouseId: "remote" }])
      expect(() => requirePermissionScope(actor, scope, "finance.journal.read")).toThrow(/assigned store/);
  });
  it("honors an explicit current custom financial grant and its revocation", async () => {
    const record = profile(["branch_manager"], "finance_officer", ["finance.journal.read"]);
    const granted = await scopedAccess(record);
    expect(() => requirePermissionScope(granted, {}, "finance.journal.read")).not.toThrow();
    expect(() => requirePermissionScope(granted, { branchId: "remote" }, "finance.journal.read")).not.toThrow();
    expect(() => requirePermissionScope(granted, { branchId: "remote" }, "finance.journal.create")).toThrow();
    state.roles[0]!.permissionIds = ["procurement.read"];
    const revoked = await scopedAccess(record);
    expect(() => requirePermissionScope(revoked, { branchId: "own" }, "finance.journal.read")).not.toThrow();
    expect(() => requirePermissionScope(revoked, {}, "finance.journal.read")).toThrow();
  });
  it.each(["system_administrator", "finance_officer", "auditor"] as const)("retains direct %s global finance access", async role => {
    const actor = await scopedAccess(profile([role], "branch_manager", []));
    for (const permission of permissionsForServerRole(role).filter(p => p.startsWith("finance.") || p === "banking.read" || p === "accounting.close.read"))
      expect(() => requirePermissionScope(actor, {}, permission)).not.toThrow();
  });
  it("does not retain removed local custom financial permissions", async () => {
    const record = profile([], "branch_manager", ["finance.journal.read"]);
    state.roles[0]!.permissionIds = [];
    expect(() => requirePermissionScope({ ...record, organizationPermissions: [] }, { branchId: "own" }, "finance.journal.read")).not.toThrow();
    const awaited = await scopedAccess(record);
    expect(() => requirePermissionScope(awaited, { branchId: "own" }, "finance.journal.read")).toThrow();
  });
});
