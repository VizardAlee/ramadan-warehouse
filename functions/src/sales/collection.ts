import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import type { z } from "zod";
import { db } from "../admin.js";
import { requireAccess, requireBranchScope, requirePermission } from "../auth/authorize.js";
import { accountingPeriodReference, assertAccountingPeriodOpen } from "../accounting/period-lock.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { balanceDocumentId, issueCost, uniquenessDocumentId } from "../inventory/calculations.js";
import { correlationId } from "../utils/callable.js";
import { assertBalancedJournal } from "./calculations.js";
import type { collectSaleInput } from "../validation/sales.js";

/** Uses the existing confirmation endpoint; physical release has its own permission. */
export async function collectReservedSale(
  actor: Awaited<ReturnType<typeof requireAccess>>,
  input: z.infer<typeof collectSaleInput>,
) {
  requirePermission(actor, "sales.stock.release");
  const saleRef = db.doc(`sales/${input.saleId}`);
  const initial = await saleRef.get();
  if (!initial.exists || initial.get("organizationId") !== actor.organizationId)
    throw new HttpsError("not-found", "Sale not found.");
  const branchId = String(initial.get("branchId"));
  requireBranchScope(actor, branchId);
  const itemRefs = input.lines.map((line) => db.doc(`saleItems/${line.saleItemId}`));
  const collection = db.collection("saleCollections").doc();
  const movement = db.collection("inventoryTransactions").doc();
  const journal = db.collection("journalEntries").doc();
  const operation = db.doc(`idempotencyKeys/${actor.organizationId}_collectSale_${input.idempotencyKey}`);
  const inventoryCounter = db.doc(`inventoryCounters/${actor.organizationId}_transactions`);
  const journalCounter = db.doc(`journalCounters/${uniquenessDocumentId(actor.organizationId, "general")}`);
  const effectiveAt = Timestamp.now();
  const period = accountingPeriodReference(actor.organizationId, effectiveAt);
  const cid = correlationId();
  let result = { saleId: saleRef.id, collectionId: collection.id, collectionStatus: "collected", recorded: true };
  await db.runTransaction(async (transaction) => {
    const [previous, sale, inventorySequence, journalSequence, periodSnapshot, location, ...items] = await transaction.getAll(
      operation, saleRef, inventoryCounter, journalCounter, period,
      db.doc(`inventoryLocations/${initial.get("locationId")}`), ...itemRefs,
    );
    if (previous!.exists) {
      if (previous!.get("saleId") !== input.saleId)
        throw new HttpsError("invalid-argument", "This collection reference belongs to another sale.");
      result = { saleId: saleRef.id, collectionId: String(previous!.get("entityId")), collectionStatus: String(previous!.get("collectionStatus")), recorded: false };
      return;
    }
    if (sale!.get("organizationId") !== actor.organizationId || sale!.get("branchId") !== branchId)
      throw new HttpsError("permission-denied", "Sale scope changed.");
    if (sale!.get("status") !== "completed" || sale!.get("collectionTracked") !== true || !["awaiting_collection", "partially_collected"].includes(sale!.get("collectionStatus")))
      throw new HttpsError("failed-precondition", "This sale has no goods awaiting collection.");
    if (!location!.exists || location!.get("organizationId") !== actor.organizationId || location!.get("branchId") !== branchId || location!.get("status") !== "active")
      throw new HttpsError("failed-precondition", "The reserved stock location is unavailable.");
    assertAccountingPeriodOpen(periodSnapshot!);
    const balanceRefs = items.map((item) => db.doc(`inventoryBalances/${balanceDocumentId(actor.organizationId, String(item.get("productId")), location!.id)}`));
    if (new Set(balanceRefs.map((reference) => reference.path)).size !== balanceRefs.length)
      throw new HttpsError("failed-precondition", "Collect each product once per submission.");
    const balances = await transaction.getAll(...balanceRefs);
    const resolved = items.map((item, index) => {
      const quantity = input.lines[index]!.quantity;
      const collected = Number(item.get("collectedQuantity") ?? 0);
      const balance = balances[index]!;
      const reserved = Number(balance.get("reservedQuantity") ?? 0);
      if (!item.exists || item.get("organizationId") !== actor.organizationId || item.get("saleId") !== saleRef.id || item.get("trackingType") !== "quantity" || quantity > Number(item.get("quantity")) - collected)
        throw new HttpsError("failed-precondition", "A collection quantity exceeds the goods still awaiting collection.");
      if (!balance.exists || balance.get("organizationId") !== actor.organizationId || reserved < quantity || Number(balance.get("onHandQuantity")) < quantity)
        throw new HttpsError("failed-precondition", "Reserved stock is inconsistent; reconcile this location before release.");
      const issued = issueCost({ quantity: Number(balance.get("onHandQuantity")), totalValueMinor: Number(balance.get("totalValueMinor")), averageUnitCostMinor: Number(balance.get("averageUnitCostMinor")) }, quantity, quantity === Number(balance.get("onHandQuantity")) ? Number(balance.get("totalValueMinor")) : undefined);
      return { item, balance, quantity, collected, reserved, issued };
    });
    const totalQuantity = resolved.reduce((sum, line) => sum + line.quantity, 0);
    const cost = resolved.reduce((sum, line) => sum + line.issued.movementValueMinor, 0);
    const collectedQuantity = Number(sale!.get("collectedQuantity") ?? 0) + totalQuantity;
    const status = collectedQuantity === Number(sale!.get("totalQuantity")) ? "collected" : "partially_collected";
    const now = FieldValue.serverTimestamp();
    const year = effectiveAt.toDate().getUTCFullYear();
    const movementSequence = Number(inventorySequence!.get("value") ?? 0) + 1;
    const journalNumberSequence = Number(journalSequence!.get("value") ?? 0) + 1;
    const movementNumber = `INV-${year}-${String(movementSequence).padStart(6, "0")}`;
    const journalNumber = `JRN-${year}-${String(journalNumberSequence).padStart(6, "0")}`;
    const referenceNumber = String(sale!.get("saleNumber"));
    transaction.set(inventoryCounter, { organizationId: actor.organizationId, value: movementSequence, updatedAt: now }, { merge: true });
    transaction.create(movement, { organizationId: actor.organizationId, transactionNumber: movementNumber, transactionType: "customer_collection", status: "posted", sourceLocationId: location!.id, sourceBranchId: branchId, referenceType: "saleCollection", referenceId: collection.id, referenceNumber, effectiveAt, postedAt: now, postedBy: actor.userId, createdAt: now, createdBy: actor.userId, reason: "Customer physically collected reserved goods", idempotencyKey: input.idempotencyKey, correlationId: cid });
    resolved.forEach((line, index) => {
      transaction.update(itemRefs[index]!, { collectedQuantity: line.collected + line.quantity, costAmountMinor: Number(line.item.get("costAmountMinor") ?? 0) + line.issued.movementValueMinor, lastCollectionId: collection.id, updatedAt: now });
      transaction.update(balanceRefs[index]!, { onHandQuantity: line.issued.balance.quantity, reservedQuantity: line.reserved - line.quantity, availableQuantity: line.issued.balance.quantity - line.reserved + line.quantity, totalValueMinor: line.issued.balance.totalValueMinor, averageUnitCostMinor: line.issued.balance.averageUnitCostMinor, lastTransactionId: movement.id, lastMovementAt: effectiveAt, version: Number(line.balance.get("version") ?? 0) + 1, updatedAt: now });
      const base = { organizationId: actor.organizationId, transactionId: movement.id, transactionNumber: movementNumber, transactionType: "customer_collection", productId: line.item.get("productId"), sku: line.item.get("sku"), productName: line.item.get("productName"), trackingType: "quantity", unitCostMinor: line.issued.unitCostMinor, currency: "NGN", effectiveAt, postedBy: actor.userId, createdAt: now, reason: "Customer collection", referenceNumber };
      transaction.create(db.collection("inventoryEntries").doc(), { ...base, locationId: location!.id, branchId, quantityDelta: -line.quantity, reservedQuantityDelta: -line.quantity, valueDeltaMinor: -line.issued.movementValueMinor, balanceBefore: Number(line.balance.get("onHandQuantity")), balanceAfter: line.issued.balance.quantity });
      transaction.create(db.collection("inventoryEntries").doc(), { ...base, externalAccount: "customer_sales", counterpartyLocationId: location!.id, quantityDelta: line.quantity, valueDeltaMinor: line.issued.movementValueMinor, balanceBefore: 0, balanceAfter: 0 });
    });
    if (cost > 0) {
      const lines = [{ accountCode: "5000", accountName: "Cost of goods sold", debitMinor: cost, creditMinor: 0 }, { accountCode: "1200", accountName: "Inventory asset", debitMinor: 0, creditMinor: cost }];
      assertBalancedJournal(lines);
      transaction.set(journalCounter, { organizationId: actor.organizationId, value: journalNumberSequence, updatedAt: now }, { merge: true });
      transaction.create(journal, { organizationId: actor.organizationId, branchId, journalNumber, journalType: "customer_collection", status: "posted", referenceType: "saleCollection", referenceId: collection.id, referenceNumber, saleId: saleRef.id, inventoryTransactionId: movement.id, totalDebitMinor: cost, totalCreditMinor: cost, currency: "NGN", effectiveAt, postedAt: now, postedBy: actor.userId, createdAt: now, createdBy: actor.userId, correlationId: cid });
      lines.forEach((line) => {
        const accountId = uniquenessDocumentId(actor.organizationId, line.accountCode);
        transaction.set(db.doc(`chartOfAccounts/${accountId}`), { organizationId: actor.organizationId, code: line.accountCode, name: line.accountName, currency: "NGN", active: true, systemManaged: true, updatedAt: now }, { merge: true });
        transaction.create(db.collection("journalLines").doc(), { ...line, organizationId: actor.organizationId, branchId, journalEntryId: journal.id, journalNumber, accountId, currency: "NGN", effectiveAt, postedAt: now, createdAt: now });
      });
    }
    transaction.update(saleRef, { collectionStatus: status, collectedQuantity, costAmountMinor: Number(sale!.get("costAmountMinor") ?? 0) + cost, lastCollectionId: collection.id, lastCollectedAt: now, updatedAt: now });
    transaction.create(collection, { organizationId: actor.organizationId, branchId, saleId: saleRef.id, referenceNumber, customerId: sale!.get("customerId") ?? null, customerName: sale!.get("customerName") ?? "Walk-in customer", collector: input.collector, notes: input.notes ?? null, lines: resolved.map((line) => ({ saleItemId: line.item.id, productId: line.item.get("productId"), productName: line.item.get("productName"), quantity: line.quantity, costAmountMinor: line.issued.movementValueMinor })), totalQuantity, costAmountMinor: cost, inventoryTransactionId: movement.id, journalEntryId: cost > 0 ? journal.id : null, collectedAt: now, releasedBy: actor.userId, correlationId: cid });
    transaction.create(operation, { organizationId: actor.organizationId, saleId: saleRef.id, entityId: collection.id, collectionStatus: status, createdAt: now });
    writeAuditLog(transaction, actor, { action: "sale.goods_collected", entityType: "saleCollection", entityId: collection.id, sourceFunction: "confirmPosSaleOrder", correlationId: cid, reason: "Physical collection", before: { collectionStatus: sale!.get("collectionStatus"), collectedQuantity: sale!.get("collectedQuantity") }, after: { saleId: saleRef.id, branchId, referenceNumber, collector: input.collector, totalQuantity, collectionStatus: status, inventoryTransactionId: movement.id, journalEntryId: cost > 0 ? journal.id : null } });
    result = { saleId: saleRef.id, collectionId: collection.id, collectionStatus: status, recorded: true };
  });
  return result;
}
