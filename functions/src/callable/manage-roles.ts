import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import { adminAuth, db } from "../admin.js";
import { buildRoleAssignment, customRoleIds, type StoredRole } from "../auth/custom-roles.js";
import { normalizeRoleIds, permissionsForServerRole, requireAccess, requirePermission, roles, type Permission } from "../auth/authorize.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { enforceAppCheck } from "../config.js";
import { correlationId, parseInput } from "../utils/callable.js";

const inputSchema = z.object({
  id: z.string().min(1).max(128).optional(),
  name: z.string().trim().min(2).max(80),
  baseRoleId: z.enum(roles).refine((role) => role !== "system_administrator", "System administrator cannot be used as a custom role base."),
  permissionIds: z.array(z.string().min(1)).max(150),
  status: z.enum(["active", "inactive"]).default("active"),
  reason: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().uuid(),
});
function roleNameKey(organizationId: string, name: string) {
  return `${organizationId}_${createHash("sha256").update(name.trim().toLocaleLowerCase("en-NG")).digest("hex")}`;
}

async function refreshClaims(userIds: readonly string[], organizationId: string) {
  for (const userId of userIds) {
    const [profile, authUser] = await Promise.all([db.collection("users").doc(userId).get(), adminAuth.getUser(userId)]);
    if (!profile.exists || profile.get("organizationId") !== organizationId) continue;
    await adminAuth.setCustomUserClaims(userId, { ...authUser.customClaims, organizationId, authorizationVersion: profile.get("authorizationVersion") });
    await adminAuth.revokeRefreshTokens(userId);
  }
}

