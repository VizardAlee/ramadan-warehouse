import { createHash } from "node:crypto";
import { FieldValue, type DocumentSnapshot } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { db } from "../admin.js";
import { requireBranchScope, requireWarehouseScope, requirePermission, type AccessProfile } from "../auth/authorize.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { normalizeInventoryIdentifier, uniquenessDocumentId } from "../inventory/calculations.js";
import { correlationId } from "../utils/callable.js";
import { decodeCollectionPhoto, MAX_COLLECTION_PHOTO_BYTES } from "./collection-evidence.js";

const id = z.string().trim().min(1).max(200).refine(value => !value.includes("/"));
export const operationalEvidenceInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list_evidence"), recordId: id }),
  z.object({ action: z.literal("read_evidence"), recordId: id, evidenceId: id }),
  z.object({ action: z.literal("upload_evidence"), recordId: id, stage: z.enum(["intake", "diagnosis", "handover"]),
    serialNumber: z.string().trim().max(160).optional(), note: z.string().trim().min(3).max(500),
    contentType: z.enum(["image/jpeg", "image/png"]), base64: z.string().min(32).max(2796204), idempotencyKey: z.string().uuid() }),
]);
type Kind = "supplier_return" | "aftersales";
type Input = z.infer<typeof operationalEvidenceInput>;

