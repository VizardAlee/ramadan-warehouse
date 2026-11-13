import { describe, expect, it } from "vitest";
import { operatingRoles } from "../src/lib/permissions/operating-roles";
import { hasPermission, permissionsForRoles } from "../src/lib/permissions/roles";
import { canCreateStockTransfer } from "../src/features/transfers/transfer-permissions";
import { buildRoleAssignment } from "../functions/src/auth/custom-roles";
import { accessProfileFromRecord, hasServerPermission, permissionsForServerRole, requireBranchScope } from "../functions/src/auth/authorize";
import type { UserProfile } from "../src/types/domain";

const stored = operatingRoles.map((role, index) => ({ ...role, id: `fixture-role-${index}`, organizationId: "fixture-org", status: "active" as const }));
function profile(indexes: number[], direct: Parameters<typeof buildRoleAssignment>[0] = []) {
  return { id: "fixture-user", email: "fixture@example.test", displayName: "Fixture", authDisabled: false, createdAt: "2026-11-01", updatedAt: "2026-11-01", createdBy: "fixture-admin", updatedBy: "fixture-admin", uid: "fixture-user", organizationId: "fixture-org", status: "active", branchIds: ["fixture-branch"], warehouseIds: [], authorizationVersion: 1, ...buildRoleAssignment(direct, indexes.map(index => stored[index]!)) } as UserProfile;
}
describe("custom operating roles", () => {
  it.each(stored)("keeps $name within its base's allowed client and server permissions", role => {
    expect(new Set(role.permissionIds).size).toBe(role.permissionIds.length);
    for (const permission of role.permissionIds) {
      expect(permissionsForRoles([role.baseRoleId]).has(permission)).toBe(true);
      expect(permissionsForServerRole(role.baseRoleId)).toContain(permission);
    }
  });
  it("separates sale creation from payment acceptance without granting finance, credit or release", () => {
    for (const [index, own, other] of [[0, "sales.order.create", "sales.payment.accept"], [1, "sales.payment.accept", "sales.order.create"]] as const) {
      const user = profile([index]);
      const server = accessProfileFromRecord(user.uid, { ...user });
      expect(user.directRoleIds).toEqual([]);
      expect(hasPermission(user, own)).toBe(true);
      expect(hasServerPermission(server, own)).toBe(true);
      for (const permission of [other, "sales.create", "sales.credit.create", "sales.returns.approve", "sales.payment.confirm", "sales.stock.release", "finance.journal.read", "inventory.adjust"] as const) {
        expect(hasPermission(user, permission)).toBe(false);
        expect(hasServerPermission(server, permission)).toBe(false);
      }
      expect(() => requireBranchScope(server, "fixture-branch")).not.toThrow();
      expect(() => requireBranchScope(server, "foreign-branch")).toThrow();
    }
  });
  it("unions multiple roles while retaining scope and permitting both sales duties", () => {
    const user = profile([0, 1, 2]);
    const server = accessProfileFromRecord(user.uid, { ...user });
    for (const permission of ["sales.order.create", "sales.payment.accept", "inventory.count", "transfers.receive"] as const) {
      expect(hasPermission(user, permission)).toBe(true);
      expect(hasServerPermission(server, permission)).toBe(true);
    }
    expect(hasPermission(user, "sales.payment.confirm")).toBe(false);
    expect(() => requireBranchScope(server, "foreign-branch")).toThrow();
  });
  it("allows stock requests, counts and receipts without outgoing transfers or approval", () => {
    const user = profile([2]);
    const server = accessProfileFromRecord(user.uid, { ...user });
    for (const permission of stored[2]!.permissionIds) expect(hasServerPermission(server, permission)).toBe(true);
    for (const permission of ["requests.approve", "inventory.adjust", "inventory.count_review", "transfers.approve", "transfers.create.direct", "sales.order.create", "expenses.pay"] as const) {
      expect(hasServerPermission(server, permission)).toBe(false);
    }
    expect(canCreateStockTransfer(user)).toBe(false);
    expect(canCreateStockTransfer(user, true)).toBe(false);
    expect(canCreateStockTransfer(profile([2], ["branch_manager"]))).toBe(false);
    expect(canCreateStockTransfer(profile([2], ["purchasing_manager"]))).toBe(true);
    expect(canCreateStockTransfer({ ...user, customRoleIds: undefined, effectivePermissions: undefined, directRoleIds: undefined })).toBe(false);
    expect(canCreateStockTransfer({ ...user, status: "inactive" })).toBe(false);
  });
});


describe("cash reconciliation role boundaries", () => {
  it("permits preparation and return only, never broad finance mutation", () => {
    const index = operatingRoles.findIndex(role => role.name === "Cash & Bank Reconciliation Officer");
    expect(index).toBeGreaterThan(-1);
    const user = profile([index]);
    const server = accessProfileFromRecord(user.uid, { ...user });
    for (const permission of ["cash.advances.read", "cash.advances.return", "daily.close.prepare", "banking.reconcile"] as const) {
      expect(hasPermission(user, permission)).toBe(true);
      expect(hasServerPermission(server, permission)).toBe(true);
    }
    for (const permission of ["cash.advances.issue", "cash.advances.retire", "daily.close.approve", "banking.approve", "banking.manage", "banking.transfer", "finance.journal.reverse", "finance.journal.create", "expenses.pay", "payables.pay", "inventory.adjust", "user.manage"] as const) {
      expect(hasPermission(user, permission)).toBe(false);
      expect(hasServerPermission(server, permission)).toBe(false);
    }
  });
  it("keeps Auditor read-only for advances", () => {
    expect(permissionsForRoles(["auditor"]).has("cash.advances.read")).toBe(true);
    for (const permission of ["cash.advances.issue", "cash.advances.retire", "cash.advances.return"] as const) {
      expect(permissionsForRoles(["auditor"]).has(permission)).toBe(false);
      expect(permissionsForServerRole("auditor")).not.toContain(permission);
    }
  });
});
