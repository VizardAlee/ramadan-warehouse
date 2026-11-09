import { beforeEach, describe, expect, it, vi } from "vitest";
import { accessProfileFromRecord, applyOperatingContext, canAssignRole, canSelfAuthorize, canSelfAuthorizePurchasing, hasServerPermission, permissionsForServerRole, requireBranchScope, type Permission, type RoleId } from "../functions/src/auth/authorize";
import { buildRoleAssignment, type StoredRole } from "../functions/src/auth/custom-roles";
import { canPostSupplierReturns, canSelfAuthorizePurchasing as clientSelfApproval, hasPermission, permissionsForRoles } from "../src/lib/permissions/roles";
const state = vi.hoisted(() => ({ roles: [] as StoredRole[] }));
vi.mock("../functions/src/admin.js", () => ({ db: {} }));
vi.mock("../functions/src/auth/custom-roles.js", async original => ({ ...await original<typeof import("../functions/src/auth/custom-roles")>(), loadCustomRoles: vi.fn(async () => state.roles) }));
import { operationalEvidence } from "../functions/src/sales/operational-evidence";
import { followUpSaleReturn } from "../functions/src/sales/return-follow-up";
import { hasAllBranchProcurementPermission, hasOrganizationProcurementPermission, hasProcurementScope, procurementAccess, purchaseReceiptInventoryActor, requireProcurementScope } from "../functions/src/procurement/authorize";

