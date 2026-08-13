import type { UserProfile } from "@/types/domain";

type ManagerRole = "branch_manager" | "warehouse_manager";

export function eligibleManagers(
  users: UserProfile[],
  roleId: ManagerRole,
): UserProfile[] {
  return users.filter(
    (user) => user.status === "active" && user.roleId === roleId,
  );
}
