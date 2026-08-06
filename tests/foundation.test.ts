import { describe, expect, it } from "vitest";
import { hasPermission, isAssignedToBranch } from "@/lib/permissions/roles";
import { inventoryLocationSchema, organizationSchema, userProfileSchema } from "@/lib/validation/foundation";

describe("foundation validation", () => {
  it("normalizes organization defaults and requires uppercase codes", () => {
    expect(organizationSchema.parse({ name: "Solar Operations", code: "SOLAR" })).toMatchObject({ defaultCurrency: "NGN", timezone: "Africa/Lagos" });
    expect(() => organizationSchema.parse({ name: "Solar Operations", code: "solar" })).toThrow();
  });

  it("requires the owner for physical inventory locations", () => {
    const base = { organizationId: "org-1", name: "Main", code: "MAIN", status: "active" };
    expect(() => inventoryLocationSchema.parse({ ...base, type: "warehouse" })).toThrow(/require a warehouse/i);
    expect(inventoryLocationSchema.parse({ ...base, type: "branch", branchId: "branch-1" })).toMatchObject({ branchId: "branch-1" });
  });

  it("rejects unknown roles and permissions", () => {
    expect(() => userProfileSchema.parse({ organizationId: "org-1", email: "a@example.com", displayName: "Ada User", roleIds: ["owner"] })).toThrow();
  });
});

describe("least-privilege permissions", () => {
  const officer = { status: "active" as const, roleIds: ["warehouse_officer" as const], permissionOverrides: [], branchIds: ["branch-1"] };
  it("allows only permissions assigned to the role", () => {
    expect(hasPermission(officer, "inventory.operate")).toBe(true);
    expect(hasPermission(officer, "cost.approve")).toBe(false);
  });
  it("denies inactive profiles and isolates branch assignments", () => {
    expect(hasPermission({ ...officer, status: "inactive" }, "inventory.operate")).toBe(false);
    expect(isAssignedToBranch(officer, "branch-1")).toBe(true);
    expect(isAssignedToBranch(officer, "branch-2")).toBe(false);
  });
});
