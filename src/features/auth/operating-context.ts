import type { RoleId, UserProfile } from "@/types/domain";

export type OperatingContext =
  | { type: "warehouse"; id: string }
  | { type: "branch"; id: string };

export const OPERATING_CONTEXT_STORAGE_KEY = "warehouse-operating-context";

const organizationWideRoles: readonly RoleId[] = [
  "system_administrator",
  "operations_administrator",
  "finance_officer",
  "auditor",
];
const warehouseRoles: readonly RoleId[] = [
  "warehouse_manager",
  "warehouse_officer",
];
const branchRoles: readonly RoleId[] = ["branch_manager", "branch_requester"];

function assignedRoles(profile: UserProfile): RoleId[] {
  return profile.roleIds?.length ? profile.roleIds : [profile.roleId];
}

export function availableOperatingContexts(
  profile: UserProfile,
): OperatingContext[] {
  const roles = assignedRoles(profile);
  if (roles.some((role) => organizationWideRoles.includes(role))) return [];
  const contexts: OperatingContext[] = [];
  if (roles.some((role) => warehouseRoles.includes(role))) {
    contexts.push(
      ...profile.warehouseIds.map((id) => ({ type: "warehouse" as const, id })),
    );
  }
  if (roles.some((role) => branchRoles.includes(role))) {
    contexts.push(
      ...profile.branchIds.map((id) => ({ type: "branch" as const, id })),
    );
  }
  return contexts;
}

export function isAvailableOperatingContext(
  context: OperatingContext | null,
  profile: UserProfile,
): context is OperatingContext {
  return Boolean(
    context &&
      availableOperatingContexts(profile).some(
        (candidate) =>
          candidate.type === context.type && candidate.id === context.id,
      ),
  );
}

export function narrowProfileToOperatingContext(
  profile: UserProfile,
  context: OperatingContext | null,
): UserProfile {
  if (!context || !isAvailableOperatingContext(context, profile)) return profile;
  const roles = assignedRoles(profile).filter((role) =>
    context.type === "warehouse"
      ? warehouseRoles.includes(role)
      : branchRoles.includes(role),
  );
  return {
    ...profile,
    roleId: roles[0]!,
    roleIds: roles,
    branchIds: context.type === "branch" ? [context.id] : [],
    warehouseIds: context.type === "warehouse" ? [context.id] : [],
  };
}

export function readStoredOperatingContext(): OperatingContext | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(OPERATING_CONTEXT_STORAGE_KEY) ?? "null",
    ) as Partial<OperatingContext> | null;
    if (
      parsed &&
      (parsed.type === "warehouse" || parsed.type === "branch") &&
      typeof parsed.id === "string" &&
      parsed.id
    ) {
      return { type: parsed.type, id: parsed.id };
    }
  } catch {
    // A malformed browser value is safely replaced by the first valid assignment.
  }
  return null;
}

export function storeOperatingContext(context: OperatingContext | null): void {
  if (typeof window === "undefined") return;
  if (context) {
    window.localStorage.setItem(
      OPERATING_CONTEXT_STORAGE_KEY,
      JSON.stringify(context),
    );
  } else {
    window.localStorage.removeItem(OPERATING_CONTEXT_STORAGE_KEY);
  }
}
