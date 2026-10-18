import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import type { z } from "zod";
import { db } from "../admin.js";
import { requireAccess, requirePermission } from "../auth/authorize.js";
import { scopedAccess, requirePermissionScope } from "../auth/permission-scope.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { uniquenessDocumentId } from "../inventory/calculations.js";
import { correlationId } from "../utils/callable.js";
import type { updateDispatchDetailsInput } from "../validation/dispatch-details.js";

/** Dispatch metadata only. No inventory, payment or accounting writes. */
export async function updateDispatchDetails(actor: Awaited<ReturnType<typeof requireAccess>>, input: z.infer<typeof updateDispatchDetailsInput>) {
  requirePermission(actor, "sales.stock.release");
  const access = await scopedAccess(actor);
  const saleRef = db.doc(`sales/${input.saleId}`), collectionRef = db.doc(`saleCollections/${input.collectionId}`);
  const operation = db.doc(`idempotencyOperations/${uniquenessDocumentId(actor.organizationId, "dispatchDetails", input.idempotencyKey)}`);
  const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const details = { dispatcherPhone: input.dispatcherPhone || null, vehiclePlate: input.vehiclePlate || null, deliveryRecipientName: input.deliveryRecipientName || null };
  return db.runTransaction(async tx => {
    const [sale, collection, previous] = await tx.getAll(saleRef, collectionRef, operation);
    if (!sale!.exists || !collection!.exists || sale!.get("organizationId") !== actor.organizationId || collection!.get("organizationId") !== actor.organizationId || collection!.get("saleId") !== sale!.id || collection!.get("branchId") !== sale!.get("branchId"))
      throw new HttpsError("not-found", "This handover is unavailable for this invoice.");
    requirePermissionScope(access, { branchId: String(sale!.get("branchId")) }, "sales.stock.release");
    if (previous!.exists) {
      if (previous!.get("fingerprint") !== fingerprint) throw new HttpsError("invalid-argument", "Retry the original dispatch details without changes.");
      return previous!.get("result");
    }
    const version = Number(collection!.get("dispatchDetailsVersion") ?? 0);
    if (!Number.isSafeInteger(version) || version < 0 || version !== input.expectedVersion || !Number.isSafeInteger(version + 1))
      throw new HttpsError("failed-precondition", "Dispatch details changed. Reopen this handover before editing.");
    if (sale!.get("status") !== "completed" || !(Number(collection!.get("totalQuantity")) > 0))
      throw new HttpsError("failed-precondition", "Dispatch details require an actual recorded handover.");
    const result = { collectionId: collection!.id, ...details, dispatchDetailsVersion: version + 1 };
    tx.update(collectionRef, { ...details, dispatchDetailsVersion: version + 1, dispatchDetailsUpdatedAt: FieldValue.serverTimestamp(), dispatchDetailsUpdatedBy: actor.userId });
    tx.create(operation, { organizationId: actor.organizationId, fingerprint, result, createdAt: FieldValue.serverTimestamp() });
    writeAuditLog(tx, actor, { action: "sale.dispatch_details_updated", entityType: "saleCollection", entityId: collection!.id, sourceFunction: "confirmPosSaleOrder", correlationId: correlationId(), before: { dispatcherPhone: collection!.get("dispatcherPhone") ?? null, vehiclePlate: collection!.get("vehiclePlate") ?? null, deliveryRecipientName: collection!.get("deliveryRecipientName") ?? null, dispatchDetailsVersion: version }, after: { saleId: sale!.id, branchId: sale!.get("branchId"), ...result } });
    return result;
  });
}
