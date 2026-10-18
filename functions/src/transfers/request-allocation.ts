import { FieldValue, type DocumentSnapshot, type Transaction } from "firebase-admin/firestore";
import type { AccessProfile } from "../auth/authorize.js";
import { db } from "../admin.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { ownedRequestAllocation } from "./reservation-ownership.js";
import { stockReview } from "./stock-execution.js";

/** Transfer-owned demand is prospective evidence. Missing legacy ownership is
 * review-only; aggregate demand cannot identify which transfer owns a unit. */
export async function prepareRequestAllocationChange(
  tx: Pick<Transaction, "get" | "getAll">, actor: AccessProfile, transfer: DocumentSnapshot,
  changes: { item: DocumentSnapshot; release: number; fulfilled?: number }[],
  correlationId: string, receiptId?: string,
): Promise<(writer: Pick<Transaction, "update" | "create">) => void> {
  if (transfer.get("sourceType") !== "branch_request" || !changes.some(change => change.release || change.fulfilled)) return () => {};
  const requestId = String(transfer.get("sourceRequestId"));
  const requestRefs = changes.map(change => db.doc(`branchRequestItems/${String(change.item.get("sourceRequestItemId"))}`));
  if (new Set(requestRefs.map(ref => ref.id)).size !== requestRefs.length) stockReview("Each transfer line must own a distinct request item.");
  const [request, ...requestItems] = await tx.getAll(db.doc(`branchRequests/${requestId}`), ...requestRefs);
  if (!request!.exists || request!.get("organizationId") !== actor.organizationId || request!.get("branchId") !== transfer.get("destinationBranchId")) stockReview("The original request ownership is inconsistent.");
  const totalReceived = changes.reduce((sum, change) => sum + (change.fulfilled ?? 0), 0);
  const markerRef = receiptId ? db.doc(`requestFulfilments/${requestId}__${receiptId}`) : null;
  if (markerRef && (await tx.get(markerRef)).exists) stockReview("Request fulfilment already exists outside this unfinished receipt execution.");
  const plans = changes.map((change, index) => {
    const requestItem = requestItems[index]!;
    const owned = ownedRequestAllocation(change.item);
    const fulfilledDelta = change.fulfilled ?? 0;
    const allocated = Number(requestItem.get("transferAllocatedQuantity") ?? 0);
    const fulfilled = Number(requestItem.get("fulfilledQuantity") ?? 0) + fulfilledDelta;
    const approved = Number(requestItem.get("approvedQuantity") ?? 0);
    if (!requestItem.exists || requestItem.get("organizationId") !== actor.organizationId || requestItem.get("requestId") !== requestId || requestItem.get("productId") !== change.item.get("productId")
      || ![allocated, fulfilled, approved, fulfilledDelta].every(value => Number.isSafeInteger(value) && value >= 0)
      || !Number.isSafeInteger(change.release) || change.release < 0 || change.release > owned || allocated < owned || fulfilledDelta > change.release || fulfilled > approved)
      stockReview("The transfer's request allocation or fulfilment is inconsistent.");
    return { change, requestItem, owned, allocated, fulfilled, approved };
  });
  const total = Number(request!.get("totalFulfilledQuantity") ?? 0) + totalReceived;
  const approved = Number(request!.get("totalApprovedQuantity") ?? 0);
  if (totalReceived && (![total, approved].every(value => Number.isSafeInteger(value) && value >= 0) || total > approved)) stockReview("Receipt fulfilment exceeds approved request demand.");
  return writer => {
    for (const { change, requestItem, owned, allocated, fulfilled, approved } of plans) {
      writer.update(change.item.ref, { requestAllocatedQuantity: owned - change.release });
      writer.update(requestItem.ref, { transferAllocatedQuantity: allocated - change.release, fulfilledQuantity: fulfilled, outstandingQuantity: approved - fulfilled, updatedAt: FieldValue.serverTimestamp() });
    }
    if (!totalReceived || !markerRef) return;
    const status = total === approved ? "fulfilled" : "partially_fulfilled";
    writer.update(request!.ref, { totalFulfilledQuantity: total, totalOutstandingQuantity: approved - total, status, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.userId });
    writer.create(markerRef, { organizationId: actor.organizationId, requestId, transferId: transfer.id, receiptId, lines: plans.filter(plan => plan.change.fulfilled).map(plan => ({ requestItemId: plan.requestItem.id, quantity: plan.change.fulfilled })), quantity: totalReceived, createdAt: FieldValue.serverTimestamp(), createdBy: actor.userId });
    writer.create(db.collection("branchRequestEvents").doc(), { organizationId: actor.organizationId, requestId, branchId: request!.get("branchId"), eventType: "transfer_fulfilment_received", fromStatus: request!.get("status"), toStatus: status, actorUserId: actor.userId, actorRoleId: actor.roleId, requestVersion: request!.get("version") ?? null, transferId: transfer.id, receiptId, quantity: totalReceived, correlationId, createdAt: FieldValue.serverTimestamp() });
    writeAuditLog(writer, actor, { action: "branch_request.transfer_fulfilment", entityType: "branchRequest", entityId: requestId, correlationId, sourceFunction: "confirmTransferReceipt", after: { transferId: transfer.id, receiptId, quantity: totalReceived } });
  };
}
