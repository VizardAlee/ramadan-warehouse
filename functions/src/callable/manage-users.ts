import { randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { adminAuth, db } from "../admin.js";
import { assertAssignableRole, requireAccess, requireOrganizationAccess, requirePermission, type RoleId } from "../auth/authorize.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { enforceAppCheck } from "../config.js";
import { validateAssignments } from "../services/assignments.js";
import { revokeSessionsInput, updateUserInput, userInput } from "../validation/administration.js";
import { correlationId, parseInput } from "../utils/callable.js";

function operationRef(organizationId: string, action: string, key: string) { return db.collection("idempotencyKeys").doc(`${organizationId}_${action}_${key}`); }
function emailRef(email: string) { return db.collection("userEmails").doc(encodeURIComponent(email)); }

export const createOrganizationUser = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request); requirePermission(actor, "user.manage");
  const input = parseInput(userInput, request.data); assertAssignableRole(actor, undefined, input.roleId); await validateAssignments(actor, input.branchIds, input.warehouseIds);
  const operation = operationRef(actor.organizationId, "createUser", input.idempotencyKey);
  const prior = await operation.get();
  if (prior.exists && prior.get("status") === "completed") return { userId: prior.get("userId") as string, created: false, invitationLink: null };
  try { await adminAuth.getUserByEmail(input.email); throw new HttpsError("already-exists", "An Authentication account already exists for this email. Use the documented recovery process; it was not attached."); }
  catch (error) { if (error instanceof HttpsError) throw error; const code = (error as { code?: string }).code; if (code !== "auth/user-not-found") throw new HttpsError("internal", "Unable to verify the account email."); }

  const temporaryPassword = randomBytes(48).toString("base64url");
  const authUser = await adminAuth.createUser({ email: input.email, displayName: input.displayName, phoneNumber: input.phoneNumber, password: temporaryPassword, disabled: input.status !== "active", emailVerified: false });
  const requestId = correlationId();
  try {
    await db.runTransaction(async (transaction) => {
      const [existingOperation, existingEmail] = await Promise.all([transaction.get(operation), transaction.get(emailRef(input.email))]);
      if (existingOperation.exists || existingEmail.exists) throw new HttpsError("already-exists", "This user provisioning request has already been processed.");
      const now = FieldValue.serverTimestamp();
      transaction.create(db.collection("users").doc(authUser.uid), { uid: authUser.uid, organizationId: actor.organizationId, email: input.email, displayName: input.displayName, phoneNumber: input.phoneNumber ?? null, employeeReference: input.employeeReference ?? null, roleId: input.roleId, branchIds: input.branchIds, warehouseIds: input.warehouseIds, status: input.status, authDisabled: input.status !== "active", authorizationVersion: 1, createdAt: now, createdBy: actor.userId, updatedAt: now, updatedBy: actor.userId, lastRoleChangeAt: now, lastRoleChangedBy: actor.userId });
      transaction.create(emailRef(input.email), { uid: authUser.uid, organizationId: actor.organizationId, createdAt: now });
      transaction.create(operation, { organizationId: actor.organizationId, action: "createUser", userId: authUser.uid, status: "completed", createdAt: now, createdBy: actor.userId });
      writeAuditLog(transaction, actor, { action: "user.created", entityType: "user", entityId: authUser.uid, correlationId: requestId, sourceFunction: "createOrganizationUser", after: { email: input.email, roleId: input.roleId, branchIds: input.branchIds, warehouseIds: input.warehouseIds, status: input.status } });
    });
  } catch (error) { await adminAuth.deleteUser(authUser.uid).catch(() => undefined); throw error; }
  await adminAuth.setCustomUserClaims(authUser.uid, { organizationId: actor.organizationId, authorizationVersion: 1 });
  await db.runTransaction(async (transaction) => writeAuditLog(transaction, actor, { action: "custom_claim.updated", entityType: "user", entityId: authUser.uid, correlationId: requestId, sourceFunction: "createOrganizationUser", after: { organizationId: actor.organizationId, authorizationVersion: 1 } }));
  const invitationLink = await adminAuth.generatePasswordResetLink(input.email).catch(() => null);
  logger.info("Organization user provisioned", { organizationId: actor.organizationId, actorUserId: actor.userId, targetUserId: authUser.uid, correlationId: requestId });
  return { userId: authUser.uid, created: true, invitationLink };
});

