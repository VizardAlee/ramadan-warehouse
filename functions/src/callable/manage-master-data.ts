import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { adminAuth, db } from "../admin.js";
import { hasRole, normalizeRoleIds, requireAccess, requirePermission, type Permission } from "../auth/authorize.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { enforceAppCheck } from "../config.js";
import { branchInput, locationInput, updateOrganizationInput, warehouseInput } from "../validation/administration.js";
import { correlationId, parseInput } from "../utils/callable.js";

type MasterKind = "branch" | "warehouse" | "inventoryLocation";
const configuration = {
  branch: { collection: "branches", permission: "branch.manage" as Permission },
  warehouse: { collection: "warehouses", permission: "warehouse.manage" as Permission },
  inventoryLocation: { collection: "inventoryLocations", permission: "location.manage" as Permission },
};

function managerIds(kind: MasterKind, values: Record<string, unknown>) {
  if (kind === "branch")
    return typeof values.managerUserId === "string"
      ? [values.managerUserId]
      : [];
  if (kind === "warehouse")
    return Array.isArray(values.managerIds)
      ? values.managerIds.filter(
          (managerId): managerId is string => typeof managerId === "string",
        )
      : [];
  return [];
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

async function refreshManagerClaims(userIds: readonly string[]) {
  await Promise.all(
    userIds.map(async (userId) => {
      const [profile, authUser] = await Promise.all([
        db.collection("users").doc(userId).get(),
        adminAuth.getUser(userId),
      ]);
      if (!profile.exists) return;
      await adminAuth.setCustomUserClaims(userId, {
        ...authUser.customClaims,
        organizationId: profile.get("organizationId"),
        authorizationVersion: profile.get("authorizationVersion"),
      });
    }),
  );
}

async function validateManagerAssignments(kind: MasterKind, input: Record<string, unknown>, organizationId: string) {
  const ids = kind === "branch" && typeof input.managerUserId === "string" ? [input.managerUserId] : kind === "warehouse" && Array.isArray(input.managerIds) ? input.managerIds as string[] : [];
  if (ids.length === 0) return;
  const profiles = await db.getAll(...ids.map((id) => db.collection("users").doc(id)));
  const expectedRole = kind === "branch" ? "branch_manager" : "warehouse_manager";
  if (profiles.some((profile) => !profile.exists || profile.get("organizationId") !== organizationId || profile.get("status") !== "active" || !normalizeRoleIds(profile.get("roleIds"), profile.get("roleId")).includes(expectedRole))) throw new HttpsError("failed-precondition", `Managers must be active ${expectedRole.replaceAll("_", " ")} users in this organization.`);
}

async function validateLocationOwner(kind: MasterKind, input: Record<string, unknown>, organizationId: string) {
  if (kind !== "inventoryLocation") return;
  const owner = typeof input.branchId === "string" ? { collection: "branches", id: input.branchId } : typeof input.warehouseId === "string" ? { collection: "warehouses", id: input.warehouseId } : undefined;
  if (!owner) return;
  const snapshot = await db.collection(owner.collection).doc(owner.id).get();
  if (!snapshot.exists || snapshot.get("organizationId") !== organizationId) throw new HttpsError("failed-precondition", "The related branch or warehouse is not in this organization.");
}

async function saveMaster(kind: MasterKind, input: Record<string, unknown>, actor: Awaited<ReturnType<typeof requireAccess>>) {
  const config = configuration[kind]; requirePermission(actor, config.permission);
  const operation = db.collection("idempotencyKeys").doc(`${actor.organizationId}_save${kind}_${String(input.idempotencyKey)}`);
  const prior = await operation.get();
  if (prior.exists && prior.get("status") === "completed") {
    await refreshManagerClaims(stringArray(prior.get("authorizationUserIds")));
    return { id: prior.get("entityId") as string, saved: false };
  }
  await Promise.all([validateManagerAssignments(kind, input, actor.organizationId), validateLocationOwner(kind, input, actor.organizationId)]);
  const id = typeof input.id === "string" ? input.id : db.collection(config.collection).doc().id;
  const reference = db.collection(config.collection).doc(id); const code = String(input.code); const codeReference = db.collection("organizationCodes").doc(`${actor.organizationId}_${kind}_${code}`);
  const requestId = correlationId();
  let resultId = id; let saved = true;
  let authorizationUserIds: string[] = [];
  await db.runTransaction(async (transaction) => {
    const [current, codeOwner, previousOperation] = await Promise.all([transaction.get(reference), transaction.get(codeReference), transaction.get(operation)]);
    if (previousOperation.exists) {
      resultId = previousOperation.get("entityId") as string;
      authorizationUserIds = stringArray(
        previousOperation.get("authorizationUserIds"),
      );
      saved = false;
      return;
    }
    const previousManagerIds = current.exists
      ? managerIds(kind, current.data() as Record<string, unknown>)
      : [];
    const nextManagerIds = managerIds(kind, input);
    const affectedManagerIds = [
      ...new Set([...previousManagerIds, ...nextManagerIds]),
    ];
    const managerProfiles = affectedManagerIds.length
      ? await transaction.getAll(
          ...affectedManagerIds.map((userId) =>
            db.collection("users").doc(userId),
          ),
        )
      : [];
    const expectedRole = kind === "branch" ? "branch_manager" : "warehouse_manager";
    if (
      managerProfiles.some(
        (profile) =>
          nextManagerIds.includes(profile.id) &&
          (!profile.exists ||
            profile.get("organizationId") !== actor.organizationId ||
            profile.get("status") !== "active" ||
            !normalizeRoleIds(
              profile.get("roleIds"),
              profile.get("roleId"),
            ).includes(expectedRole)),
      )
    )
      throw new HttpsError(
        "failed-precondition",
        `Managers must be active ${expectedRole.replaceAll("_", " ")} users in this organization.`,
      );
    if (codeOwner.exists && codeOwner.get("entityId") !== id) throw new HttpsError("already-exists", `${kind} code is already in use.`);
    if (current.exists && current.get("organizationId") !== actor.organizationId) throw new HttpsError("permission-denied", "Cross-organization updates are not permitted.");
    if (current.exists && current.get("systemManaged") === true && !hasRole(actor, "system_administrator")) throw new HttpsError("permission-denied", "This system-managed location cannot be edited.");
    const now = FieldValue.serverTimestamp();
    const values: Record<string, unknown> = Object.fromEntries(
      Object.entries(input).filter(
        ([key, value]) => key !== "idempotencyKey" && key !== "id" && value !== undefined,
      ),
    );
    Object.assign(values, { organizationId: actor.organizationId, updatedAt: now, updatedBy: actor.userId });
    if (current.exists) transaction.update(reference, values); else transaction.create(reference, { ...values, createdAt: now, createdBy: actor.userId });
    const assignmentField = kind === "branch" ? "branchIds" : "warehouseIds";
    authorizationUserIds = [];
    for (const profile of managerProfiles) {
      if (!profile.exists) continue;
      const beforeAssignments = stringArray(profile.get(assignmentField));
      const afterAssignments = nextManagerIds.includes(profile.id)
        ? [...new Set([...beforeAssignments, id])]
        : beforeAssignments.filter((assignmentId) => assignmentId !== id);
      if (JSON.stringify(afterAssignments) === JSON.stringify(beforeAssignments))
        continue;
      const authorizationVersion =
        Number(profile.get("authorizationVersion") ?? 1) + 1;
      transaction.update(profile.ref, {
        [assignmentField]: afterAssignments,
        authorizationVersion,
        updatedAt: now,
        updatedBy: actor.userId,
      });
      authorizationUserIds.push(profile.id);
      writeAuditLog(transaction, actor, {
        action: `user.${kind === "branch" ? "branch" : "warehouse"}_assignments_changed`,
        entityType: "user",
        entityId: profile.id,
        correlationId: requestId,
        sourceFunction: "saveAdministrativeMaster",
        before: { [assignmentField]: beforeAssignments },
        after: { [assignmentField]: afterAssignments },
      });
    }
    const previousCode = current.exists ? String(current.get("code")) : undefined;
    if (previousCode && previousCode !== code) transaction.delete(db.collection("organizationCodes").doc(`${actor.organizationId}_${kind}_${previousCode}`));
    transaction.set(codeReference, { organizationId: actor.organizationId, kind, code, entityId: id, updatedAt: now });
    transaction.create(operation, { organizationId: actor.organizationId, action: `save${kind}`, entityId: id, status: "completed", authorizationUserIds, createdAt: now, createdBy: actor.userId });
    writeAuditLog(transaction, actor, { action: `${kind}.${current.exists ? "updated" : "created"}`, entityType: kind, entityId: id, correlationId: requestId, sourceFunction: "saveAdministrativeMaster", before: current.exists ? { code: current.get("code"), status: current.get("status") } : undefined, after: { code, status: input.status } });
  });
  await refreshManagerClaims(authorizationUserIds);
  if (saved) logger.info("Administrative master saved", { organizationId: actor.organizationId, actorUserId: actor.userId, kind, entityId: resultId, correlationId: requestId });
  return { id: resultId, saved };
}

export const saveBranch = onCall({ enforceAppCheck }, async (request) => saveMaster("branch", parseInput(branchInput, request.data), await requireAccess(request)));
export const saveWarehouse = onCall({ enforceAppCheck }, async (request) => saveMaster("warehouse", parseInput(warehouseInput, request.data), await requireAccess(request)));
export const saveInventoryLocation = onCall({ enforceAppCheck }, async (request) => saveMaster("inventoryLocation", parseInput(locationInput, request.data), await requireAccess(request)));

export const updateOrganization = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request); requirePermission(actor, "organization.manage"); const input = parseInput(updateOrganizationInput, request.data);
  const reference = db.collection("organizations").doc(actor.organizationId); const requestId = correlationId();
  await db.runTransaction(async (transaction) => {
    const current = await transaction.get(reference); if (!current.exists) throw new HttpsError("not-found", "Organization not found.");
    const changes: Record<string, unknown> = { ...input, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.userId }; delete changes.reason;
    transaction.update(reference, changes); writeAuditLog(transaction, actor, { action: "organization.updated", entityType: "organization", entityId: actor.organizationId, correlationId: requestId, sourceFunction: "updateOrganization", reason: input.reason, before: { legalName: current.get("legalName"), status: current.get("status") }, after: changes });
  });
  return { organizationId: actor.organizationId, updated: true };
});
