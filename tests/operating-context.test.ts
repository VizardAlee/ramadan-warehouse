import { describe, expect, it } from "vitest";
import {
  availableOperatingContexts,
  operatingContextTypeLabel,
  operationalLocationKind,
  isAvailableOperatingContext,
  narrowProfileToOperatingContext,
  hasOrganizationWideOperatingAccess,
} from "@/features/auth/operating-context";
import type { UserProfile } from "@/types/domain";

const profile = {
  id: "user-1",
  uid: "user-1",
  organizationId: "org-1",
  email: "manager@example.com",
  displayName: "Dual manager",
  status: "active",
  roleId: "warehouse_manager",
  roleIds: ["warehouse_manager", "branch_manager"],
  branchIds: ["branch-1"],
  warehouseIds: ["warehouse-1"],
  authDisabled: false,
  authorizationVersion: 1,
  createdAt: "2026-08-14T00:00:00.000Z",
  createdBy: "admin",
  updatedAt: "2026-08-14T00:00:00.000Z",
  updatedBy: "admin",
} satisfies UserProfile;

describe("operating context", () => {
  it("labels the branch-first model without erasing legacy warehouse identity", () => {
    expect(
      operatingContextTypeLabel(
        { type: "branch", id: "head-office" },
        "head_office",
      ),
    ).toBe("Head office / central distribution");
    expect(
      operationalLocationKind({ type: "branch", id: "store-1" }, "store"),
    ).toBe("store");
    expect(
      operatingContextTypeLabel({ type: "warehouse", id: "warehouse-1" }),
    ).toBe("Legacy warehouse");
  });

  it("offers every assigned warehouse and branch to a dual manager", () => {
    expect(availableOperatingContexts(profile)).toEqual([
      { type: "warehouse", id: "warehouse-1" },
      { type: "branch", id: "branch-1" },
    ]);
  });

  it("narrows branch data while retaining every assigned role", () => {
    expect(
      narrowProfileToOperatingContext(profile, {
        type: "branch",
        id: "branch-1",
      }),
    ).toMatchObject({
      roleId: "branch_manager",
      roleIds: ["warehouse_manager", "branch_manager"],
      branchIds: ["branch-1"],
      warehouseIds: [],
    });
  });

  it("rejects a stale or unassigned browser selection", () => {
    expect(
      isAvailableOperatingContext(
        { type: "warehouse", id: "warehouse-2" },
        profile,
      ),
    ).toBe(false);
    expect(
      narrowProfileToOperatingContext(profile, {
        type: "warehouse",
        id: "warehouse-2",
      }),
    ).toBe(profile);
  });

  it("does not scope organization-wide administrators", () => {
    const administrator = {
      ...profile,
      roleId: "system_administrator",
      roleIds: ["system_administrator", "warehouse_manager"],
    } satisfies UserProfile;
    expect(availableOperatingContexts(administrator)).toEqual([]);
    expect(hasOrganizationWideOperatingAccess(administrator)).toBe(true);
    expect(
      narrowProfileToOperatingContext(administrator, {
        type: "branch",
        id: "any-organization-branch",
      }),
    ).toBe(administrator);
  });
});
