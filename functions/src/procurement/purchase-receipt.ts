import { FieldValue } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import { requireProcurementScope, type ProcurementAccess } from "./authorize.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { uniquenessDocumentId } from "../inventory/calculations.js";
import { postInventoryTransaction, type InventoryPostingExtension } from "../inventory/post-inventory-transaction.js";
import { requestFingerprint } from "../utils/request-fingerprint.js";
import { correlationId } from "../utils/callable.js";
import { receivePurchaseOrderItemInput } from "../validation/procurement.js";

type ReceiptInput = ReturnType<typeof receivePurchaseOrderItemInput.parse>;
function scopedOrder(actor: ProcurementAccess, order: FirebaseFirestore.DocumentSnapshot) {
  if (!order.exists || order.get("organizationId") !== actor.organizationId)
    throw new HttpsError("not-found", "Purchase order is unavailable.");
  requireProcurementScope(actor, { branchId: order.get("branchId"), warehouseId: order.get("warehouseId") }, "procurement.receive");
}
function minor(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new HttpsError("failed-precondition", "Reconcile invalid purchase quantities or costs before receiving.");
  return value;
}
const clean = (values: Record<string, unknown>) => Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== ""));

/** Stock, GRN, PO totals and exact retry evidence commit together or not at all. */
export async function postPurchaseReceipt(actor: ProcurementAccess, input: ReceiptInput, receivedByName?: string) {
  const orderRef = db.doc(`purchaseOrders/${input.purchaseOrderId}`);
  const itemRef = db.doc(`purchaseOrderItems/${input.purchaseOrderItemId}`);
  const operation = db.doc(`idempotencyKeys/${actor.organizationId}_receivePurchaseOrderItem_${input.idempotencyKey}`);
  const stockOperation = db.doc(`idempotencyKeys/${actor.organizationId}_inventoryPost_purchase-${input.idempotencyKey}`);
  const receipt = db.doc(`purchaseReceipts/${uniquenessDocumentId(actor.organizationId, "purchase-receipt", input.idempotencyKey)}`);
  const fingerprint = requestFingerprint(input), cid = correlationId();
  const [initialOrder, initialItem, previous, previousStock] = await db.getAll(orderRef, itemRef, operation, stockOperation);
  scopedOrder(actor, initialOrder!);
  const replay = (record: FirebaseFirestore.DocumentSnapshot) => {
    if (record.get("requestFingerprint") !== fingerprint || record.get("createdBy") !== actor.userId || record.get("entityId") !== orderRef.id)
      throw new HttpsError("failed-precondition", "This receipt reference cannot confirm these instructions. Retry the original saved receipt or check receiving history.", { code: "RETRY_INSTRUCTIONS_MISMATCH" });
    return { receiptId: String(record.get("receiptId")), inventoryTransactionId: String(record.get("inventoryTransactionId")), posted: false };
  };
  if (previous!.exists) return replay(previous!);
  // Old split-commit receipts lack a durable full instruction. Never repost their
  // stock or erase their lock merely because GRN finalization was interrupted.
  if (previousStock!.exists)
    throw new HttpsError("failed-precondition", "An older stock receipt needs its missing goods-received note reconciled. Check the original movement; do not receive the goods again.", { code: "PURCHASE_RECEIPT_RECONCILIATION_REQUIRED" });
  if (!initialItem!.exists || initialItem!.get("organizationId") !== actor.organizationId || initialItem!.get("purchaseOrderId") !== orderRef.id)
    throw new HttpsError("failed-precondition", "Purchase-order item is unavailable.");

  type State = { order: FirebaseFirestore.DocumentSnapshot; target: FirebaseFirestore.DocumentSnapshot; nextReceived: number; nextNet: number; net: number; complete: boolean };
  const extension: InventoryPostingExtension<State> = {
    async prepare(reader, movement) {
      const [order, op, stock] = await reader.getAll(orderRef, operation, stockOperation);
      scopedOrder(actor, order!);
      if (op!.exists || stock!.exists)
        throw new HttpsError("aborted", "The receipt changed while being checked. Retry the same saved receipt.");
      if (!["approved", "partially_received"].includes(String(order!.get("status"))))
        throw new HttpsError("failed-precondition", "Only an approved open purchase order can be received.");
      const items = await reader.get(db.collection("purchaseOrderItems").where("purchaseOrderId", "==", orderRef.id));
      const target = items.docs.find(item => item.id === itemRef.id);
      if (!target || items.empty || items.docs.some(item => item.get("organizationId") !== actor.organizationId))
        throw new HttpsError("failed-precondition", "Purchase-order items require reconciliation.");
      if (target.get("productId") !== initialItem!.get("productId") || target.get("unitCostMinor") !== initialItem!.get("unitCostMinor") ||
        order!.get("receivingLocationId") !== initialOrder!.get("receivingLocationId") || order!.get("supplierId") !== initialOrder!.get("supplierId") ||
        movement.destinationLocationId !== order!.get("receivingLocationId"))
        throw new HttpsError("failed-precondition", "The order's product, cost or receiving store changed. Review the original receipt instructions.");
      const lock = target.get("receiptInProgressKey");
      if (lock && lock !== input.idempotencyKey)
        throw new HttpsError("failed-precondition", "An earlier receipt is unresolved. Reconcile its original reference before receiving more goods.", { code: "PURCHASE_RECEIPT_RECONCILIATION_REQUIRED" });
      const nextReceived = minor(minor(target.get("receivedQuantity") ?? 0) + input.quantity);
      if (nextReceived > minor(target.get("orderedQuantity")))
        throw new HttpsError("failed-precondition", "Receipt quantity exceeds the outstanding ordered quantity.");
      const net = minor(input.quantity * minor(target.get("unitCostMinor")));
      const nextNet = minor(minor(order!.get("receivedNetAmountMinor") ?? 0) + net);
      const complete = items.docs.every(item => (item.id === target.id ? nextReceived : minor(item.get("receivedQuantity") ?? 0)) >= minor(item.get("orderedQuantity")));
      return { order: order!, target, nextReceived, nextNet, net, complete };
    },
    apply(writer, state, movement) {
      const { order, target } = state, now = FieldValue.serverTimestamp();
      writer.update(itemRef, { receivedQuantity: state.nextReceived, receiptInProgressKey: FieldValue.delete(), updatedAt: now });
      writer.update(orderRef, { status: state.complete ? "received" : "partially_received", receivedNetAmountMinor: state.nextNet, updatedAt: now });
      writer.create(receipt, clean({ organizationId: actor.organizationId, purchaseOrderId: orderRef.id,
        purchaseOrderNumber: order.get("purchaseOrderNumber"), purchaseOrderItemId: itemRef.id,
        receiptNumber: `GRN-${movement.transactionNumber}`, supplierId: order.get("supplierId"), branchId: order.get("branchId"), warehouseId: order.get("warehouseId"),
        operationalLocationType: order.get("operationalLocationType"), operationalLocationId: order.get("operationalLocationId"),
        receivingLocationId: order.get("receivingLocationId"), receivingLocationName: order.get("receivingLocationName"),
        productId: target.get("productId"), sku: target.get("sku"), productName: target.get("productName"), unitOfMeasure: target.get("unitOfMeasure"),
        quantity: input.quantity, unitCostMinor: target.get("unitCostMinor"), netAmountMinor: state.net, supplierReference: input.supplierReference,
        inventoryTransactionId: movement.transactionId, receivedAt: movement.effectiveAt, receivedBy: actor.userId, receivedByName,
        lotNumber: input.lot?.lotNumber, notes: input.notes, createdAt: now, requestFingerprint: fingerprint }));
      writer.create(operation, { organizationId: actor.organizationId, action: "receivePurchaseOrderItem", entityId: orderRef.id,
        receiptId: receipt.id, inventoryTransactionId: movement.transactionId, requestFingerprint: fingerprint,
        status: "completed", createdAt: now, createdBy: actor.userId });
      writeAuditLog(writer, actor, { action: "purchase_order.received", entityType: "purchaseOrder", entityId: orderRef.id,
        correlationId: cid, sourceFunction: "receivePurchaseOrderItem", after: { purchaseOrderItemId: itemRef.id, receiptId: receipt.id,
          receiptNumber: `GRN-${movement.transactionNumber}`, quantity: input.quantity, inventoryTransactionId: movement.transactionId } });
      return undefined;
    },
  };
  const posted = await postInventoryTransaction(actor, {
    transactionType: "inventory_receipt", productId: String(initialItem!.get("productId")), quantity: input.quantity,
    destinationLocationId: String(initialOrder!.get("receivingLocationId")), externalAccount: `supplier:${String(initialOrder!.get("supplierId"))}`,
    unitCostMinor: minor(initialItem!.get("unitCostMinor")), serialNumbers: input.serialNumbers,
    lot: input.lot ? { ...input.lot, supplierReference: input.supplierReference } : undefined,
    effectiveAt: input.receivedAt, reason: `Purchase receipt ${String(initialOrder!.get("purchaseOrderNumber"))}`, notes: input.notes,
    referenceType: "purchase_order", referenceId: orderRef.id, referenceNumber: String(initialOrder!.get("purchaseOrderNumber")),
    idempotencyKey: `purchase-${input.idempotencyKey}`, correlationId: cid, sourceFunction: "receivePurchaseOrderItem", requestFingerprint: fingerprint,
  }, extension);
  // A concurrent exact request can replay the stock operation without running
  // the extension; the receipt operation must have committed in the same write.
  const completed = await operation.get();
  if (!completed.exists)
    throw new HttpsError("failed-precondition", "The original stock receipt needs its goods-received note reconciled. Do not receive the goods again.", { code: "PURCHASE_RECEIPT_RECONCILIATION_REQUIRED" });
  return { ...replay(completed), posted: posted.posted };
}
