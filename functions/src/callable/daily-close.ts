import { createHash } from "node:crypto";
import { FieldPath, FieldValue, Timestamp, type Transaction } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import { dailyBounds, dailyEvidence, dailyEvidenceMatches, safeMinor } from "../accounting/daily-close.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { accessRoleIds, hasServerPermission, permissionsForServerRole, requireAccess, requirePermission, type AccessProfile } from "../auth/authorize.js";
import { loadCustomRoles } from "../auth/custom-roles.js";
import { enforceAppCheck } from "../config.js";
import { uniquenessDocumentId } from "../inventory/calculations.js";
import { correlationId, parseInput } from "../utils/callable.js";
import { dailyCloseQueryInput, prepareDailyCloseInput, signDailyCloseInput } from "../validation/daily-close.js";

const dailyPermissions = ["daily.close.read", "daily.close.prepare", "daily.close.approve"] as const;
type DailyPermission = typeof dailyPermissions[number];
const organizationRoles = ["system_administrator", "operations_administrator", "finance_officer", "auditor"] as const;

// A global reading role cannot lend its scope to a local manager's write action.
async function organizationPermissions(actor: AccessProfile): Promise<ReadonlySet<DailyPermission>> {
  const direct = actor.directRoleIds ?? (actor.effectivePermissions || actor.customRoleIds?.length ? [] : accessRoleIds(actor));
  const permissions = new Set<DailyPermission>();
  for (const role of organizationRoles) {
    if (direct.includes(role)) for (const permission of dailyPermissions)
      if (permissionsForServerRole(role).includes(permission)) permissions.add(permission);
  }
  if (permissions.size < dailyPermissions.length && actor.customRoleIds?.length) {
    const custom = await loadCustomRoles(actor.organizationId, actor.customRoleIds);
    for (const role of custom) {
      if (role.baseRoleId === "system_administrator" || !(organizationRoles as readonly string[]).includes(role.baseRoleId)) continue;
      for (const permission of dailyPermissions)
        if (permissionsForServerRole(role.baseRoleId).includes(permission) && role.permissionIds.includes(permission)) permissions.add(permission);
    }
  }
  return permissions;
}
function inScope(actor: AccessProfile, global: ReadonlySet<DailyPermission>, branchId: string, permission: DailyPermission) {
  return global.has(permission) || actor.branchIds.includes(branchId);
}
function closeReference(actor: AccessProfile, branchId: string, date: string) {
  return db.doc(`dailyCloses/${uniquenessDocumentId(actor.organizationId, branchId, date)}`);
}
async function checkBranch(transaction: Transaction, actor: AccessProfile, global: ReadonlySet<DailyPermission>, branchId: string, permission: DailyPermission) {
  if (!inScope(actor, global, branchId, permission))
    throw new HttpsError("permission-denied", "This daily-close action is outside your assigned store authority.");
  const branch = await transaction.get(db.doc(`branches/${branchId}`));
  if (!branch.exists || branch.get("organizationId") !== actor.organizationId)
    throw new HttpsError("not-found", "Store not found.");
  return String(branch.get("name") ?? branchId);
}

export const getDailyCloseWorkspace = onCall({ enforceAppCheck, timeoutSeconds: 300 }, async (request) => {
  const actor = await requireAccess(request); requirePermission(actor, "daily.close.read");
  const input = parseInput(dailyCloseQueryInput, request.data);
  const global = await organizationPermissions(actor);
  if (input.action === "locations") {
    let rows: FirebaseFirestore.DocumentSnapshot[], nextCursor: string | null = null;
    if (global.has("daily.close.read")) {
      let query = db.collection("branches").where("organizationId", "==", actor.organizationId).orderBy(FieldPath.documentId());
      if (input.cursor) query = query.startAfter(input.cursor);
      const result = await query.limit(101).get(); rows = result.docs.slice(0, 100);
      if (result.size > 100) nextCursor = rows.at(-1)!.id;
    } else {
      const ids = [...new Set(actor.branchIds)].sort().filter((id) => !input.cursor || id > input.cursor);
      const page = ids.slice(0, 100);
      rows = page.length ? await db.getAll(...page.map((id) => db.doc(`branches/${id}`))) : [];
      if (ids.length > 100) nextCursor = page.at(-1)!;
    }
    return { rows: rows.filter((row) => row.exists && row.get("organizationId") === actor.organizationId && row.get("status") === "active").map((row) => ({ id: row.id, name: String(row.get("name") ?? row.id) })), nextCursor };
  }
  return db.runTransaction(async (transaction) => {
    const branchName = await checkBranch(transaction, actor, global, input.branchId, "daily.close.read");
    const current = await transaction.get(closeReference(actor, input.branchId, input.date));
    const evidence = await dailyEvidence(transaction, actor.organizationId, input.branchId, input.date);
    return { branchId: input.branchId, date: input.date, branchName, evidence,
      canPrepare: hasServerPermission(actor, "daily.close.prepare") && inScope(actor, global, input.branchId, "daily.close.prepare"),
      canSign: hasServerPermission(actor, "daily.close.approve") && inScope(actor, global, input.branchId, "daily.close.approve"),
      evidenceChanged: current.exists && !dailyEvidenceMatches(current.get("validatedEvidence") ?? current.get("evidence"), evidence), close: current.exists ? { id: current.id, ...current.data() } : null };
  }, { readOnly: true });
});

