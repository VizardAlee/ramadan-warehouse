import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import { requireBranchScope, requirePermission, type AccessProfile } from "../auth/authorize.js";
import { normalizeInventoryIdentifier } from "./calculations.js";
import { allocatedHeldCost } from "../sales/return-disposition.js";
import { postInventoryTransaction, type PostingRequest, type InventoryPostingExtension } from "./post-inventory-transaction.js";

function count(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new HttpsError("failed-precondition", "Handover quantities or costs need reconciliation.");
  return Number(value);
}

/** Reuse supplier-return accounting, without issuing handed-over goods a second time. */
export async function postSupplierStockOrHeldCredit<State>(actor: AccessProfile, input: PostingRequest, extension: InventoryPostingExtension<State>, handoverId?: string) {
  if (!handoverId) return postInventoryTransaction(actor, input, extension);
  requirePermission(actor, "sales.returns.approve");
  const handoverRef = db.doc(`inventoryTransactions/${handoverId}`);
  return db.runTransaction(async tx => {
    const handover = await tx.get(handoverRef);
    if (!handover.exists || handover.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Supplier handover not found.");
    const branchId = handover.get("branchId");
    if (typeof branchId !== "string") throw new HttpsError("failed-precondition", "Handover store needs reconciliation.");
    requireBranchScope(actor, branchId);
    if (handover.get("status") !== "posted" || handover.get("transactionType") !== "held_return_supplier_handover" || `supplier:${handover.get("supplierId")}` !== input.externalAccount || handover.get("productId") !== input.productId)
      throw new HttpsError("failed-precondition", "Choose the original supplier and product for this physical handover.");
    const prior = await tx.get(db.doc(`supplierReturns/${input.referenceId}`));
    if (prior.exists) return { posted: false };
    const [service, item, originalReturn, reversed] = await tx.getAll(
      db.doc(`aftersalesCases/${handover.get("aftersalesCaseId")}`),
      db.doc(`saleReturnItems/${handover.get("returnItemId")}`),
      db.doc(`saleReturns/${handover.get("saleReturnId")}`),
      db.doc(`inventoryReversals/${handoverId}`),
    );
    if ([service!, item!, originalReturn!].some(doc => !doc.exists || doc.get("organizationId") !== actor.organizationId || doc.get("branchId") !== branchId) || reversed!.exists || originalReturn!.get("status") !== "approved" || service!.get("returnId") !== originalReturn!.id || service!.get("returnItemId") !== item!.id || item!.get("returnId") !== originalReturn!.id || service!.get("productId") !== input.productId || item!.get("productId") !== input.productId || item!.get("condition") !== "non_restockable" || item!.get("inspectionStatus") !== "completed")
      throw new HttpsError("failed-precondition", "Original inspected return and service evidence do not match this handover.");
    const total = count(handover.get("quantity")), settled = count(handover.get("supplierSettledQuantity") ?? 0);
    const originalCost = count(handover.get("originalCostMinor")), settledCost = count(handover.get("supplierSettledOriginalCostMinor") ?? 0);
    if (!total || settled + input.quantity > total || settledCost !== allocatedHeldCost(originalCost, total, 0, settled))
      throw new HttpsError("failed-precondition", "This quantity is already settled or the handover needs reconciliation.");
    const serial = handover.get("serialNumber");
    if (!["quantity", "serial"].includes(handover.get("trackingType"))) throw new HttpsError("failed-precondition", "Batch-specific supplier settlement requires reconciliation.");
    if (serial ? total !== 1 || input.quantity !== 1 || input.serialNumbers.length !== 1 || normalizeInventoryIdentifier(input.serialNumbers[0]!) !== normalizeInventoryIdentifier(serial) : input.serialNumbers.length > 0)
      throw new HttpsError("failed-precondition", "Credit must identify the exact serial handed to this supplier.");
    if (serial) {
      const originalSerial = await tx.get(db.doc(`serializedItems/${handover.get("serializedItemId")}`));
      if (!originalSerial.exists || originalSerial.get("organizationId") !== actor.organizationId || originalSerial.get("productId") !== input.productId || originalSerial.get("branchId") !== branchId || originalSerial.get("status") !== "returned_to_supplier" || originalSerial.get("active") !== false || originalSerial.get("lastTransactionId") !== handover.id)
        throw new HttpsError("failed-precondition", "The handed-over serial has changed custody; reconcile before crediting.");
    }
    const location = await tx.get(db.doc(`inventoryLocations/${input.sourceLocationId}`));
    if (!location.exists || location.get("organizationId") !== actor.organizationId || location.get("branchId") !== branchId || location.get("warehouseId"))
      throw new HttpsError("failed-precondition", "Cross-store or historical warehouse credits need accounting reconciliation before settlement.");
    const effectiveAt = Timestamp.fromDate(new Date(input.effectiveAt));
    if (!(handover.get("effectiveAt") instanceof Timestamp) || effectiveAt.toMillis() < handover.get("effectiveAt").toMillis()) throw new HttpsError("invalid-argument", "Credit date must follow a verified physical handover date.");
    const cost = allocatedHeldCost(originalCost, total, settled, input.quantity);
    const context = { transactionId: handover.id, transactionNumber: String(handover.get("transactionNumber")), productId: input.productId, quantity: input.quantity, movementValueMinor: cost, movementUnitCostMinor: Math.round(cost / input.quantity), sourceLocationId: location.id, sourceBranchId: branchId, effectiveAt };
    const state = await extension.prepare({ get: tx.get.bind(tx), getAll: tx.getAll.bind(tx) }, context);
    extension.apply(tx, state, context);
    tx.update(handoverRef, { supplierSettledQuantity: settled + input.quantity, supplierSettledOriginalCostMinor: settledCost + cost, supplierSettlementStatus: settled + input.quantity === total ? "settled" : "partially_settled", latestSupplierReturnId: input.referenceId, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.userId });
    return { posted: true };
  });
}
