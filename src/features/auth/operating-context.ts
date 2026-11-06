import type { RoleId, UserProfile } from "@/types/domain";

export type OperatingContext =
  | { type: "warehouse"; id: string }
  | { type: "branch"; id: string };

export type OperationalLocationKind =
  | "head_office"
  | "store"
  | "legacy_warehouse";

export function operationalLocationKind(
  context: OperatingContext,
  branchType?: "head_office" | "store",
): OperationalLocationKind {
  if (context.type === "warehouse") return "legacy_warehouse";
  return branchType === "head_office" ? "head_office" : "store";
}

export function operatingContextTypeLabel(
  context: OperatingContext,
  branchType?: "head_office" | "store",
) {
  const kind = operationalLocationKind(context, branchType);
  if (kind === "head_office") return "Head office / central distribution";
  if (kind === "legacy_warehouse") return "Legacy warehouse";
  return "Store / branch";
}

export const OPERATING_CONTEXT_STORAGE_KEY = "warehouse-operating-context";
let storageKey = OPERATING_CONTEXT_STORAGE_KEY;
export function bindOperatingContextStorage(profile: Pick<UserProfile, "organizationId" | "uid">) {
  storageKey = `${OPERATING_CONTEXT_STORAGE_KEY}:${profile.organizationId}:${profile.uid}`;
  if (typeof window !== "undefined" && !window.sessionStorage.getItem(storageKey)) {
    const legacy = window.localStorage.getItem(OPERATING_CONTEXT_STORAGE_KEY);
    if (legacy) window.sessionStorage.setItem(storageKey, legacy);
    // The authenticated metadata loader validates any migrated branch against
    // this identity's organization before using it.
  }
}
export function hasExplicitAllSelection() {
  if (typeof window === "undefined") return false;
  try { return JSON.parse(window.sessionStorage.getItem(storageKey) ?? "null")?.type === "all"; } catch { return false; }
}

const organizationWideRoles: readonly RoleId[] = [
  "system_administrator",
  "operations_administrator",
  "finance_officer",
  "auditor",
];
const legacyWarehouseRoles: readonly RoleId[] = [
  "warehouse_manager",
  "warehouse_officer",
];
export function hasOrganizationWideOperatingAccess(profile: UserProfile) {
  return assignedRoles(profile).some((role) =>
    organizationWideRoles.includes(role),
  );
}

function assignedRoles(profile: UserProfile): RoleId[] {
  return profile.roleIds?.length ? profile.roleIds : [profile.roleId];
}

export function availableOperatingContexts(
  profile: UserProfile,
): OperatingContext[] {
  if (hasOrganizationWideOperatingAccess(profile)) return [];
  if (profile.branchIds.length) return profile.branchIds.map((id) => ({ type: "branch" as const, id }));
  return assignedRoles(profile).some(role => legacyWarehouseRoles.includes(role)) ? profile.warehouseIds.map(id => ({ type: "warehouse" as const, id })) : [];
}

export function isAvailableOperatingContext(
  context: OperatingContext | null,
  profile: UserProfile,
): context is OperatingContext {
  if (context && hasOrganizationWideOperatingAccess(profile)) return true;
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
  const roles = assignedRoles(profile);
  const storeRole = roles.find((role) => !legacyWarehouseRoles.includes(role));
  return {
    ...profile,
    // Keep the primary role relevant to the selected location for legacy UI
    // labels, but never discard permissions contributed by other assigned roles.
    roleId: storeRole ?? roles[0]!,
    roleIds: roles,
    branchIds: context.type === "branch" ? [context.id] : [],
    warehouseIds: context.type === "warehouse" ? [context.id] : [],
  };
}

export function readStoredOperatingContext(): OperatingContext | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(
      window.sessionStorage.getItem(storageKey) ?? "null",
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
    window.sessionStorage.setItem(
      storageKey,
      JSON.stringify(context),
    );
  } else {
    window.sessionStorage.setItem(storageKey, JSON.stringify({ type: "all" }));
  }
}
