import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { adminAuth, db } from "../admin.js";
import type { AccessProfile } from "../auth/authorize.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { bootstrapSecret, bootstrapSecrets, enforceAppCheck } from "../config.js";
import { bootstrapInput } from "../validation/administration.js";
import { correlationId, parseInput } from "../utils/callable.js";

export const bootstrapOrganization = onCall({ enforceAppCheck, secrets: bootstrapSecrets }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication is required.");
  const authentication = request.auth;
  const input = parseInput(bootstrapInput, request.data);
  const emulator = process.env.FUNCTIONS_EMULATOR === "true" || process.env.FIRESTORE_EMULATOR_HOST !== undefined;
  if (!emulator && input.bootstrapSecret !== bootstrapSecret.value()) throw new HttpsError("permission-denied", "Bootstrap authorization failed.");
  const email = typeof authentication.token.email === "string" ? authentication.token.email.toLowerCase() : undefined;
  if (!email) throw new HttpsError("failed-precondition", "The authenticated account must have a verified email address.");
  const organizationRef = db.collection("organizations").doc();
  const profileRef = db.collection("users").doc(authentication.uid);
  const bootstrapRef = db.doc("system/bootstrap");
  const requestId = correlationId();
  const actor: AccessProfile = { userId: authentication.uid, organizationId: organizationRef.id, roleId: "system_administrator", branchIds: [], warehouseIds: [], authorizationVersion: 1 };

  await db.runTransaction(async (transaction) => {
    const [state, organizations, administrators, existingProfile] = await Promise.all([
      transaction.get(bootstrapRef), transaction.get(db.collection("organizations").limit(1)),
      transaction.get(db.collection("users").where("roleId", "==", "system_administrator").limit(1)), transaction.get(profileRef),
    ]);
    if (state.exists || !organizations.empty || !administrators.empty || existingProfile.exists) throw new HttpsError("already-exists", "Organization bootstrap has already been completed.");
    const now = FieldValue.serverTimestamp();
    transaction.create(organizationRef, { ...input.organization, status: "active", createdAt: now, createdBy: authentication.uid, updatedAt: now, updatedBy: authentication.uid });
    transaction.create(profileRef, { uid: authentication.uid, organizationId: organizationRef.id, email, displayName: typeof authentication.token.name === "string" ? authentication.token.name : email.split("@")[0], roleId: "system_administrator", branchIds: [], warehouseIds: [], status: "active", authDisabled: false, authorizationVersion: 1, createdAt: now, createdBy: authentication.uid, updatedAt: now, updatedBy: authentication.uid });
    transaction.create(bootstrapRef, { completed: true, organizationId: organizationRef.id, administratorUid: authentication.uid, completedAt: now, completedBy: authentication.uid, version: 1 });
    writeAuditLog(transaction, actor, { action: "organization.bootstrap", entityType: "organization", entityId: organizationRef.id, correlationId: requestId, sourceFunction: "bootstrapOrganization", after: { code: input.organization.code, administratorUid: authentication.uid } });
  });
  await adminAuth.setCustomUserClaims(authentication.uid, { organizationId: organizationRef.id, platformRole: "system_administrator", authorizationVersion: 1 });
  await db.runTransaction(async (transaction) => writeAuditLog(transaction, actor, { action: "custom_claim.updated", entityType: "user", entityId: authentication.uid, correlationId: requestId, sourceFunction: "bootstrapOrganization", after: { organizationId: organizationRef.id, authorizationVersion: 1 } }));
  logger.info("Organization bootstrap completed", { organizationId: organizationRef.id, administratorUid: authentication.uid, correlationId: requestId });
  return { organizationId: organizationRef.id, administratorUid: authentication.uid, completed: true, authorizationVersion: 1 };
});
