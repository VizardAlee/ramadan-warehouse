import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { GoogleAuth } from "google-auth-library";
import { z } from "zod";
import { adminAuth, db } from "../admin.js";
import { normalizeRoleIds } from "../auth/authorize.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { enforceAppCheck } from "../config.js";
import { correlationId, parseInput } from "../utils/callable.js";

const resetInput = z.object({
  confirmation: z.string().trim(),
  reason: z.string().trim().min(10).max(500),
  idempotencyKey: z.string().uuid(),
});

interface ManagedBackup {
  name: string;
  database: string;
  snapshotTime: string;
  expireTime: string;
  state: string;
}

async function requireRecentManagedBackup(): Promise<ManagedBackup | null> {
  if (process.env.FUNCTIONS_EMULATOR === "true" || process.env.FIRESTORE_EMULATOR_HOST) return null;
  try {
    const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
    const projectId = await auth.getProjectId();
    const client = await auth.getClient();
    const response = await client.request<{ backups?: ManagedBackup[]; unreachable?: string[] }>({
      url: `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/locations/-/backups`,
    });
    if (response.data.unreachable?.length) throw new Error("Some backup locations were unavailable.");
    const now = Date.now();
    const eligible = (response.data.backups ?? []).filter((backup) =>
      backup.database === `projects/${projectId}/databases/(default)` &&
      backup.state === "READY" &&
      Date.parse(backup.snapshotTime) >= now - 24 * 60 * 60 * 1_000 &&
      Date.parse(backup.expireTime) > now + 24 * 60 * 60 * 1_000,
    ).sort((a, b) => b.snapshotTime.localeCompare(a.snapshotTime));
    if (!eligible[0]) throw new Error("No recent READY backup was found.");
    return eligible[0];
  } catch {
    throw new HttpsError("failed-precondition", "A recent READY managed Firestore backup could not be verified. Contact the backup operator before resetting.", { code: "BACKUP_NOT_VERIFIED" });
  }
}

function requireRecentAdministrator(request: CallableRequest<unknown>, profile: FirebaseFirestore.DocumentSnapshot) {
  if (!request.auth || !profile.exists || profile.get("status") !== "active" ||
    profile.get("authDisabled") === true ||
    !normalizeRoleIds(profile.get("roleIds"), profile.get("roleId")).includes("system_administrator"))
    throw new HttpsError("permission-denied", "Only an active system administrator can start a fresh organization.");
  const signedInAt = Number(request.auth.token.auth_time ?? 0);
  if (!signedInAt || Date.now() / 1_000 - signedInAt > 15 * 60)
    throw new HttpsError("failed-precondition", "Sign out and sign in again before starting a fresh organization.", { code: "RECENT_SIGN_IN_REQUIRED" });
}

export const previewOrganizationReset = onCall({ enforceAppCheck }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication is required.");
  const actor = await db.doc(`users/${request.auth.uid}`).get();
  if (!actor.exists || actor.get("status") !== "active" || actor.get("authDisabled") === true ||
    !normalizeRoleIds(actor.get("roleIds"), actor.get("roleId")).includes("system_administrator"))
    throw new HttpsError("permission-denied", "System administrator access is required.");
  const organizationId = String(actor.get("organizationId"));
  const [organization, users, products, sales, inventory] = await Promise.all([
    db.doc(`organizations/${organizationId}`).get(),
    db.collection("users").where("organizationId", "==", organizationId).count().get(),
    db.collection("products").where("organizationId", "==", organizationId).count().get(),
    db.collection("sales").where("organizationId", "==", organizationId).count().get(),
    db.collection("inventoryEntries").where("organizationId", "==", organizationId).count().get(),
  ]);
  if (!organization.exists || !["active", "resetting"].includes(String(organization.get("status"))))
    throw new HttpsError("failed-precondition", "The organization is not available for a reset preview.");
  return {
    organizationId,
    legalName: String(organization.get("legalName")),
    code: String(organization.get("code")),
    usersToDeactivate: Math.max(0, users.data().count - 1),
    products: products.data().count,
    sales: sales.data().count,
    inventoryEntries: inventory.data().count,
    method: "archive-and-start-fresh" as const,
    status: organization.get("status") as string,
  };
});

/**
 * A fresh organization ID is an operational generation boundary. No ledger,
 * financial, audit or customer document is deleted or rewritten; all old data
 * remains under the archived organization ID for controlled recovery.
 */