export const saveOrganizationRole = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request);
  requirePermission(actor, "role.manage");
  const input = parseInput(inputSchema, request.data);
  const allowed = permissionsForServerRole(input.baseRoleId);
  const selected = [...new Set(input.permissionIds)];
  if (selected.length !== input.permissionIds.length || selected.some((permission) => !allowed.includes(permission as Permission)))
    throw new HttpsError("invalid-argument", "Only permissions available to the selected base role can be granted.");
  if (input.id && !input.reason?.trim())
    throw new HttpsError("invalid-argument", "Give a reason for changing this role.");
  const roleId = input.id ?? db.collection("roles").doc().id;
  const roleRef = db.collection("roles").doc(roleId);
  const nameKey = roleNameKey(actor.organizationId, input.name);
  const nameRef = db.collection("roleNames").doc(nameKey);
  const operation = db.collection("idempotencyKeys").doc(`${actor.organizationId}_saveRole_${input.idempotencyKey}`);
  const requestId = correlationId();
  let affectedUserIds: string[] = [];
  await db.runTransaction(async (transaction) => {
    const [previousOperation, currentRole, reservedName] = await Promise.all([transaction.get(operation), transaction.get(roleRef), transaction.get(nameRef)]);
    if (previousOperation.exists) {
      affectedUserIds = customRoleIds(previousOperation.get("affectedUserIds"));
      return;
    }
    if (input.id && (!currentRole.exists || currentRole.get("organizationId") !== actor.organizationId))
      throw new HttpsError("not-found", "This role does not belong to your organization.");
    if (!input.id && currentRole.exists)
      throw new HttpsError("already-exists", "This role already exists.");
    if (reservedName.exists && reservedName.get("roleId") !== roleId)
      throw new HttpsError("already-exists", "A role with this name already exists.");
    const role: StoredRole = { id: roleId, organizationId: actor.organizationId, name: input.name, baseRoleId: input.baseRoleId, permissionIds: selected as Permission[], status: input.status };
    const members = input.id ? await transaction.get(db.collection("users").where("customRoleIds", "array-contains", roleId)) : null;
    if (members && members.size > 100)
      throw new HttpsError("resource-exhausted", "This role has over 100 users. Ask an administrator to schedule a controlled role migration.");
    const memberDocs = members?.docs.filter((member) => member.get("organizationId") === actor.organizationId) ?? [];
    if (memberDocs.length && currentRole.get("baseRoleId") !== input.baseRoleId)
      throw new HttpsError("failed-precondition", "The location scope cannot change while users hold this role. Reassign them first.");
    if (input.status === "inactive" && memberDocs.length)
      throw new HttpsError("failed-precondition", "Reassign users before deactivating this role.");
    const otherIds = [...new Set(memberDocs.flatMap((member) => customRoleIds(member.get("customRoleIds"))).filter((id) => id !== roleId))];
    const otherSnapshots = await Promise.all(otherIds.map((id) => transaction.get(db.collection("roles").doc(id))));
    const otherRoles = new Map(otherSnapshots.map((snapshot) => [snapshot.id, { id: snapshot.id, ...snapshot.data() } as StoredRole]));
    const now = FieldValue.serverTimestamp();
    transaction.set(roleRef, { ...role, createdAt: currentRole.exists ? currentRole.get("createdAt") : now, createdBy: currentRole.exists ? currentRole.get("createdBy") : actor.userId, updatedAt: now, updatedBy: actor.userId, version: Number(currentRole.get("version") ?? 0) + 1 });
    if (!reservedName.exists) transaction.create(nameRef, { organizationId: actor.organizationId, roleId, createdAt: now });
    const previousNameKey = currentRole.exists ? roleNameKey(actor.organizationId, String(currentRole.get("name") ?? "")) : null;
    if (previousNameKey && previousNameKey !== nameKey) transaction.delete(db.collection("roleNames").doc(previousNameKey));
    for (const member of memberDocs) {
      const directRoleIds = normalizeRoleIds(member.get("directRoleIds") ?? member.get("roleIds"));
      const selectedRoles = customRoleIds(member.get("customRoleIds")).map((id) => id === roleId ? role : otherRoles.get(id));
      if (selectedRoles.some((value) => !value || value.status !== "active"))
        throw new HttpsError("failed-precondition", "A user has another unavailable role. Resolve that assignment before changing this role.");
      const assignment = buildRoleAssignment(directRoleIds, selectedRoles as StoredRole[]);
      transaction.update(member.ref, { ...assignment, authorizationVersion: Number(member.get("authorizationVersion") ?? 1) + 1, lastRoleChangeAt: now, lastRoleChangedBy: actor.userId, updatedAt: now, updatedBy: actor.userId });
      writeAuditLog(transaction, actor, { action: "user.roles_changed", entityType: "user", entityId: member.id, correlationId: requestId, sourceFunction: "saveOrganizationRole", reason: input.reason, before: { roleIds: member.get("roleIds"), effectivePermissions: member.get("effectivePermissions") }, after: { roleIds: assignment.roleIds, effectivePermissions: assignment.effectivePermissions } });
    }
    affectedUserIds = memberDocs.map((member) => member.id);
    transaction.create(operation, { organizationId: actor.organizationId, roleId, affectedUserIds, status: "completed", createdAt: now, createdBy: actor.userId });
    writeAuditLog(transaction, actor, { action: currentRole.exists ? "role.updated" : "role.created", entityType: "role", entityId: roleId, correlationId: requestId, sourceFunction: "saveOrganizationRole", reason: input.reason, before: currentRole.exists ? { name: currentRole.get("name"), baseRoleId: currentRole.get("baseRoleId"), permissionIds: currentRole.get("permissionIds"), status: currentRole.get("status") } : undefined, after: { name: role.name, baseRoleId: role.baseRoleId, permissionIds: role.permissionIds, status: role.status } });
  });
  if (affectedUserIds.length) await refreshClaims(affectedUserIds, actor.organizationId);
  logger.info("Organization role saved", { organizationId: actor.organizationId, actorUserId: actor.userId, roleId, affectedUsers: affectedUserIds.length, correlationId: requestId });
  return { roleId, saved: true, affectedUsers: affectedUserIds.length };
});

export const getAssignableRolePermissions = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request);
  requirePermission(actor, "role.manage");
  return { roles: roles.filter((role) => role !== "system_administrator").map((roleId) => ({ roleId, permissionIds: permissionsForServerRole(roleId) })) };
});
