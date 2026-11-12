import { describe, expect, it } from "vitest";
import { accessProfileFromRecord, hasServerPermission } from "../functions/src/auth/authorize";
import { canCollectPhysicalHandover } from "../functions/src/sales/handover-access";
import { assertStockQueueBranch, stockHandoverItem } from "../functions/src/sales/stock-collection-workspace";
import { operatingRoles } from "../src/lib/permissions/operating-roles";
const actor = () => ({ ...accessProfileFromRecord("stock", { organizationId: "org", status: "active", roleIds: ["branch_manager", "finance_officer"], directRoleIds: [], customRoleIds: ["stock"], effectivePermissions: ["inventory.read", "sales.handover"], branchIds: ["branch"], warehouseIds: [] }), operatingContext: { type: "branch" as const, id: "branch" } });
const branch = (id = "branch", organizationId = "org", status = "active") => ({ exists: true, id, get: (key: string) => ({ organizationId, status } as Record<string, string>)[key] });
describe("dedicated branch handovers", () => {
  it("grants only explicit handover capability, not payment, cancellation or financial sale reads", () => {
    const a = actor();
    expect(canCollectPhysicalHandover(a, branch())).toBe(true);
    for (const p of ["sales.stock.release", "sales.order.create", "sales.payment.confirm", "sales.returns.approve", "sales.read.own_branch"] as const) expect(hasServerPermission(a, p)).toBe(false);
    expect(() => assertStockQueueBranch(a, "branch")).not.toThrow();
  });
  it("rejects cross-branch even with a finance base role, other org and inactive branch", () => {
    expect(() => assertStockQueueBranch(actor(), "other")).toThrow();
    expect(canCollectPhysicalHandover(actor(), branch("other"))).toBe(false);
    expect(canCollectPhysicalHandover(actor(), branch("branch", "other"))).toBe(false);
    expect(canCollectPhysicalHandover(actor(), branch("branch", "org", "inactive"))).toBe(false);
    expect(() => assertStockQueueBranch({ ...actor(), operatingContext: undefined }, "branch")).toThrow();
    expect(canCollectPhysicalHandover({ ...actor(), effectivePermissions: ["inventory.read"] }, branch())).toBe(false);
  });
  it("projects only stock handover fields and filters already used serials", () => {
    const result = stockHandoverItem("i", { productName: "Panel", quantity: 4, collectedQuantity: 1, cancelledQuantity: 1, serialNumbers: ["a", "b", "c", "d"], collectedSerialNumbers: ["a"], cancelledSerialNumbers: ["b"], costAmountMinor: 100, unitPriceMinor: 1000 });
    expect(result.remaining).toBe(2); expect(result.serialNumbers).toEqual(["c", "d"]);
    expect(result).not.toHaveProperty("costAmountMinor"); expect(result).not.toHaveProperty("unitPriceMinor");
  });
  it("adds handovers only to the stock template, not salesperson/cashier", () => {
    expect(operatingRoles[2]!.permissionIds).toContain("sales.handover");
    expect(operatingRoles[0]!.permissionIds).not.toContain("sales.handover");
    expect(operatingRoles[1]!.permissionIds).not.toContain("sales.handover");
  });
});
