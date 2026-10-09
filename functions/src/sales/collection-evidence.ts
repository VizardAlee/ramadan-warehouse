import { createHash } from "node:crypto";
import { FieldValue, type DocumentSnapshot } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { db } from "../admin.js";
import { requireBranchScope, requirePermission, type AccessProfile } from "../auth/authorize.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { uniquenessDocumentId } from "../inventory/calculations.js";
import { correlationId } from "../utils/callable.js";

const id = z.string().trim().min(1).max(200).refine(value => !value.includes("/"));
export const uploadCollectionPhotoInput = z.object({
  action: z.literal("upload_collection_photo"), saleId: id, saleItemId: id,
  contentType: z.enum(["image/jpeg", "image/png"]), base64: z.string().min(32).max(2796204),
  idempotencyKey: z.string().uuid(),
});
export const readCollectionPhotoInput = z.object({ action: z.literal("collection_photo"), saleId: id, evidenceId: id });
export const MAX_COLLECTION_PHOTO_BYTES = 2 * 1024 * 1024;

/** Bound both encoded size and image dimensions; never accept SVG/HTML or external URLs. */
export function decodeCollectionPhoto(base64: string, contentType: "image/jpeg" | "image/png") {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new HttpsError("invalid-argument", "Choose a JPEG or PNG photo.");
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length || bytes.length > MAX_COLLECTION_PHOTO_BYTES || bytes.toString("base64") !== base64)
    throw new HttpsError("invalid-argument", "Photo must be no larger than 2 MB.");
  let width = 0, height = 0;
  if (contentType === "image/png" && bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.readUInt32BE(8) === 13 && bytes.toString("ascii", 12, 16) === "IHDR" && bytes.toString("ascii", bytes.length - 8, bytes.length - 4) === "IEND") {
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
  } else if (contentType === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217) {
    for (let offset = 2; offset + 4 < bytes.length;) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++]!;
      if (marker === 218 || marker === 217) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 8) {
        height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5); break;
      }
      offset += length;
    }
  }
  if (!width || !height || width > 8192 || height > 8192 || width * height > 20_000_000)
    throw new HttpsError("invalid-argument", "Choose a valid JPEG or PNG photo of at most 20 megapixels (8192 pixels per side).");
  return { bytes, width, height, sha256: createHash("sha256").update(bytes).digest("hex") };
}

