import { randomBytes } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { adminAuth, db } from "../admin.js";
import { assertAssignableRoles, normalizeRoleIds, requireAccess, requireOrganizationAccess, requirePermission } from "../auth/authorize.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { enforceAppCheck } from "../config.js";
import { validateAssignments } from "../services/assignments.js";
import { reissueInvitationInput, revokeSessionsInput, updateUserInput, userInput } from "../validation/administration.js";
import { correlationId, parseInput } from "../utils/callable.js";
import { toFirebasePhoneNumber } from "../utils/nigerian-phone.js";

function operationRef(organizationId: string, action: string, key: string) { return db.collection("idempotencyKeys").doc(`${organizationId}_${action}_${key}`); }
function emailRef(email: string) { return db.collection("userEmails").doc(encodeURIComponent(email)); }
const invitationTtlMs = 60 * 60 * 1_000;

function hasUsedInvitation(authUser: Awaited<ReturnType<typeof adminAuth.getUser>>) {
  if (!authUser.metadata.lastSignInTime) return false;
  const createdAt = Date.parse(authUser.metadata.creationTime);
  const lastSignedInAt = Date.parse(authUser.metadata.lastSignInTime);
  return Number.isFinite(createdAt) && Number.isFinite(lastSignedInAt) && lastSignedInAt > createdAt;
}

export const createOrganizationUser = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request); requirePermission(actor, "user.manage");
  const input = parseInput(userInput, request.data);
  const roleIds = normalizeRoleIds(input.roleIds, input.roleId);
  assertAssignableRoles(actor, undefined, roleIds);
  await validateAssignments(actor, input.branchIds, input.warehouseIds);
  const operation = operationRef(actor.organizationId, "createUser", input.idempotencyKey);
  const prior = await operation.get();
  if (prior.exists && prior.get("status") === "completed") return { userId: prior.get("userId") as string, created: false, invitationLink: null };
  try { await adminAuth.getUserByEmail(input.email); throw new HttpsError("already-exists", "An Authentication account already exists for this email. Use the documented recovery process; it was not attached."); }
  catch (error) { if (error instanceof HttpsError) throw error; const code = (error as { code?: string }).code; if (code !== "auth/user-not-found") throw new HttpsError("internal", "Unable to verify the account email."); }

  const temporaryPassword = randomBytes(48).toString("base64url");
  const authUser = await adminAuth.createUser({ email: input.email, displayName: input.displayName, phoneNumber: toFirebasePhoneNumber(input.phoneNumber), password: temporaryPassword, disabled: input.status !== "active", emailVerified: false });
  const requestId = correlationId();
  const invitationExpiresAt = Timestamp.fromMillis(Date.now() + invitationTtlMs);
  let invitationLink: string;
  try { invitationLink = await adminAuth.generatePasswordResetLink(input.email); }
  catch (error) {
    await adminAuth.deleteUser(authUser.uid).catch(() => undefined);
    logger.error("Unable to generate invitation link", { organizationId: actor.organizationId, actorUserId: actor.userId, targetUserId: authUser.uid, correlationId: requestId, error });
    throw new HttpsError("unavailable", "The invitation link could not be generated. Try again.");
  }
  try {
    await db.runTransaction(async (transaction) => {
      const [existingOperation, existingEmail] = await Promise.all([transaction.get(operation), transaction.get(emailRef(input.email))]);
      if (existingOperation.exists || existingEmail.exists) throw new HttpsError("already-exists", "This user provisioning request has already been processed.");
      const now = FieldValue.serverTimestamp();
      transaction.create(db.collection("users").doc(authUser.uid), { uid: authUser.uid, organizationId: actor.organizationId, email: input.email, displayName: input.displayName, phoneNumber: input.phoneNumber ?? null, employeeReference: input.employeeReference ?? null, roleId: roleIds[0], roleIds, branchIds: input.branchIds, warehouseIds: input.warehouseIds, status: input.status, authDisabled: input.status !== "active", authorizationVersion: 1, invitationStatus: "pending", invitationIssuedAt: now, invitationExpiresAt, invitationAttemptCount: 1, createdAt: now, createdBy: actor.userId, updatedAt: now, updatedBy: actor.userId, lastRoleChangeAt: now, lastRoleChangedBy: actor.userId });
      transaction.create(emailRef(input.email), { uid: authUser.uid, organizationId: actor.organizationId, createdAt: now });
      transaction.create(operation, { organizationId: actor.organizationId, action: "createUser", userId: authUser.uid, status: "completed", createdAt: now, createdBy: actor.userId });
      writeAuditLog(transaction, actor, { action: "user.created", entityType: "user", entityId: authUser.uid, correlationId: requestId, sourceFunction: "createOrganizationUser", after: { email: input.email, roleId: roleIds[0], roleIds, branchIds: input.branchIds, warehouseIds: input.warehouseIds, status: input.status } });
    });
  } catch (error) { await adminAuth.deleteUser(authUser.uid).catch(() => undefined); throw error; }
  await adminAuth.setCustomUserClaims(authUser.uid, { organizationId: actor.organizationId, authorizationVersion: 1 });
  await db.runTransaction(async (transaction) => writeAuditLog(transaction, actor, { action: "custom_claim.updated", entityType: "user", entityId: authUser.uid, correlationId: requestId, sourceFunction: "createOrganizationUser", after: { organizationId: actor.organizationId, authorizationVersion: 1 } }));
  logger.info("Organization user provisioned", { organizationId: actor.organizationId, actorUserId: actor.userId, targetUserId: authUser.uid, correlationId: requestId });
  return { userId: authUser.uid, created: true, invitationLink, invitationExpiresAt: invitationExpiresAt.toDate().toISOString() };
});