export const prepareDailyClose = onCall({ enforceAppCheck, timeoutSeconds: 300 }, async (request) => {
  const actor = await requireAccess(request); requirePermission(actor, "daily.close.prepare");
  const input = parseInput(prepareDailyCloseInput, request.data);
  const global = await organizationPermissions(actor);
  if (dailyBounds(input.date).start.toMillis() > Date.now())
    throw new HttpsError("failed-precondition", "A future business day cannot be closed.");
  const reference = closeReference(actor, input.branchId, input.date);
  const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const operation = db.doc(`idempotencyKeys/${uniquenessDocumentId(actor.organizationId, actor.userId, "prepareDailyClose", input.idempotencyKey)}`);
  return db.runTransaction(async (transaction) => {
    const branchName = await checkBranch(transaction, actor, global, input.branchId, "daily.close.prepare");
    const [previous, current] = await transaction.getAll(operation, reference);
    if (previous!.exists) {
      if (previous!.get("requestHash") !== requestHash) throw new HttpsError("failed-precondition", "This retry reference was already used for different close details.");
      return { dailyCloseId: String(previous!.get("entityId")), version: previous!.get("version"), prepared: true };
    }
    const evidence = await dailyEvidence(transaction, actor.organizationId, input.branchId, input.date);
    if (current!.get("status") === "signed" && dailyEvidenceMatches(current!.get("validatedEvidence") ?? current!.get("evidence"), evidence))
      throw new HttpsError("failed-precondition", "This daily close is already signed with the same evidence.");
    if (current!.get("status") === "signed" && input.explanation.length < 5)
      throw new HttpsError("invalid-argument", "Explain why a new revision is needed after sign-off. The previous signed evidence will be retained.");
    if (evidence.hash !== input.evidenceHash) throw new HttpsError("failed-precondition", "The day's evidence changed. Refresh, check the figures and prepare again.");
    const varianceMinor = safeMinor(input.countedCashMinor - evidence.cash.closingMinor);
    if ((varianceMinor !== 0 || evidence.exceptions.length > 0) && input.explanation.length < 5)
      throw new HttpsError("invalid-argument", "Explain cash variances and outstanding checks before preparing this close.");
    const version = Number(current!.get("version") ?? 0) + 1;
    const record = { organizationId: actor.organizationId, branchId: input.branchId, branchName, date: input.date, status: "prepared", version,
      evidence, countedCashMinor: input.countedCashMinor, varianceMinor, explanation: input.explanation,
      preparedBy: actor.userId, preparedAt: FieldValue.serverTimestamp() };
    transaction.set(reference, record);
    // Every revision is retained, even before sign-off.
    transaction.create(reference.collection("revisions").doc(String(version)), record);
    transaction.create(operation, { organizationId: actor.organizationId, entityId: reference.id, version, requestHash, createdAt: FieldValue.serverTimestamp() });
    writeAuditLog(transaction, actor, { action: "daily_close.prepared", entityType: "dailyClose", entityId: reference.id, correlationId: correlationId(), sourceFunction: "prepareDailyClose", reason: input.explanation, after: { branchId: input.branchId, date: input.date, version, varianceMinor, evidenceHash: evidence.hash } });
    return { dailyCloseId: reference.id, version, prepared: true };
  });
});

export const signDailyClose = onCall({ enforceAppCheck, timeoutSeconds: 300 }, async (request) => {
  const actor = await requireAccess(request); requirePermission(actor, "daily.close.approve");
  const input = parseInput(signDailyCloseInput, request.data);
  const global = await organizationPermissions(actor);
  const reference = closeReference(actor, input.branchId, input.date);
  const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const operation = db.doc(`idempotencyKeys/${uniquenessDocumentId(actor.organizationId, actor.userId, "signDailyClose", input.idempotencyKey)}`);
  return db.runTransaction(async (transaction) => {
    await checkBranch(transaction, actor, global, input.branchId, "daily.close.approve");
    const [previous, current] = await transaction.getAll(operation, reference);
    if (previous!.exists) {
      if (previous!.get("requestHash") !== requestHash) throw new HttpsError("failed-precondition", "This retry reference was already used for a different sign-off.");
      return { dailyCloseId: String(previous!.get("entityId")), signed: true };
    }
    if (!current!.exists || current!.get("status") !== "prepared" || current!.get("version") !== input.version)
      throw new HttpsError("failed-precondition", "Refresh and select the current prepared daily close.");
    const evidence = await dailyEvidence(transaction, actor.organizationId, input.branchId, input.date);
    if (!dailyEvidenceMatches(current!.get("validatedEvidence") ?? current!.get("evidence"), evidence))
      throw new HttpsError("failed-precondition", "The ledger or stock/shift evidence changed. Prepare a new revision before sign-off.");
    const signedAt = Timestamp.now();
    // Sign the evidence that was prepared; retain legacy hashes/signatures unchanged.
    const preparedHash = String(current!.get("evidence.hash"));
    transaction.update(reference, { status: "signed", signedBy: actor.userId, signedAt, signOffNotes: input.notes,
      validatedEvidence: { hash: evidence.hash, hashVersion: evidence.hashVersion } });
    transaction.create(reference.collection("signOffs").doc(String(input.version)), { organizationId: actor.organizationId, version: input.version, evidenceHash: preparedHash, validatedEvidenceHash: evidence.hash, validatedHashVersion: evidence.hashVersion, signedBy: actor.userId, signedAt, notes: input.notes });
    transaction.create(operation, { organizationId: actor.organizationId, entityId: reference.id, requestHash, createdAt: signedAt });
    writeAuditLog(transaction, actor, { action: "daily_close.signed", entityType: "dailyClose", entityId: reference.id, correlationId: correlationId(), sourceFunction: "signDailyClose", reason: input.notes, after: { branchId: input.branchId, date: input.date, version: input.version, selfSigned: current!.get("preparedBy") === actor.userId, evidenceHash: preparedHash, validatedEvidenceHash: evidence.hash } });
    return { dailyCloseId: reference.id, signed: true };
  });
});
