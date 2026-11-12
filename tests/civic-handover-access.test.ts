import { describe, expect, it } from "vitest";
import { accessProfileFromRecord, hasServerPermission } from "../functions/src/auth/authorize";
import { canCollectPhysicalHandover, CIVIC_BRANCH_ID, CIVIC_ORGANIZATION_ID } from "../functions/src/sales/handover-access";

const branch = (id = CIVIC_BRANCH_ID, organizationId = CIVIC_ORGANIZATION_ID, status = "active") => ({ exists: true, id, get: (field: string) => ({ organizationId, status } as Record<string, string>)[field] });
function actor(overrides: Record<string, unknown> = {}) {
  return accessProfileFromRecord("sales-user", { organizationId: CIVIC_ORGANIZATION_ID, status: "active", roleIds: ["sales_cashier", "finance_officer"], directRoleIds: ["sales_cashier", "finance_officer"], branchIds: [CIVIC_BRANCH_ID, "other"], warehouseIds: [], ...overrides });
}
describe("Civic physical handover permission", () => {
  it("permits an assigned Civic salesperson or cashier without granting other stock-release rights", () => {
    const a = actor();
    expect(canCollectPhysicalHandover(a, branch())).toBe(true);
    expect(hasServerPermission(a, "sales.stock.release")).toBe(false);
    expect(canCollectPhysicalHandover(actor({roleIds: ["sales_cashier"], directRoleIds: [], customRoleIds: ["cashier"], effectivePermissions: ["sales.payment.accept"]}), branch())).toBe(true);
  });
  it("rejects other branches and organizations, inactive branches, unassigned users and non-sales roles", () => {
    expect(canCollectPhysicalHandover(actor(), branch("other"))).toBe(false);
    expect(canCollectPhysicalHandover(actor({organizationId: "other-org"}), branch())).toBe(false);
    expect(canCollectPhysicalHandover(actor(), branch(CIVIC_BRANCH_ID, "other-org"))).toBe(false);
    expect(canCollectPhysicalHandover(actor(), branch(CIVIC_BRANCH_ID, CIVIC_ORGANIZATION_ID, "inactive"))).toBe(false);
    expect(canCollectPhysicalHandover(actor({branchIds: ["other"]}), branch())).toBe(false);
    expect(canCollectPhysicalHandover(actor({roleIds: ["finance_officer"], directRoleIds: ["finance_officer"]}), branch())).toBe(false);
    expect(canCollectPhysicalHandover(actor({roleIds: ["sales_cashier"], directRoleIds: [], customRoleIds: ["restricted"], effectivePermissions: ["products.read"]}), branch())).toBe(false);
    expect(canCollectPhysicalHandover({...actor(), operatingContext: {type: "branch", id: "other"}}, branch())).toBe(false);
  });
  it("preserves existing manager release authority", () => {
    expect(canCollectPhysicalHandover(actor({roleIds: ["branch_manager"], directRoleIds: ["branch_manager"]}), branch("other"))).toBe(true);
  });
});

import { hasCurrentHandoverGrant } from "../src/features/pos/handover-access";
import type { PosWorkspace } from "../src/features/pos/types";
it("never reuses the Civic UI grant after changing branch or going offline", () => {
  const workspace = {branch: {id: CIVIC_BRANCH_ID}, canCollectPhysicalHandover: true} as PosWorkspace;
  expect(hasCurrentHandoverGrant(true, CIVIC_BRANCH_ID, workspace)).toBe(true);
  expect(hasCurrentHandoverGrant(true, "other", workspace)).toBe(false);
  expect(hasCurrentHandoverGrant(false, CIVIC_BRANCH_ID, workspace)).toBe(false);
  expect(hasCurrentHandoverGrant(true, CIVIC_BRANCH_ID, null)).toBe(false);
});
