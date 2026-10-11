import { describe, expect, it } from "vitest";
import { ceoDateRange } from "../functions/src/dashboard/ceo-model";
import { canReadCeoView, ceoDestinations, ceoDrilldown, permittedCeoDestinations } from "@/features/dashboard/ceo-directory";
import { existsSync } from "node:fs";
import type { UserProfile } from "@/types/domain";
const profile = (roleId: UserProfile["roleId"], extra: Partial<UserProfile> = {}): UserProfile => ({
  id: "reader", uid: "reader", organizationId: "test-org", email: "reader@example.test", displayName: "Reader",
  roleId, status: "active", branchIds: ["branch-a"], warehouseIds: [], authDisabled: false, authorizationVersion: 1,
  createdAt: "2026-10-01T00:00:00Z", createdBy: "setup", updatedAt: "2026-10-01T00:00:00Z", updatedBy: "setup", ...extra,
});
describe("executive scope, dates and discoverability", () => {
  for (const role of ["system_administrator", "operations_administrator", "finance_officer", "auditor"] as const)
    it(`allows existing organization scope for ${role}`, () => expect(canReadCeoView(profile(role))).toBe(true));
  for (const role of ["branch_manager", "warehouse_manager", "sales_cashier"] as const)
    it(`does not elevate ${role} through extra global reporting permissions`, () => {
      expect(canReadCeoView(profile(role, { effectivePermissions: ["sales.read.all", "requests.read.all", "transfers.read.all", "inventory.read"] }))).toBe(false);
    });
  it("requires read capabilities even for a custom organization-scope role", () => {
    expect(canReadCeoView(profile("operations_administrator", { effectivePermissions: ["inventory.read"], customRoleIds: ["limited"], directRoleIds: [] }))).toBe(false);
  });
  it("does not leak compensation, accounting or settings destinations to operations", () => {
    const rows = permittedCeoDestinations(profile("operations_administrator"));
    expect(rows.some(row => row.title === "People & attendance")).toBe(true);
    expect(rows.some(row => row.title === "Financial statements & cash flow")).toBe(false);
    expect(rows.some(row => row.title === "Roles & permissions")).toBe(false);
  });
  it("makes every configured destination discoverable to the full administrator", () => {
    expect(permittedCeoDestinations(profile("system_administrator"))).toHaveLength(ceoDestinations.length);
    expect(permittedCeoDestinations(profile("system_administrator"), "provider funds").some(row => row.href === "/expenses#provider-funds")).toBe(true);
    for (const item of ceoDestinations) {
      const route = item.href.split(/[?#]/)[0];
      expect(existsSync(`src/app/(protected)${route}/page.tsx`) || ["/audit", "/costs"].includes(route!)).toBe(true);
    }
  });
  it("uses Lagos boundaries, exact preceding periods and bounded chart intervals", () => {
    const range = ceoDateRange("2026-10-01", "2026-10-10", "2026-10-11");
    expect(new Date(range.start).toISOString()).toBe("2026-09-30T23:00:00.000Z");
    expect(new Date(range.end).toISOString()).toBe("2026-10-10T23:00:00.000Z");
    expect(range.previousFromDate).toBe("2026-09-21");
    expect(range.buckets.reduce((sum, bucket) => sum + bucket.end - bucket.start, 0)).toBe(range.end - range.start);
    expect(ceoDateRange("2025-10-11", "2026-10-11", "2026-10-11").buckets.length).toBeLessThanOrEqual(12);
    expect(() => ceoDateRange("2026-10-12", "2026-10-12", "2026-10-11")).toThrow();
    expect(() => ceoDateRange("2025-01-01", "2026-10-11", "2026-10-11")).toThrow();
    const leap = ceoDateRange("2024-02-29", "2024-02-29", "2024-03-01");
    expect(leap.days).toBe(1); expect(new Date(leap.end).toISOString()).toBe("2024-02-29T23:00:00.000Z");
    expect(ceoDateRange("2024-01-01", "2024-12-31", "2024-12-31").days).toBe(366);
    expect(ceoDateRange("2026-10-11", "2026-10-11", "2026-10-11").buckets[0]?.fromDate).toBe("2026-10-11");
  });
  it("keeps actual sales drilldown dates and branch without claiming other registers consume them", () => {
    expect(ceoDrilldown("/reports?family=sales", "2026-10-01", "2026-10-10", "branch-a")).toBe("/reports?family=sales&fromDate=2026-10-01&toDate=2026-10-10&branchId=branch-a");
    expect(ceoDrilldown("/expenses#provider-funds", "2026-10-01", "2026-10-10", "branch-a")).toBe("/expenses#provider-funds");
  });
});