function assertUploadScope(actor: AccessProfile, sale: DocumentSnapshot, item: DocumentSnapshot) {
  if (!sale.exists || sale.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Sale not found.");
  requireBranchScope(actor, String(sale.get("branchId")));
  if (sale.get("status") !== "completed" || sale.get("collectionTracked") !== true || !["awaiting_collection", "partially_collected"].includes(sale.get("collectionStatus")))
    throw new HttpsError("failed-precondition", "Select goods still awaiting collection.");
  if (!item.exists || item.get("organizationId") !== actor.organizationId || item.get("saleId") !== sale.id || Number(item.get("quantity")) <= Number(item.get("collectedQuantity") ?? 0) + Number(item.get("cancelledQuantity") ?? 0))
    throw new HttpsError("failed-precondition", "This product is not awaiting collection on this invoice.");
}

export async function uploadCollectionPhoto(actor: AccessProfile, input: z.infer<typeof uploadCollectionPhotoInput>) {
  requirePermission(actor, "sales.stock.release");
  const saleRef = db.doc(`sales/${input.saleId}`), itemRef = db.doc(`saleItems/${input.saleItemId}`);
  const [sale, item] = await db.getAll(saleRef, itemRef);
  // Check access even on a retry; never return another store's evidence reference.
  if (!sale!.exists || sale!.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Sale not found.");
  requireBranchScope(actor, String(sale!.get("branchId")));
  const photo = decodeCollectionPhoto(input.base64, input.contentType);
  const fingerprint = createHash("sha256").update(JSON.stringify([input.saleId, input.saleItemId, input.contentType, photo.sha256])).digest("hex");
  const evidenceId = uniquenessDocumentId(actor.organizationId, actor.userId, "collectionPhoto", input.idempotencyKey);
  const reference = db.doc(`saleCollectionEvidence/${evidenceId}`);
  const previous = await reference.get();
  if (previous.exists) {
    if (previous.get("fingerprint") !== fingerprint) throw new HttpsError("invalid-argument", "Retry the same photo and product without changes.");
    return { evidenceId, saleItemId: input.saleItemId, uploaded: false };
  }
  assertUploadScope(actor, sale!, item!);
  const path = `collection-evidence/${actor.organizationId}/${input.saleId}/${evidenceId}.${input.contentType === "image/png" ? "png" : "jpg"}`;
  const file = getStorage().bucket().file(path);
  try {
    await file.save(photo.bytes, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: input.contentType, cacheControl: "private, no-store", metadata: { fingerprint } } });
  } catch (cause) {
    if (Number((cause as { code?: unknown }).code) !== 412) throw cause;
    // A previous interrupted upload may have saved the immutable object already.
  }
  const [metadata] = await file.getMetadata();
  if (metadata.metadata?.fingerprint !== fingerprint || Number(metadata.size) !== photo.bytes.length)
    throw new HttpsError("failed-precondition", "The uploaded photo reference is inconsistent. Choose a new upload reference.");
  await db.runTransaction(async transaction => {
    const [current, currentSale, currentItem] = await transaction.getAll(reference, saleRef, itemRef);
    if (current!.exists) {
      if (current!.get("fingerprint") !== fingerprint) throw new HttpsError("invalid-argument", "Retry the same photo without changes.");
      return;
    }
    assertUploadScope(actor, currentSale!, currentItem!);
    transaction.create(reference, { organizationId: actor.organizationId, branchId: currentSale!.get("branchId"), saleId: input.saleId, saleItemId: input.saleItemId, productId: currentItem!.get("productId"), uploadedBy: actor.userId, uploadedAt: FieldValue.serverTimestamp(), status: "uploaded", path, generation: String(metadata.generation), contentType: input.contentType, byteSize: photo.bytes.length, width: photo.width, height: photo.height, sha256: photo.sha256, fingerprint });
    writeAuditLog(transaction, actor, { action: "sale.collection_photo_uploaded", entityType: "saleCollectionEvidence", entityId: evidenceId, sourceFunction: "confirmPosSaleOrder", correlationId: correlationId(), after: { saleId: input.saleId, saleItemId: input.saleItemId, sha256: photo.sha256, byteSize: photo.bytes.length } });
  });
  return { evidenceId, saleItemId: input.saleItemId, uploaded: true };
}

/** No public download tokens or long-lived signed URLs; access is checked per read. */
export async function readCollectionPhoto(actor: AccessProfile, input: z.infer<typeof readCollectionPhotoInput>) {
  const [sale, evidence] = await db.getAll(db.doc(`sales/${input.saleId}`), db.doc(`saleCollectionEvidence/${input.evidenceId}`));
  if (!sale!.exists || sale!.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Sale not found.");
  requireBranchScope(actor, String(sale!.get("branchId")));
  if (!evidence!.exists || evidence!.get("organizationId") !== actor.organizationId || evidence!.get("saleId") !== sale!.id || evidence!.get("branchId") !== sale!.get("branchId") || evidence!.get("status") !== "linked")
    throw new HttpsError("not-found", "Recorded collection photo not found.");
  const collection = await db.doc(`saleCollections/${evidence!.get("collectionId")}`).get();
  if (!collection.exists || collection.get("saleId") !== sale!.id || collection.get("organizationId") !== actor.organizationId || !(collection.get("evidenceIds") ?? []).includes(evidence!.id))
    throw new HttpsError("failed-precondition", "Collection evidence link is inconsistent.");
  if (Number(evidence!.get("byteSize")) > MAX_COLLECTION_PHOTO_BYTES) throw new HttpsError("failed-precondition", "Photo size is inconsistent.");
  const [bytes] = await getStorage().bucket().file(String(evidence!.get("path")), { generation: String(evidence!.get("generation")) }).download();
  if (bytes.length > MAX_COLLECTION_PHOTO_BYTES || createHash("sha256").update(bytes).digest("hex") !== evidence!.get("sha256"))
    throw new HttpsError("data-loss", "Collection photo integrity check failed.");
  return { contentType: evidence!.get("contentType"), base64: bytes.toString("base64"), uploadedBy: evidence!.get("uploadedBy"), uploadedAt: evidence!.get("uploadedAt")?.toDate().toISOString() ?? null, saleItemId: evidence!.get("saleItemId") };
}