function scope(actor: AccessProfile, parent: DocumentSnapshot, kind: Kind) {
  requirePermission(actor, kind === "aftersales" ? "sales.returns.read" : "procurement.read");
  if (kind === "supplier_return") requirePermission(actor, "payables.read");
  if (!parent.exists || parent.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Evidence record not found.");
  if (parent.get("branchId")) requireBranchScope(actor, String(parent.get("branchId")));
  else if (kind === "supplier_return" && parent.get("warehouseId")) requireWarehouseScope(actor, String(parent.get("warehouseId")));
  else throw new HttpsError("failed-precondition", "The record has no operating location.");
}

function uploadScope(actor: AccessProfile, parent: DocumentSnapshot, kind: Kind, input: Extract<Input, { action: "upload_evidence" }>) {
  scope(actor, parent, kind);
  if (kind === "supplier_return") {
    requirePermission(actor, "procurement.receive"); requirePermission(actor, "payables.approve");
    if (parent.get("status") !== "posted" || input.stage !== "handover") throw new HttpsError("failed-precondition", "Attach handover evidence to a posted supplier return.");
  } else {
    requirePermission(actor, input.stage === "intake" ? "sales.returns.create" : "sales.returns.approve");
    const allowed = { intake: ["open"], diagnosis: ["diagnosed", "in_service"], handover: ["awaiting_collection", "completed"] };
    if (!allowed[input.stage].includes(String(parent.get("status")))) throw new HttpsError("failed-precondition", "Choose the evidence stage matching this service case's current status.");
  }
  const expected = (kind === "supplier_return" ? parent.get("serialNumbers") ?? [] : [parent.get("serialNumber")].filter(Boolean)) as string[];
  const serial = normalizeInventoryIdentifier(input.serialNumber ?? "");
  if (expected.length ? !expected.map(normalizeInventoryIdentifier).includes(serial) : Boolean(serial))
    throw new HttpsError("invalid-argument", "Select the exact serial recorded on this return or service case. Do not attach another unit's photo.");
  return serial || null;
}

/** Append-only evidence on existing operational records; never posts stock, cash or journals. */
async function handleOperationalEvidence(actor: AccessProfile, kind: Kind, input: Input) {
  const parentRef = db.doc(`${kind === "aftersales" ? "aftersalesCases" : "supplierReturns"}/${input.recordId}`);
  const parent = await parentRef.get(); scope(actor, parent, kind);
  const ids = (parent.get("evidenceIds") ?? []) as string[];
  if (input.action === "list_evidence") {
    if (ids.length > 20) throw new HttpsError("failed-precondition", "Evidence register needs review.");
    const records = ids.length ? await db.getAll(...ids.map(value => parentRef.collection("evidence").doc(value))) : [];
    return { evidence: records.filter(record => record.exists).map(record => ({ evidenceId: record.id, stage: record.get("stage"), serialNumber: record.get("serialNumber"), note: record.get("note"), uploadedBy: record.get("uploadedBy"), uploadedAt: record.get("uploadedAt")?.toDate().toISOString() ?? null, recordedStatus: record.get("recordedStatus") })) };
  }
  if (input.action === "read_evidence") {
    const record = await parentRef.collection("evidence").doc(input.evidenceId).get();
    if (!ids.includes(input.evidenceId) || !record.exists || record.get("organizationId") !== actor.organizationId || record.get("recordId") !== parent.id)
      throw new HttpsError("not-found", "Recorded photo not found.");
    const [bytes] = await getStorage().bucket().file(String(record.get("path")), { generation: String(record.get("generation")) }).download();
    if (bytes.length > MAX_COLLECTION_PHOTO_BYTES || createHash("sha256").update(bytes).digest("hex") !== record.get("sha256")) throw new HttpsError("data-loss", "Photo integrity check failed.");
    return { contentType: record.get("contentType"), base64: bytes.toString("base64") };
  }
  const photo = decodeCollectionPhoto(input.base64, input.contentType);
  const serialNumber = normalizeInventoryIdentifier(input.serialNumber ?? "") || null;
  const fingerprint = createHash("sha256").update(JSON.stringify([kind, input.recordId, input.stage, serialNumber, input.note, input.contentType, photo.sha256])).digest("hex");
  const evidenceId = uniquenessDocumentId(actor.organizationId, actor.userId, kind, input.idempotencyKey);
  const reference = parentRef.collection("evidence").doc(evidenceId);
  const previous = await reference.get();
  // A successful but unacknowledged upload remains retryable after a status transition.
  if (previous.exists) {
    requirePermission(actor, kind === "supplier_return" ? "procurement.receive" : input.stage === "intake" ? "sales.returns.create" : "sales.returns.approve");
    if (kind === "supplier_return") requirePermission(actor, "payables.approve");
    if (previous.get("fingerprint") !== fingerprint || !ids.includes(evidenceId)) throw new HttpsError("invalid-argument", "Retry the original photo without changes.");
    return { evidenceId, uploaded: false };
  }
  uploadScope(actor, parent, kind, input);
  if (ids.length >= 20) throw new HttpsError("failed-precondition", "This record already has 20 photos.");
  const path = `operational-evidence/${actor.organizationId}/${kind}/${parent.id}/${evidenceId}.${input.contentType === "image/png" ? "png" : "jpg"}`;
  const file = getStorage().bucket().file(path);
  try { await file.save(photo.bytes, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: input.contentType, cacheControl: "private, no-store", metadata: { fingerprint } } }); }
  catch (cause) { if (Number((cause as { code?: unknown }).code) !== 412) throw cause; }
  const [metadata] = await file.getMetadata();
  if (metadata.metadata?.fingerprint !== fingerprint || Number(metadata.size) !== photo.bytes.length) throw new HttpsError("failed-precondition", "Photo upload reference is inconsistent.");
  let uploaded = false;
  await db.runTransaction(async transaction => {
    const [currentParent, currentPhoto] = await transaction.getAll(parentRef, reference);
    scope(actor, currentParent!, kind);
    const currentIds = currentParent!.get("evidenceIds") ?? [];
    if (currentPhoto!.exists) {
      if (currentPhoto!.get("fingerprint") !== fingerprint || !currentIds.includes(evidenceId)) throw new HttpsError("invalid-argument", "Retry the original photo without changes.");
      return;
    }
    uploadScope(actor, currentParent!, kind, input);
    if (currentIds.length >= 20) throw new HttpsError("failed-precondition", "This record already has 20 photos.");
    const now = FieldValue.serverTimestamp();
    transaction.create(reference, { organizationId: actor.organizationId, recordId: parent.id, kind, productId: currentParent!.get("productId") ?? null, serialNumber, stage: input.stage, note: input.note, recordedStatus: currentParent!.get("status"), uploadedBy: actor.userId, uploadedAt: now, path, generation: String(metadata.generation), contentType: input.contentType, byteSize: photo.bytes.length, sha256: photo.sha256, width: photo.width, height: photo.height, fingerprint });
    transaction.update(parentRef, { evidenceIds: FieldValue.arrayUnion(evidenceId) });
    writeAuditLog(transaction, actor, { action: `${kind}.photo_recorded`, entityType: kind === "aftersales" ? "aftersalesCase" : "supplierReturn", entityId: parent.id, sourceFunction: kind === "aftersales" ? "getAftersalesWorkspace" : "getProcurementWorkspace", correlationId: correlationId(), reason: input.note, after: { evidenceId, serialNumber, stage: input.stage, recordedStatus: currentParent!.get("status"), sha256: photo.sha256 } });
    uploaded = true;
  });
  return { evidenceId, uploaded };
}

export async function operationalEvidence(actor: AccessProfile, kind: Kind, input: Input) {
  try { return await handleOperationalEvidence(actor, kind, input); }
  catch (cause) {
    if (cause instanceof HttpsError && ["invalid-argument", "failed-precondition"].includes(cause.code))
      throw new HttpsError(cause.code, cause.message, { code: "OPERATIONAL_EVIDENCE_ACTION_REQUIRED", userMessage: cause.message });
    throw cause;
  }
}
