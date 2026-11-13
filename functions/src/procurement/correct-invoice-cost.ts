import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { db } from "../admin.js";
import { canSelfAuthorizePurchasing } from "../auth/authorize.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { accountingPeriodReference, assertAccountingPeriodOpen } from "../accounting/period-lock.js";
import { balanceDocumentId, uniquenessDocumentId } from "../inventory/calculations.js";
import { requestFingerprint } from "../utils/request-fingerprint.js";
import { requireProcurementScope, type ProcurementAccess } from "./authorize.js";

const id = z.string().trim().min(1).max(128).refine(value => !value.includes("/"));
export const correctInvoiceCostInput = z.object({
  command: z.literal("correct_cost"), supplierInvoiceId: id, purchaseOrderItemId: id,
  expectedUnitCostMinor: z.number().int().nonnegative().max(1e12),
  unitCostMinor: z.number().int().positive().max(1e12),
  expectedGrossAmountMinor: z.number().int().positive().max(1e14),
  reason: z.string().trim().min(10).max(500), idempotencyKey: z.string().uuid(),
}).strict();
const fail = (message: string): never => { throw new HttpsError("failed-precondition", message); };
const money = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail("Cost evidence requires reconciliation.");
  return value as number;
};
const scopeOf = (row: FirebaseFirestore.DocumentSnapshot): { branchId?: string; warehouseId?: string } => row.get("branchId") ? { branchId: String(row.get("branchId")) } : row.get("warehouseId") ? { warehouseId: String(row.get("warehouseId")) } : {};

/** Deliberately bounded: one complete, unissued quantity receipt, before AP posting.
 * Never rewrites posted ledger entries or simulates a goods return. Intervening
 * sales/transfers require a separate valuation/COGS reconciliation, not a guess.
 */