export const reissueOrganizationUserInvitation = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request); requirePermission(actor, "user.manage");
  const input = parseInput(reissueInvitationInput, request.data);
  if (input.userId === actor.userId) throw new HttpsError("failed-precondition", "You cannot re-issue an invitation for your own active account.", { code: "INVITATION_ALREADY_ACCEPTED" });
  const targetRef = db.collection("users").doc(input.userId);
  const target = await targetRef.get();
  if (!target.exists) throw new HttpsError("not-found", "User profile not found.");
  const profile = target.data() as Record<string, unknown>;
  requireOrganizationAccess(actor, String(profile.organizationId));
  if (profile.status !== "active" || profile.authDisabled === true) throw new HttpsError("failed-precondition", "Activate this user before issuing a new invitation.", { code: "INVITATION_USER_INACTIVE" });
  const isRecordedInvite = profile.invitationStatus === "pending" || profile.invitationStatus === "expired";
  const isLegacyInvite = profile.invitationStatus == null && typeof profile.createdBy === "string" && profile.createdBy !== input.userId;
  if (!isRecordedInvite && !isLegacyInvite) throw new HttpsError("failed-precondition", "This account is not awaiting invitation acceptance.", { code: "INVITATION_ALREADY_ACCEPTED" });
  const authUser = await adminAuth.getUser(input.userId).catch(() => { throw new HttpsError("not-found", "The invitation Authentication account no longer exists."); });
  if (!authUser.email) throw new HttpsError("failed-precondition", "The invited account has no email address.");
  if (hasUsedInvitation(authUser)) throw new HttpsError("failed-precondition", "This user has already activated or used the account.", { code: "INVITATION_ALREADY_ACCEPTED" });
  const operation = operationRef(actor.organizationId, "reissueUserInvitation", input.idempotencyKey);
  const prior = await operation.get();
  if (prior.exists && prior.get("status") === "completed") return { userId: input.userId, reissued: false, invitationLink: null, invitationExpiresAt: prior.get("invitationExpiresAt")?.toDate?.()?.toISOString?.() ?? null };
  const invitationLink = await adminAuth.generatePasswordResetLink(authUser.email).catch((error) => {
    logger.error("Unable to re-issue invitation link", { organizationId: actor.organizationId, actorUserId: actor.userId, targetUserId: input.userId, error });
    throw new HttpsError("unavailable", "The invitation link could not be generated. Try again.");
  });
  const refreshedAuthUser = await adminAuth.getUser(input.userId);
  if (hasUsedInvitation(refreshedAuthUser)) throw new HttpsError("failed-precondition", "This user has already activated or used the account.", { code: "INVITATION_ALREADY_ACCEPTED" });
  const invitationExpiresAt = Timestamp.fromMillis(Date.now() + invitationTtlMs); const requestId = correlationId();
  await db.runTransaction(async (transaction) => {
    const [fresh, previousOperation] = await Promise.all([transaction.get(targetRef), transaction.get(operation)]);
    if (previousOperation.exists) return;
    if (!fresh.exists || fresh.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "User profile not found.");
    const now = FieldValue.serverTimestamp();
    transaction.update(targetRef, { invitationStatus: "pending", invitationIssuedAt: now, invitationExpiresAt, invitationAttemptCount: FieldValue.increment(1), updatedAt: now, updatedBy: actor.userId });
    transaction.create(operation, { organizationId: actor.organizationId, action: "reissueUserInvitation", userId: input.userId, status: "completed", invitationExpiresAt, createdAt: now, createdBy: actor.userId });
    writeAuditLog(transaction, actor, { action: "user.invitation_reissued", entityType: "user", entityId: input.userId, correlationId: requestId, sourceFunction: "reissueOrganizationUserInvitation", before: { invitationStatus: profile.invitationStatus ?? "legacy" }, after: { invitationStatus: "pending", invitationExpiresAt: invitationExpiresAt.toDate().toISOString() } });
  });
  logger.info("Organization user invitation re-issued", { organizationId: actor.organizationId, actorUserId: actor.userId, targetUserId: input.userId, correlationId: requestId });
  return { userId: input.userId, reissued: true, invitationLink, invitationExpiresAt: invitationExpiresAt.toDate().toISOString() };
});

