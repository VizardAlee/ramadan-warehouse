import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import { normalizeRoleIds, permissionsForServerRole, type Permission, type RoleId } from "./authorize.js";

export interface StoredRole {
  id: string;
  organizationId: string;
  name: string;
  baseRoleId: RoleId;
  permissionIds: Permission[];
  status: "active" | "inactive";
}

export function customRoleIds(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))]
    : [];
}

export function buildRoleAssignment(direct: readonly RoleId[], custom: readonly StoredRole[]) {
  const roleIds = normalizeRoleIds([...direct, ...custom.map((role) => role.baseRoleId)]);
  if (!roleIds.length) throw new HttpsError("invalid-argument", "Select at least one role.");
  const effectivePermissions = [...new Set<Permission>([
    ...direct.flatMap((roleId) => permissionsForServerRole(roleId)),
    ...custom.flatMap((role) => role.permissionIds),
  ])];
  return { roleId: roleIds[0]!, roleIds, directRoleIds: [...direct], customRoleIds: custom.map((role) => role.id), effectivePermissions };
}

export async function loadCustomRoles(organizationId: string, ids: readonly string[]): Promise<StoredRole[]> {
  if (ids.length > 10 || new Set(ids).size !== ids.length)
    throw new HttpsError("invalid-argument", "Select at most ten distinct custom roles.");
  if (!ids.length) return [];
  const snapshots = await db.getAll(...ids.map((id) => db.collection("roles").doc(id)));
  return snapshots.map((snapshot) => {
    if (!snapshot.exists || snapshot.get("organizationId") !== organizationId || snapshot.get("status") !== "active")
      throw new HttpsError("failed-precondition", "A selected role is unavailable or inactive.");
    return { id: snapshot.id, ...snapshot.data() } as StoredRole;
  });
}