export const resetOrganizationData = onCall({ enforceAppCheck, timeoutSeconds: 540 }, async (request) => {
  const input = parseInput(resetInput, request.data);
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication is required.");
  const actorRef = db.doc(`users/${request.auth.uid}`);
  const actorProfile = await actorRef.get();
  requireRecentAdministrator(request, actorProfile);
  const resetRef = db.doc(`organizationResets/${input.idempotencyKey}`);
  const prior = await resetRef.get();
  const oldOrganizationId = prior.exists
    ? String(prior.get("oldOrganizationId"))
    : String(actorProfile.get("organizationId"));
  if (prior.exists && prior.get("actorUserId") !== request.auth.uid)
    throw new HttpsError("permission-denied", "This reset belongs to another administrator.");
  if (actorProfile.get("organizationId") !== oldOrganizationId &&
      actorProfile.get("resetFromOrganizationId") !== oldOrganizationId)
    throw new HttpsError("permission-denied", "The reset does not belong to your organization.");
  const oldOrgRef = db.doc(`organizations/${oldOrganizationId}`);
  const oldOrg = await oldOrgRef.get();
  if (!oldOrg.exists || input.confirmation !== `RESET ${String(oldOrg.get("code"))}`)
    throw new HttpsError("invalid-argument", "The confirmation phrase does not match the organization code.");
  const newOrgRef = prior.exists
    ? db.doc(`organizations/${String(prior.get("newOrganizationId"))}`)
    : db.collection("organizations").doc();
  const auditId = correlationId();

  if (!prior.exists) {
    const verifiedBackup = await requireRecentManagedBackup();
    await db.runTransaction(async (transaction) => {
      const [freshOld, freshReset, bootstrap] = await Promise.all([
        transaction.get(oldOrgRef), transaction.get(resetRef), transaction.get(db.doc("system/bootstrap")),
      ]);
      if (freshReset.exists) throw new HttpsError("already-exists", "Refresh and retry this reset request.");
      if (freshOld.get("status") !== "active" || bootstrap.get("organizationId") !== oldOrganizationId)
        throw new HttpsError("failed-precondition", "Another reset or organization transition is already underway.");
      const existing = freshOld.data() as Record<string, unknown>;
      const now = FieldValue.serverTimestamp();
      transaction.update(oldOrgRef, { status: "resetting", resetOperationId: resetRef.id, updatedAt: now, updatedBy: request.auth!.uid });
      transaction.create(newOrgRef, {
        legalName: existing.legalName, tradingName: existing.tradingName ?? null,
        code: existing.code, registrationNumber: existing.registrationNumber ?? null,
        contactEmail: existing.contactEmail ?? null, phoneNumbers: existing.phoneNumbers ?? [],
        address: existing.address ?? null, defaultCurrency: existing.defaultCurrency ?? "NGN",
        timezone: existing.timezone ?? "Africa/Lagos", status: "preparing",
        resetFromOrganizationId: oldOrganizationId, createdAt: now, createdBy: request.auth!.uid,
        updatedAt: now, updatedBy: request.auth!.uid,
      });
      transaction.create(resetRef, {
        oldOrganizationId, newOrganizationId: newOrgRef.id,
        actorUserId: request.auth!.uid, reason: input.reason,
        verifiedBackupName: verifiedBackup?.name ?? "emulator-only",
        verifiedBackupSnapshotTime: verifiedBackup?.snapshotTime ?? null,
        status: "deactivating_users", createdAt: now, updatedAt: now,
      });
      writeAuditLog(transaction, {
        userId: request.auth!.uid, organizationId: oldOrganizationId,
        roleId: "system_administrator", roleIds: ["system_administrator"],
        branchIds: [], warehouseIds: [], authorizationVersion: Number(actorProfile.get("authorizationVersion") ?? 1),
      }, { action: "organization.reset_started", entityType: "organization", entityId: oldOrganizationId,
        correlationId: auditId, sourceFunction: "resetOrganizationData", reason: input.reason,
        after: { newOrganizationId: newOrgRef.id } });
    });
  }

  // Process all other users before switching the initiating administrator.
  // Retrying the same key safely resumes users already moved to the new org.
  const remaining = await db.collection("users").where("organizationId", "==", oldOrganizationId).get();
  for (const user of remaining.docs) {
    if (user.id === request.auth.uid) continue;
    const archiveRef = resetRef.collection("deactivatedUsers").doc(user.id);
    await db.runTransaction(async (transaction) => {
      const [fresh, archived] = await Promise.all([transaction.get(user.ref), transaction.get(archiveRef)]);
      if (!fresh.exists || fresh.get("organizationId") !== oldOrganizationId) return;
      if (!archived.exists) transaction.create(archiveRef, {
        organizationId: oldOrganizationId, userId: user.id,
        originalStatus: fresh.get("status") ?? null, originalRoleIds: fresh.get("roleIds") ?? [],
        originalBranchIds: fresh.get("branchIds") ?? [], originalWarehouseIds: fresh.get("warehouseIds") ?? [],
        archivedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(user.ref, {
        organizationId: newOrgRef.id, status: "inactive", authDisabled: true,
        branchIds: [], warehouseIds: [], resetFromOrganizationId: oldOrganizationId,
        authorizationVersion: Number(fresh.get("authorizationVersion") ?? 1) + 1,
        updatedAt: FieldValue.serverTimestamp(), updatedBy: request.auth!.uid,
      });
    });
  }
  const moved = await db.collection("users").where("organizationId", "==", newOrgRef.id).get();
  for (const user of moved.docs) {
    if (user.id === request.auth.uid || user.get("resetFromOrganizationId") !== oldOrganizationId) continue;
    await adminAuth.updateUser(user.id, { disabled: true });
    await adminAuth.setCustomUserClaims(user.id, {
      organizationId: newOrgRef.id, authorizationVersion: user.get("authorizationVersion"),
    });
    await adminAuth.revokeRefreshTokens(user.id);
    if (typeof user.get("email") === "string") {
      const emailRef = db.doc(`userEmails/${encodeURIComponent(String(user.get("email")))}`);
      const email = await emailRef.get();
      if (email.exists && email.get("uid") === user.id) await emailRef.update({ organizationId: newOrgRef.id });
    }
  }

  await db.runTransaction(async (transaction) => {
    const [job, old, freshNew, actor, bootstrap, oldUsers] = await Promise.all([
      transaction.get(resetRef), transaction.get(oldOrgRef), transaction.get(newOrgRef),
      transaction.get(actorRef), transaction.get(db.doc("system/bootstrap")),
      transaction.get(db.collection("users").where("organizationId", "==", oldOrganizationId)),
    ]);
    if (job.get("status") === "completed") return;
    if (old.get("status") !== "resetting" || freshNew.get("status") !== "preparing" ||
      actor.get("organizationId") !== oldOrganizationId || bootstrap.get("organizationId") !== oldOrganizationId)
      throw new HttpsError("failed-precondition", "Reset state changed. Contact support before retrying.");
    if (oldUsers.docs.some((user) => user.id !== request.auth!.uid))
      throw new HttpsError("failed-precondition", "Some users were added during the reset. Retry with the same confirmation.");
    const now = FieldValue.serverTimestamp();
    transaction.update(oldOrgRef, { status: "archived", archivedAt: now, archivedBy: request.auth!.uid, updatedAt: now });
    transaction.update(newOrgRef, { status: "active", activatedAt: now, updatedAt: now });
    transaction.update(actorRef, {
      organizationId: newOrgRef.id, branchIds: [], warehouseIds: [],
      resetFromOrganizationId: oldOrganizationId, resetOperationId: resetRef.id,
      authorizationVersion: Number(actor.get("authorizationVersion") ?? 1) + 1,
      updatedAt: now, updatedBy: request.auth!.uid,
    });
    transaction.update(db.doc("system/bootstrap"), { organizationId: newOrgRef.id, lastResetAt: now, lastResetBy: request.auth!.uid });
    transaction.update(resetRef, { status: "completed", completedAt: now, updatedAt: now });
    writeAuditLog(transaction, {
      userId: request.auth!.uid, organizationId: newOrgRef.id,
      roleId: "system_administrator", roleIds: ["system_administrator"],
      branchIds: [], warehouseIds: [], authorizationVersion: Number(actor.get("authorizationVersion") ?? 1) + 1,
    }, { action: "organization.reset_completed", entityType: "organization", entityId: newOrgRef.id,
      correlationId: auditId, sourceFunction: "resetOrganizationData", reason: input.reason,
      before: { archivedOrganizationId: oldOrganizationId }, after: { activeOrganizationId: newOrgRef.id } });
  });
  const current = await actorRef.get();
  await adminAuth.setCustomUserClaims(request.auth.uid, {
    organizationId: newOrgRef.id, platformRole: "system_administrator",
    authorizationVersion: current.get("authorizationVersion"),
  });
  return { completed: true, archivedOrganizationId: oldOrganizationId, activeOrganizationId: newOrgRef.id,
    deactivatedUsers: moved.docs.filter((user) => user.id !== request.auth!.uid).length };
});