const granted: Permission[] = ["suppliers.read", "suppliers.manage", "procurement.read", "procurement.create", "procurement.approve", "procurement.receive", "payables.read", "payables.create", "payables.approve"];
const forbidden: Permission[] = ["payables.pay", "banking.read", "banking.transfer", "finance.journal.create", "finance.accounts.manage", "inventory.receive", "inventory.reverse", "sales.returns.read", "sales.returns.approve", "user.manage", "role.manage", "expenses.approve"];
function profile(direct: RoleId[] = ["purchasing_manager"], custom: StoredRole[] = []) {
  state.roles = custom;
  return accessProfileFromRecord("buyer", { status: "active", organizationId: "org", ...buildRoleAssignment(direct, custom), branchIds: [], warehouseIds: [] });
}
function clientProfile(actor: ReturnType<typeof profile>) {
  return { status: "active" as const, roleId: actor.roleId,
    roleIds: actor.roleIds ? [...actor.roleIds] : undefined,
    directRoleIds: actor.directRoleIds ? [...actor.directRoleIds] : undefined,
    customRoleIds: actor.customRoleIds ? [...actor.customRoleIds] : undefined,
    effectivePermissions: actor.effectivePermissions ? [...actor.effectivePermissions] : undefined };
}
beforeEach(() => { state.roles = []; });
describe("Purchasing Manager permission boundaries", () => {
  it("keeps server/client grants identical and payment/admin/inventory powers separate", () => {
    const actor = profile();
    const client = clientProfile(actor);
    expect(new Set(permissionsForServerRole("purchasing_manager"))).toEqual(permissionsForRoles(["purchasing_manager"]));
    for (const permission of granted) { expect(hasServerPermission(actor, permission)).toBe(true); expect(hasPermission(client, permission)).toBe(true); }
    for (const permission of forbidden) { expect(hasServerPermission(actor, permission)).toBe(false); expect(hasPermission(client, permission)).toBe(false); }
    expect(canAssignRole("system_administrator", "purchasing_manager")).toBe(true);
    expect(canAssignRole("branch_manager", "purchasing_manager")).toBe(false);
    expect(canAssignRole("purchasing_manager", "purchasing_manager")).toBe(false);
  });
  it("authorizes existing and future branches without assignments, never legacy warehouses", async () => {
    const access = await procurementAccess({ ...profile(), warehouseIds: ["legacy-assignment"] });
    for (const permission of granted.filter(permission => !permission.startsWith("suppliers."))) {
      expect(hasAllBranchProcurementPermission(access, permission)).toBe(true);
      expect(hasOrganizationProcurementPermission(access, permission)).toBe(false);
      for (const branchId of ["head-office", "new-branch-after-assignment"]) expect(() => requireProcurementScope(access, { branchId }, permission)).not.toThrow();
      for (const warehouseId of ["legacy-assignment", "unassigned-warehouse"]) {
        expect(() => requireProcurementScope(access, { warehouseId }, permission)).toThrow(/assigned store/);
        expect(hasProcurementScope(access, { warehouseId }, permission)).toBe(false);
      }
    }
    expect(() => requireProcurementScope(access, { branchId: "head-office", warehouseId: "legacy-assignment" }, "procurement.create")).toThrow();
    expect(() => requireProcurementScope(access, {}, "procurement.create")).toThrow(/operating location/);
    expect(() => requireBranchScope(access, "new-branch-after-assignment")).toThrow();
  });
  it("does not lend all-branch scope to independently held local warehouse permissions", async () => {
    const access = await procurementAccess({ ...profile(["purchasing_manager", "warehouse_officer"]), warehouseIds: ["own"] });
    expect(() => requireProcurementScope(access, { warehouseId: "own" }, "procurement.receive")).not.toThrow();
    expect(() => requireProcurementScope(access, { warehouseId: "own" }, "procurement.approve")).toThrow();
    expect(() => requireProcurementScope(access, { warehouseId: "remote" }, "procurement.receive")).toThrow();
  });
  it("refreshes restricted custom grants and does not grant their omitted/self-approval powers", async () => {
    const custom: StoredRole = { id: "read-only", organizationId: "org", name: "Reader", baseRoleId: "purchasing_manager", permissionIds: ["procurement.read"], status: "active" };
    const actor = profile([], [custom]);
    const access = await procurementAccess(actor);
    expect(() => requireProcurementScope(access, { branchId: "future" }, "procurement.read")).not.toThrow();
    expect(() => requireProcurementScope(access, { branchId: "future" }, "procurement.create")).toThrow();
    expect(canSelfAuthorizePurchasing(actor)).toBe(false);
    expect(clientSelfApproval(clientProfile(actor))).toBe(false);
    custom.permissionIds = [];
    const refreshed = await procurementAccess(actor);
    expect(() => requireProcurementScope(refreshed, { branchId: "future" }, "procurement.read")).toThrow();
  });
  it("limits self-approval to purchasing and does not grant supplier credit/return posting", async () => {
    const actor = profile();
    expect(canSelfAuthorize(actor)).toBe(false);
    expect(canSelfAuthorizePurchasing(actor)).toBe(true);
    expect(clientSelfApproval(clientProfile(actor))).toBe(true);
    expect(canPostSupplierReturns(clientProfile(actor))).toBe(false);
    const returns = await procurementAccess(actor, { excludeRoles: ["purchasing_manager"] });
    expect(() => requireProcurementScope(returns, { branchId: "future" }, ["procurement.receive", "payables.approve"])).toThrow();
    const independent = await procurementAccess({ ...profile(["purchasing_manager", "warehouse_manager"]), warehouseIds: ["own"] }, { excludeRoles: ["purchasing_manager"] });
    expect(() => requireProcurementScope(independent, { warehouseId: "own" }, ["procurement.receive", "payables.approve"])).not.toThrow();
    expect(() => requireProcurementScope(independent, { branchId: "future" }, ["procurement.receive", "payables.approve"])).toThrow();
  });
  it("does not use purchasing grants for held-return actions or return-photo uploads", async () => {
    const actor = profile(["purchasing_manager", "branch_manager"]);
    await expect(followUpSaleReturn(actor, { action: "receive_supplier_replacement", returnId: "return", idempotencyKey: "key" } as Parameters<typeof followUpSaleReturn>[1])).rejects.toMatchObject({ code: "permission-denied" });
    await expect(operationalEvidence(actor, "supplier_return", { action: "upload_evidence", recordId: "return", stage: "handover", note: "Attempt", contentType: "image/png", base64: "unused", idempotencyKey: "key" })).rejects.toMatchObject({ code: "permission-denied" });
  });
  it("keeps an explicit view narrow and receipt inventory authority ephemeral and order-scoped", async () => {
    const actor = profile();
    const access = await procurementAccess(applyOperatingContext(actor, { type: "branch", id: "future" }));
    expect(() => requireProcurementScope(access, { branchId: "other" }, "procurement.receive")).toThrow(/another operating location/);
    const receiptActor = purchaseReceiptInventoryActor(access, { branchId: "future" });
    expect(receiptActor.branchIds).toEqual(["future"]);
    expect(receiptActor.warehouseIds).toEqual([]);
    expect(() => requireBranchScope(receiptActor, "future")).not.toThrow();
    expect(() => requireBranchScope(receiptActor, "other")).toThrow();
    expect(actor.branchIds).toEqual([]);
    expect(hasServerPermission(receiptActor, "inventory.receive")).toBe(false);
  });
});