export const updateOrganizationUser = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request); requirePermission(actor, "user.manage");
  const input = parseInput(updateUserInput, request.data);
  const targetRef = db.collection("users").doc(input.userId); const targetSnapshot = await targetRef.get();
  if (!targetSnapshot.exists) throw new HttpsError("not-found", "User profile not found.");
  const before = targetSnapshot.data() as Record<string, unknown>; requireOrganizationAccess(actor, String(before.organizationId));
  if (input.userId === actor.userId && (input.roleId || input.roleIds || input.status || input.branchIds || input.warehouseIds)) throw new HttpsError("permission-denied", "You cannot change your own access assignments or status.");
  const beforeRoleIds = normalizeRoleIds(before.roleIds, before.roleId);
  const rolesWereSubmitted = Boolean(input.roleId || input.roleIds);
  const nextRoleIds = rolesWereSubmitted
    ? normalizeRoleIds(input.roleIds, input.roleId)
    : beforeRoleIds;
  if (rolesWereSubmitted && JSON.stringify(nextRoleIds) !== JSON.stringify(beforeRoleIds)) assertAssignableRoles(actor, input.userId, nextRoleIds);
  const branchIds = input.branchIds ?? (before.branchIds as string[]); const warehouseIds = input.warehouseIds ?? (before.warehouseIds as string[]);
  await validateAssignments(actor, branchIds, warehouseIds);
  const operation = operationRef(actor.organizationId, "updateUser", input.idempotencyKey); const requestId = correlationId();
  await db.runTransaction(async (transaction) => {
    const [fresh, previousOperation] = await Promise.all([transaction.get(targetRef), transaction.get(operation)]);
    if (previousOperation.exists) return;
    const current = fresh.data() as Record<string, unknown>;
    const currentRoleIds = normalizeRoleIds(current.roleIds, current.roleId);
    const removesFinalAdmin = currentRoleIds.includes("system_administrator") && (!nextRoleIds.includes("system_administrator") || (input.status && input.status !== "active"));
    if (removesFinalAdmin) {
      const activeUsers = await transaction.get(db.collection("users").where("organizationId", "==", actor.organizationId).where("status", "==", "active"));
      const administratorCount = activeUsers.docs.filter((user) => normalizeRoleIds(user.get("roleIds"), user.get("roleId")).includes("system_administrator")).length;
      if (administratorCount <= 1) throw new HttpsError("failed-precondition", "The final active system administrator cannot be removed or deactivated.");
    }
    const version = Number(current.authorizationVersion ?? 1) + 1; const now = FieldValue.serverTimestamp();
    const changes: Record<string, unknown> = { ...input, roleId: nextRoleIds[0], roleIds: nextRoleIds, branchIds, warehouseIds, authDisabled: input.status ? input.status !== "active" : current.authDisabled, authorizationVersion: version, updatedAt: now, updatedBy: actor.userId };
    delete changes.userId; delete changes.reason; delete changes.idempotencyKey;
    const rolesChanged = JSON.stringify(nextRoleIds) !== JSON.stringify(currentRoleIds);
    if (rolesChanged) { changes.lastRoleChangeAt = now; changes.lastRoleChangedBy = actor.userId; }
    transaction.update(targetRef, changes); transaction.create(operation, { organizationId: actor.organizationId, action: "updateUser", userId: input.userId, status: "completed", createdAt: now, createdBy: actor.userId });
    writeAuditLog(transaction, actor, { action: input.status && input.status !== current.status ? `user.${input.status === "active" ? "activated" : "deactivated"}` : rolesChanged ? "user.roles_changed" : "user.updated", entityType: "user", entityId: input.userId, correlationId: requestId, sourceFunction: "updateOrganizationUser", reason: input.reason, before: { roleId: currentRoleIds[0], roleIds: currentRoleIds, branchIds: current.branchIds, warehouseIds: current.warehouseIds, status: current.status }, after: { roleId: nextRoleIds[0], roleIds: nextRoleIds, branchIds, warehouseIds, status: input.status ?? current.status } });
    if (JSON.stringify(branchIds) !== JSON.stringify(current.branchIds)) writeAuditLog(transaction, actor, { action: "user.branch_assignments_changed", entityType: "user", entityId: input.userId, correlationId: requestId, sourceFunction: "updateOrganizationUser", reason: input.reason, before: { branchIds: current.branchIds }, after: { branchIds } });
    if (JSON.stringify(warehouseIds) !== JSON.stringify(current.warehouseIds)) writeAuditLog(transaction, actor, { action: "user.warehouse_assignments_changed", entityType: "user", entityId: input.userId, correlationId: requestId, sourceFunction: "updateOrganizationUser", reason: input.reason, before: { warehouseIds: current.warehouseIds }, after: { warehouseIds } });
  });
  const updated = await targetRef.get(); const data = updated.data() as Record<string, unknown>;
  await adminAuth.updateUser(input.userId, { disabled: data.authDisabled === true, displayName: typeof data.displayName === "string" ? data.displayName : undefined, phoneNumber: toFirebasePhoneNumber(typeof data.phoneNumber === "string" ? data.phoneNumber : undefined) });
  await adminAuth.setCustomUserClaims(input.userId, { organizationId: actor.organizationId, authorizationVersion: data.authorizationVersion });
  await db.runTransaction(async (transaction) => writeAuditLog(transaction, actor, { action: "custom_claim.updated", entityType: "user", entityId: input.userId, correlationId: requestId, sourceFunction: "updateOrganizationUser", after: { organizationId: actor.organizationId, authorizationVersion: data.authorizationVersion } }));
  if (data.authDisabled === true || rolesWereSubmitted) await adminAuth.revokeRefreshTokens(input.userId);
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
