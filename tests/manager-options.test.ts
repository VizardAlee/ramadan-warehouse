import { describe, expect, it } from "vitest";
import { eligibleManagers } from "../src/features/administration/manager-options";
import type { UserProfile } from "../src/types/domain";

function user(
  id: string,
  roleId: UserProfile["roleId"],
  status: UserProfile["status"] = "active",
  roleIds?: UserProfile["roleIds"],
): UserProfile {
  return { id, uid: id, displayName: id, email: `${id}@example.test`, roleId, roleIds, status } as UserProfile;
}

describe("administrative manager options", () => {
  const users = [
    user("admin", "system_administrator"),
    user("branch-active", "branch_manager"),
    user("branch-inactive", "branch_manager", "inactive"),
    user("warehouse-active", "warehouse_manager"),
    user("dual-manager", "warehouse_manager", "active", ["warehouse_manager", "branch_manager"]),
  ];

  it("offers only active branch managers for a branch", () => {
    expect(eligibleManagers(users, "branch_manager").map(({ id }) => id)).toEqual([
      "branch-active",
      "dual-manager",
    ]);
  });

  it("offers only active warehouse managers for a warehouse", () => {
    expect(
      eligibleManagers(users, "warehouse_manager").map(({ id }) => id),
    ).toEqual(["warehouse-active", "dual-manager"]);
  });
});
