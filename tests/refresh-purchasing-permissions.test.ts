import { describe, expect, it, vi } from "vitest";
import { refreshPurchasingPermissions, safeOfflinePurchasingPermissions } from "../src/features/auth/refresh-purchasing-permissions";
import { hasPermission } from "../src/lib/permissions/roles";
import type { UserProfile } from "../src/types/domain";
const mixed: UserProfile = { id: "buyer", uid: "buyer", organizationId: "org", email: "buyer@example.test", displayName: "Buyer", authDisabled: false, authorizationVersion: 1, createdAt: "2026-11-09", createdBy: "fixture", updatedAt: "2026-11-09", updatedBy: "fixture", status: "active", roleId: "branch_manager", roleIds: ["branch_manager", "finance_officer"], directRoleIds: ["branch_manager"], customRoleIds: ["finance-reader"], effectivePermissions: ["sales.order.create", "procurement.read", "payables.read", "payables.pay", "procurement.create"], branchIds: ["own"], warehouseIds: [] };
describe("current purchasing grants for the signed-in UI", () => {
  it("removes old branch grants without removing an independent custom reader", async () => {
    const current = await refreshPurchasingPermissions(mixed, async () => ({ permissions: ["procurement.read", "payables.read"] }));
    expect(hasPermission(current, "procurement.read")).toBe(true);
    expect(hasPermission(current, "payables.read")).toBe(true);
    expect(hasPermission(current, "payables.pay")).toBe(false);
    expect(hasPermission(current, "procurement.create")).toBe(false);
    expect(hasPermission(current, "sales.order.create")).toBe(true);
    expect(mixed.effectivePermissions).toContain("payables.pay");
  });
  it("does not assume old access when the refresh fails", async () => {
    await expect(refreshPurchasingPermissions(mixed, async () => { throw new Error("offline"); })).rejects.toThrow("offline");
  });
  it("fails closed on unverified offline custom grants while retaining direct legitimate roles", () => {
    const offline = safeOfflinePurchasingPermissions(mixed);
    expect(hasPermission(offline, "payables.pay")).toBe(false);
    expect(hasPermission(offline, "sales.order.create")).toBe(true);
    const finance = safeOfflinePurchasingPermissions({ ...mixed, directRoleIds: ["branch_manager", "finance_officer"] });
    expect(hasPermission(finance, "payables.pay")).toBe(true);
  });
  it("does not refresh unrelated profiles", async () => {
    const reader = vi.fn(); const cashier = { ...mixed, roleId: "sales_cashier", roleIds: ["sales_cashier"] } as UserProfile;
    expect(await refreshPurchasingPermissions(cashier, reader)).toBe(cashier); expect(reader).not.toHaveBeenCalled();
  });
});
