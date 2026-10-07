import { createHash } from "node:crypto";
import { FieldPath, FieldValue, Timestamp, type Transaction } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import { dailyBounds, dailyEvidence, safeMinor } from "../accounting/daily-close.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { hasRole, requireAccess, requireBranchScope, requirePermission, type AccessProfile } from "../auth/authorize.js";
import { enforceAppCheck } from "../config.js";
import { uniquenessDocumentId } from "../inventory/calculations.js";
import { correlationId, parseInput } from "../utils/callable.js";
import { dailyCloseQueryInput, prepareDailyCloseInput, signDailyCloseInput } from "../validation/daily-close.js";

function closeReference(actor: AccessProfile, branchId: string, date: string) {
  return db.doc(`dailyCloses/${uniquenessDocumentId(actor.organizationId, branchId, date)}`);
}
async function checkBranch(transaction: Transaction, actor: AccessProfile, branchId: string) {
  requireBranchScope(actor, branchId);
  const branch = await transaction.get(db.doc(`branches/${branchId}`));
  if (!branch.exists || branch.get("organizationId") !== actor.organizationId)
    throw new HttpsError("not-found", "Store not found.");
  return String(branch.get("name") ?? branchId);
}

export const getDailyCloseWorkspace = onCall({ enforceAppCheck, timeoutSeconds: 300 }, async (request) => {
  const actor = await requireAccess(request); requirePermission(actor, "daily.close.read");
  const input = parseInput(dailyCloseQueryInput, request.data);
  if (input.action === "locations") {
    const organizationWide = (["system_administrator", "operations_administrator", "finance_officer", "auditor"] as const).some((role) => hasRole(actor, role));
    let rows: FirebaseFirestore.DocumentSnapshot[], nextCursor: string | null = null;
    if (organizationWide) {
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
    const branchName = await checkBranch(transaction, actor, input.branchId);
    const current = await transaction.get(closeReference(actor, input.branchId, input.date));
    const evidence = await dailyEvidence(transaction, actor.organizationId, input.branchId, input.date);
    return { branchId: input.branchId, date: input.date, branchName, evidence, close: current.exists ? { id: current.id, ...current.data() } : null };
  }, { readOnly: true });
});

export const prepareDailyClose = onCall({ enforceAppCheck, timeoutSeconds: 300 }, async (request) => {
  const actor = await requireAccess(request); requirePermission(actor, "daily.close.prepare");
  const input = parseInput(prepareDailyCloseInput, request.data);
  if (dailyBounds(input.date).start.toMillis() > Date.now())
    throw new HttpsError("failed-precondition", "A future business day cannot be closed.");
  const reference = closeReference(actor, input.branchId, input.date);
  const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const operation = db.doc(`idempotencyKeys/${uniquenessDocumentId(actor.organizationId, actor.userId, "prepareDailyClose", input.idempotencyKey)}`);
  return db.runTransaction(async (transaction) => {
    const branchName = await checkBranch(transaction, actor, input.branchId);
    const [previous, current] = await transaction.getAll(operation, reference);
    if (previous!.exists) {
      if (previous!.get("requestHash") !== requestHash) throw new HttpsError("failed-precondition", "This retry reference was already used for different close details.");
      return { dailyCloseId: String(previous!.get("entityId")), version: previous!.get("version"), prepared: true };
    }
    const evidence = await dailyEvidence(transaction, actor.organizationId, input.branchId, input.date);
    if (current!.get("status") === "signed" && current!.get("evidence.hash") === evidence.hash)
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
  const reference = closeReference(actor, input.branchId, input.date);
  const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const operation = db.doc(`idempotencyKeys/${uniquenessDocumentId(actor.organizationId, actor.userId, "signDailyClose", input.idempotencyKey)}`);
  return db.runTransaction(async (transaction) => {
    await checkBranch(transaction, actor, input.branchId);
    const [previous, current] = await transaction.getAll(operation, reference);
    if (previous!.exists) {
      if (previous!.get("requestHash") !== requestHash) throw new HttpsError("failed-precondition", "This retry reference was already used for a different sign-off.");
      return { dailyCloseId: String(previous!.get("entityId")), signed: true };
    }
    if (!current!.exists || current!.get("status") !== "prepared" || current!.get("version") !== input.version)
      throw new HttpsError("failed-precondition", "Refresh and select the current prepared daily close.");
    const evidence = await dailyEvidence(transaction, actor.organizationId, input.branchId, input.date);
    if (evidence.hash !== current!.get("evidence.hash"))
      throw new HttpsError("failed-precondition", "The ledger or stock/shift evidence changed. Prepare a new revision before sign-off.");
    const signedAt = Timestamp.now();
    transaction.update(reference, { status: "signed", signedBy: actor.userId, signedAt, signOffNotes: input.notes });
    transaction.create(reference.collection("signOffs").doc(String(input.version)), { organizationId: actor.organizationId, version: input.version, evidenceHash: evidence.hash, signedBy: actor.userId, signedAt, notes: input.notes });
    transaction.create(operation, { organizationId: actor.organizationId, entityId: reference.id, requestHash, createdAt: signedAt });
    writeAuditLog(transaction, actor, { action: "daily_close.signed", entityType: "dailyClose", entityId: reference.id, correlationId: correlationId(), sourceFunction: "signDailyClose", reason: input.notes, after: { branchId: input.branchId, date: input.date, version: input.version, selfSigned: current!.get("preparedBy") === actor.userId, evidenceHash: evidence.hash } });
    return { dailyCloseId: reference.id, signed: true };
  });
});