export const updateOrganizationUser = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request); requirePermission(actor, "user.manage");
  const input = parseInput(updateUserInput, request.data);
  const targetRef = db.collection("users").doc(input.userId); const targetSnapshot = await targetRef.get();
  if (!targetSnapshot.exists) throw new HttpsError("not-found", "User profile not found.");
  const before = targetSnapshot.data() as Record<string, unknown>; requireOrganizationAccess(actor, String(before.organizationId));
  if (input.userId === actor.userId && (input.roleId || input.status || input.branchIds || input.warehouseIds)) throw new HttpsError("permission-denied", "You cannot change your own access assignments or status.");
  const nextRole = (input.roleId ?? before.roleId) as RoleId;
  if (input.roleId && input.roleId !== before.roleId) assertAssignableRole(actor, input.userId, input.roleId);
  const branchIds = input.branchIds ?? (before.branchIds as string[]); const warehouseIds = input.warehouseIds ?? (before.warehouseIds as string[]);
  await validateAssignments(actor, branchIds, warehouseIds);
  const operation = operationRef(actor.organizationId, "updateUser", input.idempotencyKey); const requestId = correlationId();
  await db.runTransaction(async (transaction) => {
    const [fresh, previousOperation] = await Promise.all([transaction.get(targetRef), transaction.get(operation)]);
    if (previousOperation.exists) return;
    const current = fresh.data() as Record<string, unknown>; const removesFinalAdmin = current.roleId === "system_administrator" && (nextRole !== "system_administrator" || (input.status && input.status !== "active"));
    if (removesFinalAdmin) {
      const administrators = await transaction.get(db.collection("users").where("organizationId", "==", actor.organizationId).where("roleId", "==", "system_administrator").where("status", "==", "active").limit(2));
      if (administrators.size <= 1) throw new HttpsError("failed-precondition", "The final active system administrator cannot be removed or deactivated.");
    }
    const version = Number(current.authorizationVersion ?? 1) + 1; const now = FieldValue.serverTimestamp();
    const changes: Record<string, unknown> = { ...input, roleId: nextRole, branchIds, warehouseIds, authDisabled: input.status ? input.status !== "active" : current.authDisabled, authorizationVersion: version, updatedAt: now, updatedBy: actor.userId };
    delete changes.userId; delete changes.reason; delete changes.idempotencyKey;
    if (input.roleId && input.roleId !== current.roleId) { changes.lastRoleChangeAt = now; changes.lastRoleChangedBy = actor.userId; }
    transaction.update(targetRef, changes); transaction.create(operation, { organizationId: actor.organizationId, action: "updateUser", userId: input.userId, status: "completed", createdAt: now, createdBy: actor.userId });
    writeAuditLog(transaction, actor, { action: input.status && input.status !== current.status ? `user.${input.status === "active" ? "activated" : "deactivated"}` : input.roleId !== current.roleId ? "user.role_changed" : "user.updated", entityType: "user", entityId: input.userId, correlationId: requestId, sourceFunction: "updateOrganizationUser", reason: input.reason, before: { roleId: current.roleId, branchIds: current.branchIds, warehouseIds: current.warehouseIds, status: current.status }, after: { roleId: nextRole, branchIds, warehouseIds, status: input.status ?? current.status } });
    if (JSON.stringify(branchIds) !== JSON.stringify(current.branchIds)) writeAuditLog(transaction, actor, { action: "user.branch_assignments_changed", entityType: "user", entityId: input.userId, correlationId: requestId, sourceFunction: "updateOrganizationUser", reason: input.reason, before: { branchIds: current.branchIds }, after: { branchIds } });
    if (JSON.stringify(warehouseIds) !== JSON.stringify(current.warehouseIds)) writeAuditLog(transaction, actor, { action: "user.warehouse_assignments_changed", entityType: "user", entityId: input.userId, correlationId: requestId, sourceFunction: "updateOrganizationUser", reason: input.reason, before: { warehouseIds: current.warehouseIds }, after: { warehouseIds } });
  });
  const updated = await targetRef.get(); const data = updated.data() as Record<string, unknown>;
  await adminAuth.updateUser(input.userId, { disabled: data.authDisabled === true, displayName: typeof data.displayName === "string" ? data.displayName : undefined, phoneNumber: typeof data.phoneNumber === "string" ? data.phoneNumber : undefined });
  await adminAuth.setCustomUserClaims(input.userId, { organizationId: actor.organizationId, authorizationVersion: data.authorizationVersion });
  await db.runTransaction(async (transaction) => writeAuditLog(transaction, actor, { action: "custom_claim.updated", entityType: "user", entityId: input.userId, correlationId: requestId, sourceFunction: "updateOrganizationUser", after: { organizationId: actor.organizationId, authorizationVersion: data.authorizationVersion } }));
  if (data.authDisabled === true || input.roleId) await adminAuth.revokeRefreshTokens(input.userId);
  logger.info("Organization user updated", { organizationId: actor.organizationId, actorUserId: actor.userId, targetUserId: input.userId, correlationId: requestId });
  return { userId: input.userId, updated: true, authorizationVersion: data.authorizationVersion };
});

export const revokeUserSessions = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request); requirePermission(actor, "user.manage"); const input = parseInput(revokeSessionsInput, request.data);
  const target = await db.collection("users").doc(input.userId).get(); if (!target.exists) throw new HttpsError("not-found", "User profile not found."); requireOrganizationAccess(actor, String(target.get("organizationId")));
  await adminAuth.revokeRefreshTokens(input.userId); const requestId = correlationId();
  await db.runTransaction(async (transaction) => writeAuditLog(transaction, actor, { action: "user.sessions_revoked", entityType: "user", entityId: input.userId, correlationId: requestId, sourceFunction: "revokeUserSessions", reason: input.reason }));
  logger.info("User sessions revoked", { organizationId: actor.organizationId, actorUserId: actor.userId, targetUserId: input.userId, correlationId: requestId });
  return { userId: input.userId, revoked: true };
});
