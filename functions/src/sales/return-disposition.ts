import { FieldValue, Timestamp, type DocumentSnapshot, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { db } from "../admin.js";
import { accountingPeriodReference, assertAccountingPeriodOpen } from "../accounting/period-lock.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { requireAccess, requirePermission } from "../auth/authorize.js";
import { balanceDocumentId, uniquenessDocumentId } from "../inventory/calculations.js";
import { approveSaleReturnInput } from "../validation/sales.js";
import { assertBalancedJournal } from "./calculations.js";

type Request = NonNullable<z.infer<typeof approveSaleReturnInput>["disposition"]>;
function integer(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new HttpsError("failed-precondition", `Invalid ${label}; review the original return before proceeding.`);
  return Number(value);
}
// Cumulative rounding allocates the original pennies exactly, including partial outcomes.
export function allocatedHeldCost(total: number, quantity: number, disposed: number, next: number) {
  const rounded = (units: number) => Number((BigInt(total) * BigInt(units) * 2n + BigInt(quantity)) / (BigInt(quantity) * 2n));
  return rounded(disposed + next) - rounded(disposed);
}

/** Called inside the return's existing idempotent transaction. All reads precede writes. */
export async function disposeHeldReturn(tx: Transaction, actor: Awaited<ReturnType<typeof requireAccess>>, record: DocumentSnapshot, request: Request, cid: string) {
  requirePermission(actor, "inventory.adjust");
  if (request.outcome === "supplier_handover") {
    requirePermission(actor, "procurement.receive");
    requirePermission(actor, "suppliers.read");
  }
  if (record.get("status") !== "approved" || record.get("inspectionStatus") !== "completed" || record.get("kind") === "reservation_cancellation")
    throw new HttpsError("failed-precondition", "Only approved, inspected physical returns can leave held stock.");
  const caseRef = db.doc(`aftersalesCases/${request.caseId}`);
  const service = await tx.get(caseRef);
  if (!service.exists || service.get("organizationId") !== actor.organizationId || service.get("returnId") !== record.id || service.get("branchId") !== record.get("branchId") || service.get("saleId") !== record.get("saleId"))
    throw new HttpsError("not-found", "Linked return service case not found.");
  if (!["completed", "cancelled"].includes(service.get("status")))
    throw new HttpsError("failed-precondition", "Finish or cancel the service case before recording the final destination of its held goods.");
  const item = await tx.get(db.doc(`saleReturnItems/${service.get("returnItemId")}`));
  if (!item.exists || item.get("organizationId") !== actor.organizationId || item.get("returnId") !== record.id || item.get("saleId") !== record.get("saleId") || item.get("branchId") !== record.get("branchId") || item.get("productId") !== service.get("productId") || item.get("condition") !== "non_restockable" || item.get("inspectionStatus") !== "completed" || !["warranty", "repair"].includes(item.get("disposition")))
    throw new HttpsError("failed-precondition", "This case no longer identifies inspected held return goods.");
  const serialNumber = service.get("serialNumber") as string | null;
  const links = (item.get("aftersalesCaseLinks") ?? []) as Array<{ caseId: string; serialNumber: string | null; quantity: number }>;
  const caseQuantity = integer(service.get("quantity"), "case quantity");
  const totalQuantity = integer(item.get("quantity"), "return quantity");
  const disposed = integer(item.get("heldDisposedQuantity") ?? 0, "disposed quantity");
  const caseDisposed = integer(service.get("heldDisposedQuantity") ?? 0, "case disposed quantity");
  const totalCost = integer(item.get("costAmountMinor"), "original returned cost");
  const disposedCost = integer(item.get("heldDisposedCostMinor") ?? 0, "disposed cost");
  if (!links.some(link => link.caseId === service.id && link.serialNumber === serialNumber && link.quantity === caseQuantity) || !totalQuantity || !caseQuantity || disposed + request.quantity > totalQuantity || caseDisposed + request.quantity > caseQuantity || disposedCost > totalCost)
    throw new HttpsError("failed-precondition", "The held quantity has changed or is already disposed. Refresh the case.");
  const effectiveAt = Timestamp.now(), now = FieldValue.serverTimestamp();
  const transactionRef = db.collection("inventoryTransactions").doc();
  const counterRef = db.doc(`inventoryCounters/${actor.organizationId}_transactions`);
  const journalCounterRef = db.doc(`journalCounters/${uniquenessDocumentId(actor.organizationId, "general")}`);
  const [product, branch, counter, journalCounter, period, supplier, serial] = await tx.getAll(
    db.doc(`products/${item.get("productId")}`), db.doc(`branches/${record.get("branchId")}`), counterRef, journalCounterRef,
    accountingPeriodReference(actor.organizationId, effectiveAt),
    db.doc(`suppliers/${request.supplierId ?? "no-held-supplier"}`),
    db.doc(`serializedItems/${serialNumber ? uniquenessDocumentId(actor.organizationId, serialNumber) : "no-held-serial"}`),
  );
  if (!product!.exists || product!.get("organizationId") !== actor.organizationId || !branch!.exists || branch!.get("organizationId") !== actor.organizationId)
    throw new HttpsError("failed-precondition", "The original product or store could not be verified.");
  if (product!.get("trackingType") === "lot") throw new HttpsError("failed-precondition", "Lot-tracked goods require a lot-specific disposition workflow.");
  const serials = (item.get("serialNumbers") ?? []) as string[];
  if (serialNumber ? request.quantity !== 1 || caseQuantity !== 1 || !serials.includes(serialNumber) || !serial!.exists || serial!.get("organizationId") !== actor.organizationId || serial!.get("productId") !== item.get("productId") || serial!.get("branchId") !== record.get("branchId") || serial!.get("saleId") !== record.get("saleId") || serial!.get("lastSaleReturnId") !== record.id || serial!.get("status") !== "returned_held" || serial!.get("active") !== false : serials.length > 0)
    throw new HttpsError("failed-precondition", "The exact returned serial is no longer held for this case.");
  const cost = serialNumber ? integer(serial!.get("currentUnitCostMinor"), "serial cost") : allocatedHeldCost(totalCost, totalQuantity, disposed, request.quantity);
  if (disposedCost + cost > totalCost || (disposed + request.quantity === totalQuantity && disposedCost + cost !== totalCost))
    throw new HttpsError("failed-precondition", "The original held costs do not reconcile; review before disposition.");
  if (request.outcome === "supplier_handover" && (!supplier!.exists || supplier!.get("organizationId") !== actor.organizationId || supplier!.get("active") !== true))
    throw new HttpsError("failed-precondition", "Select an active supplier in this organization.");
  let location: DocumentSnapshot | undefined, balance: DocumentSnapshot | undefined;
  if (request.outcome === "restock") {
    assertAccountingPeriodOpen(period!);
    if (!request.confirmedResellable || branch!.get("status") !== "active" || product!.get("active") !== true)
      throw new HttpsError("failed-precondition", "Confirm the goods are resellable in an active store and product catalogue.");
    const locations = await tx.get(db.collection("inventoryLocations").where("organizationId", "==", actor.organizationId).where("branchId", "==", record.get("branchId")).where("type", "==", "branch").limit(5));
    const active = locations.docs.filter(loc => loc.get("status") === "active");
    if (active.length !== 1) throw new HttpsError("failed-precondition", "Configure one active sales-stock location for this store before restocking.");
    location = active[0]!;
    balance = await tx.get(db.doc(`inventoryBalances/${balanceDocumentId(actor.organizationId, item.get("productId"), location.id)}`));
    if (balance.exists && (balance.get("organizationId") !== actor.organizationId || balance.get("productId") !== item.get("productId") || balance.get("locationId") !== location.id))
      throw new HttpsError("failed-precondition", "Stock balance scope mismatch.");
  }
  const onHand = integer(balance?.get("onHandQuantity") ?? 0, "on-hand stock"), reserved = integer(balance?.get("reservedQuantity") ?? 0, "reserved stock");
  const value = integer(balance?.get("totalValueMinor") ?? 0, "stock value");
  if (reserved > onHand) throw new HttpsError("failed-precondition", "Stock reservations exceed physical quantity; reconcile first.");
  const nextOnHand = integer(onHand + request.quantity, "resulting stock"), nextValue = integer(value + cost, "resulting stock value");
  const sequence = integer(Number(counter!.get("value") ?? 0) + 1, "stock sequence");
  const transactionNumber = `INV-${effectiveAt.toDate().getUTCFullYear()}-${String(sequence).padStart(6, "0")}`;
  const transactionType = `held_return_${request.outcome}`;
  const journalRef = request.outcome === "restock" && cost > 0 ? db.collection("journalEntries").doc() : null;
  const base = { organizationId: actor.organizationId, branchId: record.get("branchId"), productId: item.get("productId"), sku: item.get("sku") ?? product!.get("sku") ?? "", productName: item.get("productName"), trackingType: serialNumber ? "serial" : "quantity", transactionId: transactionRef.id, transactionNumber, transactionType, referenceType: "aftersalesCase", referenceId: service.id, saleReturnId: record.id, returnItemId: item.id, journalEntryId: journalRef?.id ?? null, serialNumber: serialNumber ?? null, serializedItemId: serialNumber ? serial!.id : null, createdAt: now, effectiveAt, postedBy: actor.userId, createdBy: actor.userId, reason: request.reason, correlationId: cid, currency: "NGN" };
  if (location && balance) {
    tx.set(balance.ref, { organizationId: actor.organizationId, productId: item.get("productId"), sku: base.sku, productName: item.get("productName"), categoryId: product!.get("categoryId") ?? null, brand: product!.get("brand") ?? null, trackingType: base.trackingType, branchId: record.get("branchId"), locationId: location.id, onHandQuantity: nextOnHand, reservedQuantity: reserved, availableQuantity: nextOnHand - reserved, totalValueMinor: nextValue, averageUnitCostMinor: Math.round(nextValue / nextOnHand), currency: "NGN", lastTransactionId: transactionRef.id, lastMovementAt: effectiveAt, version: integer(Number(balance.get("version") ?? 0) + 1, "balance version"), createdAt: balance.get("createdAt") ?? now, updatedAt: now }, { merge: true });
    tx.create(db.collection("inventoryEntries").doc(), { ...base, locationId: location.id, externalAccount: null, quantityDelta: request.quantity, valueDeltaMinor: cost, unitCostMinor: Math.round(cost / request.quantity), balanceBefore: onHand, balanceAfter: nextOnHand });
    tx.create(db.collection("inventoryEntries").doc(), { ...base, locationId: null, externalAccount: "held_customer_returns", quantityDelta: -request.quantity, valueDeltaMinor: -cost, unitCostMinor: Math.round(cost / request.quantity), balanceBefore: 0, balanceAfter: 0 });
  } else {
    // Held goods were never restored to inventory assets. Custody disposal is not another expense.
    tx.create(db.collection("inventoryEntries").doc(), { ...base, locationId: null, externalAccount: request.outcome === "scrap" ? "scrap" : `supplier:${supplier!.id}`, quantityDelta: 0, valueDeltaMinor: 0, heldQuantityDelta: -request.quantity, disposedQuantity: request.quantity, heldOriginalCostMinor: cost, unitCostMinor: Math.round(cost / request.quantity), balanceBefore: 0, balanceAfter: 0 });
  }
  if (serialNumber) tx.update(serial!.ref, { status: request.outcome === "restock" ? "at_branch" : request.outcome === "scrap" ? "scrapped" : "returned_to_supplier", active: request.outcome === "restock", currentLocationId: location?.id ?? null, lastTransactionId: transactionRef.id, lastMovementAt: effectiveAt, updatedAt: now, updatedBy: actor.userId, ...(request.outcome === "restock" ? { saleId: FieldValue.delete(), saleItemId: FieldValue.delete() } : {}) });
  if (journalRef) {
    const journalSequence = integer(Number(journalCounter!.get("value") ?? 0) + 1, "journal sequence");
    const journalNumber = `JRN-${effectiveAt.toDate().getUTCFullYear()}-${String(journalSequence).padStart(6, "0")}`;
    const lines = [{ accountCode: "1200", accountName: "Inventory", debitMinor: cost, creditMinor: 0 }, { accountCode: "5000", accountName: "Cost of sales", debitMinor: 0, creditMinor: cost }];
    assertBalancedJournal(lines);
    tx.set(journalCounterRef, { organizationId: actor.organizationId, kind: "journalEntry", value: journalSequence, updatedAt: now }, { merge: true });
    tx.create(journalRef, { organizationId: actor.organizationId, branchId: record.get("branchId"), journalNumber, journalType: transactionType, status: "posted", referenceType: "inventoryTransaction", referenceId: transactionRef.id, referenceNumber: transactionNumber, aftersalesCaseId: service.id, saleReturnId: record.id, description: request.reason, totalDebitMinor: cost, totalCreditMinor: cost, currency: "NGN", effectiveAt, postedAt: now, postedBy: actor.userId, createdAt: now });
    for (const line of lines) {
      const chart = db.doc(`chartOfAccounts/${uniquenessDocumentId(actor.organizationId, line.accountCode)}`);
      tx.set(chart, { organizationId: actor.organizationId, code: line.accountCode, name: line.accountName, active: true, systemManaged: true, currency: "NGN", updatedAt: now }, { merge: true });
      tx.create(db.collection("journalLines").doc(), { organizationId: actor.organizationId, branchId: record.get("branchId"), journalEntryId: journalRef.id, journalNumber, accountId: chart.id, ...line, currency: "NGN", effectiveAt, createdAt: now });
    }
  }
  const supplierId = request.outcome === "supplier_handover" ? supplier!.id : null;
  const summary = { transactionId: transactionRef.id, transactionNumber, outcome: request.outcome, quantity: request.quantity, originalCostMinor: cost, journalEntryId: journalRef?.id ?? null, supplierId, supplierName: supplierId ? supplier!.get("name") : null, handoverReference: request.handoverReference ?? null, reason: request.reason, recordedAt: effectiveAt, recordedBy: actor.userId };
  tx.create(transactionRef, { ...base, status: "posted", createdBy: actor.userId, postedBy: actor.userId, postedAt: now, sourceLocationId: null, destinationLocationId: location?.id ?? null, destinationBranchId: location ? record.get("branchId") : null, aftersalesCaseId: service.id, ...summary, supplierSettlementStatus: supplierId ? "not_recorded" : null });
  tx.set(counterRef, { organizationId: actor.organizationId, kind: "inventoryTransaction", value: sequence, updatedAt: now }, { merge: true });
  tx.update(item.ref, { heldDisposedQuantity: disposed + request.quantity, heldDisposedCostMinor: disposedCost + cost, updatedAt: now });
  tx.update(caseRef, { heldDisposedQuantity: caseDisposed + request.quantity, heldDisposedCostMinor: integer(Number(service.get("heldDisposedCostMinor") ?? 0) + cost, "case disposed cost"), recentDispositions: [...(service.get("recentDispositions") ?? []), summary].slice(-20), updatedAt: now, updatedBy: actor.userId });
  writeAuditLog(tx, actor, { action: "sale_return.held_goods_disposed", entityType: "saleReturn", entityId: record.id, sourceFunction: "approveSaleReturn", correlationId: cid, reason: request.reason, before: { heldQuantity: caseQuantity - caseDisposed }, after: { ...summary, heldQuantity: caseQuantity - caseDisposed - request.quantity, financialSupplierCreditRecorded: false } });
  return { returnId: record.id, caseId: service.id, transactionId: transactionRef.id, transactionNumber, journalEntryId: journalRef?.id ?? null, disposed: true };
}