export async function correctSubmittedInvoiceCost(actor: ProcurementAccess, input: z.infer<typeof correctInvoiceCostInput>) {
  const invoiceRef = db.doc(`supplierInvoices/${input.supplierInvoiceId}`);
  const itemRef = db.doc(`purchaseOrderItems/${input.purchaseOrderItemId}`);
  const operation = db.doc(`idempotencyKeys/${actor.organizationId}_correctSupplierInvoiceCost_${input.idempotencyKey}`);
  const correction = db.doc(`purchaseCostCorrections/${uniquenessDocumentId(actor.organizationId, input.idempotencyKey)}`);
  const fingerprint = requestFingerprint({ ...input, actorUserId: actor.userId });
  const effectiveAt = Timestamp.now();
  return db.runTransaction(async tx => {
    const [invoice, item, prior] = await tx.getAll(invoiceRef, itemRef, operation);
    if (!invoice!.exists || invoice!.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Supplier invoice not found.");
    const scope = scopeOf(invoice!);
    requireProcurementScope(actor, scope, ["payables.approve", "procurement.create", "procurement.receive"]);
    if (invoice!.get("createdBy") === actor.userId && !canSelfAuthorizePurchasing(actor)) throw new HttpsError("permission-denied", "This role requires another finance approver.");
    if (prior!.exists) {
      if (prior!.get("requestFingerprint") !== fingerprint || prior!.get("createdBy") !== actor.userId) fail("Retry the original saved correction; these instructions differ.");
      return { supplierInvoiceId: invoiceRef.id, corrected: false, grossAmountMinor: prior!.get("grossAmountMinor"), correctionId: correction.id };
    }
    if (invoice!.get("status") !== "submitted" || invoice!.get("journalEntryId") || money(invoice!.get("paidAmountMinor") ?? 0) || money(invoice!.get("creditedAmountMinor") ?? 0)) fail("Only an unposted, unpaid submitted invoice can have its cost corrected here.");
    if (!item!.exists || item!.get("organizationId") !== actor.organizationId || item!.get("purchaseOrderId") !== invoice!.get("purchaseOrderId")) fail("The product does not belong to this invoice's order.");
    if (invoice!.get("grossAmountMinor") !== input.expectedGrossAmountMinor || item!.get("unitCostMinor") !== input.expectedUnitCostMinor || input.unitCostMinor === input.expectedUnitCostMinor) fail("The cost or invoice changed. Reload and review before correcting.");
    if (item!.get("costCorrectionId")) fail("This receipt already has a cost correction. Further changes require reconciliation.");
    const orderRef = db.doc(`purchaseOrders/${invoice!.get("purchaseOrderId")}`);
    const [order, period, invoicePeriod, invoiceLines, receipts, relatedInvoices] = await Promise.all([
      tx.get(orderRef), tx.get(accountingPeriodReference(actor.organizationId, effectiveAt)),
      tx.get(accountingPeriodReference(actor.organizationId, Timestamp.fromDate(new Date(String(invoice!.get("invoiceDate")))))),
      tx.get(db.collection("supplierInvoiceItems").where("supplierInvoiceId", "==", invoiceRef.id).limit(101)),
      tx.get(db.collection("purchaseReceipts").where("purchaseOrderItemId", "==", itemRef.id).limit(3)),
      tx.get(db.collection("supplierInvoices").where("purchaseOrderId", "==", orderRef.id).limit(3)),
    ]);
    assertAccountingPeriodOpen(period); assertAccountingPeriodOpen(invoicePeriod);
    if (!order.exists || order.get("organizationId") !== actor.organizationId || order.get("supplierId") !== invoice!.get("supplierId") || order.get("status") !== "received" || money(order.get("invoicedNetAmountMinor") ?? 0)) fail("The order must be fully received and not previously invoiced into Accounts Payable.");
    requireProcurementScope(actor, scopeOf(order), ["payables.approve", "procurement.create", "procurement.receive"]);
    if (JSON.stringify(scopeOf(order)) !== JSON.stringify(scope) || relatedInvoices.size !== 1 || relatedInvoices.docs[0]!.id !== invoiceRef.id || invoiceLines.empty || invoiceLines.size > 100 || receipts.size !== 1) fail("Split receipts or invoices require a separate cost reconciliation.");
    const line = invoiceLines.docs.find(row => row.get("purchaseOrderItemId") === itemRef.id);
    if (!line) throw new HttpsError("failed-precondition", "Invoice product is unavailable.");
    const receipt = receipts.docs[0]!;
    const quantity = money(item!.get("orderedQuantity"));
    if (!line || quantity <= 0 || item!.get("receivedQuantity") !== quantity || money(item!.get("invoicedQuantity") ?? 0) || line.get("quantity") !== quantity || receipt.get("quantity") !== quantity ||
      [line, receipt].some(row => row.get("organizationId") !== actor.organizationId || row.get("productId") !== item!.get("productId") || row.get("purchaseOrderId") !== order.id || row.get("unitCostMinor") !== input.expectedUnitCostMinor)) fail("The receipt, invoice and ordered quantities/costs do not agree.");
    const locationId = String(order.get("receivingLocationId"));
    if (receipt.get("receivingLocationId") !== locationId || receipt.get("lotNumber")) fail("This correction requires an ordinary quantity receipt in its original receiving store.");
    const movementRef = db.doc(`inventoryTransactions/${receipt.get("inventoryTransactionId")}`);
    const balanceRef = db.doc(`inventoryBalances/${balanceDocumentId(actor.organizationId, String(item!.get("productId")), locationId)}`);
    const [movement, balance, product, reversal, entries] = await Promise.all([
      tx.get(movementRef), tx.get(balanceRef), tx.get(db.doc(`products/${item!.get("productId")}`)),
      tx.get(db.doc(`inventoryReversals/${movementRef.id}`)),
      tx.get(db.collection("inventoryEntries").where("transactionId", "==", movementRef.id).limit(4)),
    ]);
    if (product.get("organizationId") !== actor.organizationId || product.get("trackingType") !== "quantity" || reversal.exists || movement.get("organizationId") !== actor.organizationId || movement.get("status") !== "posted" || movement.get("transactionType") !== "inventory_receipt" || movement.get("referenceId") !== order.id || movement.get("destinationLocationId") !== locationId || movement.get("costCorrectionId")) fail("Original receipt provenance requires reconciliation.");
    if (!balance.exists || balance.get("organizationId") !== actor.organizationId || balance.get("productId") !== product.id || balance.get("locationId") !== locationId || balance.get("lastTransactionId") !== movement.id) fail("Stock moved after this receipt. Reconcile intervening sales, transfers and their costs before correcting this invoice.");
    const originalNet = quantity * input.expectedUnitCostMinor, newNet = quantity * input.unitCostMinor;
    money(originalNet); money(newNet);
    if (receipt.get("netAmountMinor") !== originalNet || line.get("netAmountMinor") !== originalNet || entries.size !== 2 || !entries.docs.some(row => row.get("locationId") === locationId && row.get("quantityDelta") === quantity && row.get("valueDeltaMinor") === originalNet) || !entries.docs.some(row => row.get("externalAccount") === `supplier:${order.get("supplierId")}` && row.get("quantityDelta") === -quantity && row.get("valueDeltaMinor") === -originalNet)) fail("The original stock entries require reconciliation.");
    const netDelta = newNet - originalNet;
    const oldVat = money(line.get("vatAmountMinor")), newVat = Math.round(newNet * money(line.get("vatRateBasisPoints")) / 10000);
    const vatDelta = newVat - oldVat, grossDelta = netDelta + vatDelta;
    const oldGross = money(invoice!.get("grossAmountMinor"));
    const invoiceNet = money(invoice!.get("netAmountMinor")), invoiceVat = money(invoice!.get("vatAmountMinor"));
    if (invoiceLines.docs.some(row => row.get("organizationId") !== actor.organizationId) || invoiceLines.docs.reduce((sum, row) => sum + money(row.get("netAmountMinor")), 0) !== invoiceNet || invoiceLines.docs.reduce((sum, row) => sum + money(row.get("vatAmountMinor")), 0) !== invoiceVat || invoiceNet + invoiceVat !== oldGross || invoice!.get("outstandingAmountMinor") !== oldGross) fail("Invoice totals require reconciliation.");
    if (order.get("netAmountMinor") !== invoiceNet || order.get("receivedNetAmountMinor") !== invoiceNet || order.get("vatAmountMinor") !== invoiceVat || order.get("grossAmountMinor") !== oldGross) fail("This invoice must cover the full received order before cost correction.");
    const nextValue = money(money(balance.get("totalValueMinor")) + netDelta), onHand = money(balance.get("onHandQuantity"));
    if (onHand < quantity) fail("The original received quantity is no longer available for this correction.");
    const newGross = money(oldGross + grossDelta), now = FieldValue.serverTimestamp();
    const before = { unitCostMinor: input.expectedUnitCostMinor, invoiceGrossMinor: oldGross, inventoryValueMinor: balance.get("totalValueMinor") };
    const after = { unitCostMinor: input.unitCostMinor, invoiceGrossMinor: newGross, inventoryValueMinor: nextValue };
    // No receipt journal exists: the pending invoice will recognize corrected
    // Inventory/AP on approval. Posting another GL journal here double counts.
    tx.update(invoiceRef, { netAmountMinor: invoiceNet + netDelta, vatAmountMinor: invoiceVat + vatDelta, grossAmountMinor: newGross, outstandingAmountMinor: newGross, costCorrectionId: correction.id, updatedAt: now });
    tx.update(line.ref, { originalUnitCostMinor: input.expectedUnitCostMinor, unitCostMinor: input.unitCostMinor, netAmountMinor: newNet, vatAmountMinor: newVat, grossAmountMinor: newNet + newVat, costCorrectionId: correction.id, updatedAt: now });
    tx.update(itemRef, { originalUnitCostMinor: input.expectedUnitCostMinor, unitCostMinor: input.unitCostMinor, netAmountMinor: newNet, vatAmountMinor: newVat, grossAmountMinor: newNet + newVat, costCorrectionId: correction.id, updatedAt: now });
    tx.update(orderRef, { netAmountMinor: money(order.get("netAmountMinor")) + netDelta, vatAmountMinor: money(order.get("vatAmountMinor")) + vatDelta, grossAmountMinor: money(order.get("grossAmountMinor")) + grossDelta, receivedNetAmountMinor: money(order.get("receivedNetAmountMinor")) + netDelta, updatedAt: now });
    tx.update(receipt.ref, { originalUnitCostMinor: input.expectedUnitCostMinor, originalNetAmountMinor: originalNet, unitCostMinor: input.unitCostMinor, netAmountMinor: newNet, costCorrectionId: correction.id, updatedAt: now });
    tx.update(balanceRef, { totalValueMinor: nextValue, averageUnitCostMinor: Math.round(nextValue / onHand), version: FieldValue.increment(1), lastTransactionId: correction.id, lastMovementAt: effectiveAt, updatedAt: now });
    tx.update(movementRef, { costCorrectionId: correction.id });
    tx.create(db.doc(`inventoryTransactions/${correction.id}`), { organizationId: actor.organizationId, transactionNumber: `COST-${input.idempotencyKey}`, transactionType: "purchase_cost_correction", status: "posted", referenceType: "supplierInvoice", referenceId: invoiceRef.id, referenceNumber: invoice!.get("supplierInvoiceNumber"), destinationLocationId: locationId, ...scope, effectiveAt, postedAt: now, createdAt: now, createdBy: actor.userId, postedBy: actor.userId, reason: input.reason, quantityChange: 0, valueDeltaMinor: netDelta, originalInventoryTransactionId: movement.id });
    const entry = { organizationId: actor.organizationId, transactionId: correction.id, transactionNumber: `COST-${input.idempotencyKey}`, transactionType: "purchase_cost_correction", productId: product.id, sku: item!.get("sku"), productName: item!.get("productName"), trackingType: "quantity", quantityDelta: 0, unitCostMinor: 0, currency: "NGN", effectiveAt, createdAt: now, postedBy: actor.userId, reason: input.reason };
    tx.create(db.collection("inventoryEntries").doc(), { ...entry, ...scope, locationId, valueDeltaMinor: netDelta, balanceBefore: onHand, balanceAfter: onHand });
    tx.create(db.collection("inventoryEntries").doc(), { ...entry, externalAccount: `supplier:${order.get("supplierId")}`, valueDeltaMinor: -netDelta, balanceBefore: 0, balanceAfter: 0 });
    tx.create(correction, { organizationId: actor.organizationId, ...scope, supplierInvoiceId: invoiceRef.id, purchaseOrderId: order.id, purchaseOrderItemId: itemRef.id, receiptId: receipt.id, originalInventoryTransactionId: movement.id, before, after, quantity, netDeltaMinor: netDelta, reason: input.reason, accountingTreatment: "unposted_invoice_corrected_before_approval", createdBy: actor.userId, createdAt: now });
    tx.create(operation, { organizationId: actor.organizationId, requestFingerprint: fingerprint, createdBy: actor.userId, correctionId: correction.id, grossAmountMinor: newGross, createdAt: now });
    writeAuditLog(tx, actor, { action: "supplier_invoice.cost_corrected", entityType: "supplierInvoice", entityId: invoiceRef.id, correlationId: input.idempotencyKey, sourceFunction: "approveSupplierInvoice", reason: input.reason, before, after: { ...after, correctionId: correction.id, quantityUnchanged: true } });
    return { supplierInvoiceId: invoiceRef.id, corrected: true, grossAmountMinor: newGross, correctionId: correction.id };
  });
}
