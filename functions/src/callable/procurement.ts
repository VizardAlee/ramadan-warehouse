import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { hasRole, hasServerPermission, requireAccess, requirePermission, requireWarehouseScope } from "../auth/authorize.js";
import { enforceAppCheck } from "../config.js";
import { normalizeInventoryIdentifier, uniquenessDocumentId } from "../inventory/calculations.js";
import { postInventoryTransaction } from "../inventory/post-inventory-transaction.js";
import { assertBalancedJournal } from "../sales/calculations.js";
import { correlationId, parseInput } from "../utils/callable.js";
import {
  createPurchaseOrderInput,
  procurementWorkspaceInput,
  purchaseOrderActionInput,
  receivePurchaseOrderItemInput,
  recordSupplierPaymentInput,
  saveSupplierInput,
  submitSupplierInvoiceInput,
  supplierInvoiceActionInput,
} from "../validation/procurement.js";

const accountNames: Readonly<Record<string, string>> = {
  "1010": "Cash on hand",
  "1020": "Card clearing",
  "1030": "Bank transfer clearing",
  "1200": "Inventory asset",
  "1300": "Input VAT recoverable",
  "2000": "Accounts payable",
};
const paymentAccounts: Readonly<Record<string, string>> = {
  cash: "1010",
  card: "1020",
  bank_transfer: "1030",
};
function clean(values: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== ""));
}
function year() { return new Date().getUTCFullYear(); }
function sequenceNumber(prefix: string, sequence: number) {
  return `${prefix}-${year()}-${String(sequence).padStart(6, "0")}`;
}
function invoiceCounterId(organizationId: string, purchaseOrderItemId: string) {
  return uniquenessDocumentId(organizationId, "purchaseInvoiceItem", purchaseOrderItemId);
}
function journalLines(netAmountMinor: number, vatAmountMinor: number, creditAccount: string) {
  const lines = [
    { accountCode: "1200", debitMinor: netAmountMinor, creditMinor: 0 },
    { accountCode: "1300", debitMinor: vatAmountMinor, creditMinor: 0 },
    { accountCode: creditAccount, debitMinor: 0, creditMinor: netAmountMinor + vatAmountMinor },
  ].filter((line) => line.debitMinor || line.creditMinor);
  assertBalancedJournal(lines);
  return lines;
}
function writeJournal(
  transaction: FirebaseFirestore.Transaction,
  actor: Awaited<ReturnType<typeof requireAccess>>,
  values: {
    journal: FirebaseFirestore.DocumentReference;
    journalCounter: FirebaseFirestore.DocumentReference;
    journalCounterValue: number;
    journalType: string;
    referenceType: string;
    referenceId: string;
    referenceNumber: string;
    description: string;
    warehouseId?: string;
    effectiveAt: Timestamp;
    lines: Array<{ accountCode: string; debitMinor: number; creditMinor: number }>;
  },
) {
  const now = FieldValue.serverTimestamp();
  const journalNumber = sequenceNumber("JRN", values.journalCounterValue);
  transaction.set(values.journalCounter, { organizationId: actor.organizationId, kind: "journalEntry", value: values.journalCounterValue, updatedAt: now });
  transaction.create(values.journal, clean({
    organizationId: actor.organizationId,
    warehouseId: values.warehouseId,
    journalNumber,
    journalType: values.journalType,
    status: "posted",
    referenceType: values.referenceType,
    referenceId: values.referenceId,
    referenceNumber: values.referenceNumber,
    description: values.description,
    totalDebitMinor: values.lines.reduce((sum, line) => sum + line.debitMinor, 0),
    totalCreditMinor: values.lines.reduce((sum, line) => sum + line.creditMinor, 0),
    currency: "NGN",
    effectiveAt: values.effectiveAt,
    postedAt: now,
    postedBy: actor.userId,
    createdAt: now,
  }));
  for (const line of values.lines) {
    const account = db.doc(`chartOfAccounts/${uniquenessDocumentId(actor.organizationId, line.accountCode)}`);
    transaction.set(account, { organizationId: actor.organizationId, code: line.accountCode, name: accountNames[line.accountCode], currency: "NGN", active: true, systemManaged: true, updatedAt: now }, { merge: true });
    transaction.create(db.collection("journalLines").doc(), clean({
      organizationId: actor.organizationId,
      warehouseId: values.warehouseId,
      journalEntryId: values.journal.id,
      journalNumber,
      accountId: account.id,
      accountCode: line.accountCode,
      accountName: accountNames[line.accountCode],
      debitMinor: line.debitMinor,
      creditMinor: line.creditMinor,
      currency: "NGN",
      effectiveAt: values.effectiveAt,
      createdAt: now,
    }));
  }
  return journalNumber;
}

export const saveSupplier = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request);
  requirePermission(actor, "suppliers.manage");
  const input = parseInput(saveSupplierInput, request.data);
  const supplier = input.supplierId ? db.doc(`suppliers/${input.supplierId}`) : db.collection("suppliers").doc();
  const code = db.doc(`supplierCodes/${uniquenessDocumentId(actor.organizationId, normalizeInventoryIdentifier(input.name))}`);
  const counter = db.doc(`supplierCounters/${actor.organizationId}`);
  const operation = db.doc(`idempotencyKeys/${actor.organizationId}_saveSupplier_${input.idempotencyKey}`);
  let result = { supplierId: supplier.id, supplierNumber: "", saved: true };
  await db.runTransaction(async (transaction) => {
    const snapshots = await transaction.getAll(operation, supplier, code, counter);
    const previous = snapshots[0]!, current = snapshots[1]!, unique = snapshots[2]!, counterSnapshot = snapshots[3]!;
    if (previous.exists) { result = { supplierId: String(previous.get("entityId")), supplierNumber: String(previous.get("supplierNumber")), saved: false }; return; }
    if (current.exists && current.get("organizationId") !== actor.organizationId) throw new HttpsError("permission-denied", "Supplier is unavailable.");
    if (unique.exists && unique.get("supplierId") !== supplier.id) throw new HttpsError("already-exists", "A supplier with this name already exists.");
    const sequence = current.exists ? Number(current.get("sequence")) : Number(counterSnapshot.get("value") ?? 0) + 1;
    const supplierNumber = current.exists ? String(current.get("supplierNumber")) : sequenceNumber("SUP", sequence);
    const now = FieldValue.serverTimestamp();
    if (!current.exists) transaction.set(counter, { organizationId: actor.organizationId, value: sequence, updatedAt: now }, { merge: true });
    transaction.set(code, { organizationId: actor.organizationId, supplierId: supplier.id, normalizedName: normalizeInventoryIdentifier(input.name), updatedAt: now });
    transaction.set(supplier, clean({
      organizationId: actor.organizationId, supplierNumber, sequence, name: input.name,
      phone: input.phone, email: input.email, address: input.address, taxId: input.taxId,
      paymentTermsDays: input.paymentTermsDays, active: input.active,
      outstandingBalanceMinor: Number(current.get("outstandingBalanceMinor") ?? 0), currency: "NGN",
      createdAt: current.exists ? current.get("createdAt") : now,
      createdBy: current.exists ? current.get("createdBy") : actor.userId,
      updatedAt: now, updatedBy: actor.userId,
    }), { merge: true });
    transaction.create(operation, { organizationId: actor.organizationId, action: "saveSupplier", entityId: supplier.id, supplierNumber, status: "completed", createdAt: now, createdBy: actor.userId });
    writeAuditLog(transaction, actor, { action: current.exists ? "supplier.updated" : "supplier.created", entityType: "supplier", entityId: supplier.id, correlationId: correlationId(), sourceFunction: "saveSupplier", after: { supplierNumber, name: input.name, active: input.active } });
    result = { supplierId: supplier.id, supplierNumber, saved: true };
  });
  return result;
});

export const getProcurementWorkspace = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request);
  requirePermission(actor, "procurement.read");
  const input = parseInput(procurementWorkspaceInput, request.data);
  if (input.warehouseId) requireWarehouseScope(actor, input.warehouseId);
  const purchaseOrdersQuery = input.warehouseId
    ? db.collection("purchaseOrders").where("organizationId", "==", actor.organizationId).where("warehouseId", "==", input.warehouseId).limit(input.limit)
    : db.collection("purchaseOrders").where("organizationId", "==", actor.organizationId).limit(input.limit);
  const purchaseItemsQuery = input.warehouseId
    ? db.collection("purchaseOrderItems").where("organizationId", "==", actor.organizationId).where("warehouseId", "==", input.warehouseId).limit(500)
    : db.collection("purchaseOrderItems").where("organizationId", "==", actor.organizationId).limit(500);
  const invoicesQuery = input.warehouseId
    ? db.collection("supplierInvoices").where("organizationId", "==", actor.organizationId).where("warehouseId", "==", input.warehouseId).limit(input.limit)
    : db.collection("supplierInvoices").where("organizationId", "==", actor.organizationId).limit(input.limit);
  const [suppliers, warehouses, locations, products, purchaseOrders, purchaseOrderItems, invoices] = await Promise.all([
    db.collection("suppliers").where("organizationId", "==", actor.organizationId).where("active", "==", true).limit(200).get(),
    db.collection("warehouses").where("organizationId", "==", actor.organizationId).where("status", "==", "active").limit(100).get(),
    db.collection("inventoryLocations").where("organizationId", "==", actor.organizationId).where("status", "==", "active").limit(300).get(),
    db.collection("products").where("organizationId", "==", actor.organizationId).where("active", "==", true).limit(500).get(),
    purchaseOrdersQuery.get(), purchaseItemsQuery.get(), invoicesQuery.get(),
  ]);
  const visibleWarehouseIds = hasRole(actor, "system_administrator") || hasRole(actor, "operations_administrator") || hasRole(actor, "finance_officer") || hasRole(actor, "auditor")
    ? null : new Set(actor.warehouseIds);
  const visible = (warehouseId: unknown) => !visibleWarehouseIds || visibleWarehouseIds.has(String(warehouseId));
  return {
    suppliers: suppliers.docs.map((document) => ({ id: document.id, ...document.data() })),
    warehouses: warehouses.docs.filter((document) => visible(document.id)).map((document) => ({ id: document.id, name: document.get("name"), code: document.get("code") })),
    locations: locations.docs.filter((document) => document.get("warehouseId") && visible(document.get("warehouseId"))).map((document) => ({ id: document.id, warehouseId: document.get("warehouseId"), name: document.get("name"), code: document.get("code") })),
    products: products.docs.map((document) => ({ id: document.id, name: document.get("name"), sku: document.get("sku"), trackingType: document.get("trackingType"), unitOfMeasure: document.get("unitOfMeasure") })),
    purchaseOrders: purchaseOrders.docs.filter((document) => visible(document.get("warehouseId"))).map((document) => ({ id: document.id, ...document.data() })),
    purchaseOrderItems: purchaseOrderItems.docs.filter((document) => visible(document.get("warehouseId"))).map((document) => ({ id: document.id, ...document.data() })),
    supplierInvoices: hasServerPermission(actor, "payables.read") ? invoices.docs.filter((document) => visible(document.get("warehouseId"))).map((document) => ({ id: document.id, ...document.data() })) : [],
  };
});

export const createPurchaseOrder = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request);
  requirePermission(actor, "procurement.create");
  const input = parseInput(createPurchaseOrderInput, request.data);
  requireWarehouseScope(actor, input.warehouseId);
  const supplier = db.doc(`suppliers/${input.supplierId}`), warehouse = db.doc(`warehouses/${input.warehouseId}`), receivingLocation = db.doc(`inventoryLocations/${input.receivingLocationId}`);
  const products = input.lines.map((line) => db.doc(`products/${line.productId}`));
  const counter = db.doc(`purchaseOrderCounters/${actor.organizationId}`), purchaseOrder = db.collection("purchaseOrders").doc();
  const operation = db.doc(`idempotencyKeys/${actor.organizationId}_createPurchaseOrder_${input.idempotencyKey}`);
  let result = { purchaseOrderId: purchaseOrder.id, purchaseOrderNumber: "", created: true };
  await db.runTransaction(async (transaction) => {
    const snapshots = await transaction.getAll(operation, supplier, warehouse, receivingLocation, counter, ...products);
    let cursor = 0; const previous = snapshots[cursor++]!, supplierSnapshot = snapshots[cursor++]!, warehouseSnapshot = snapshots[cursor++]!, locationSnapshot = snapshots[cursor++]!, counterSnapshot = snapshots[cursor++]!;
    if (previous.exists) { result = { purchaseOrderId: String(previous.get("entityId")), purchaseOrderNumber: String(previous.get("purchaseOrderNumber")), created: false }; return; }
    if (!supplierSnapshot.exists || supplierSnapshot.get("organizationId") !== actor.organizationId || supplierSnapshot.get("active") !== true) throw new HttpsError("failed-precondition", "Select an active supplier.");
    if (!warehouseSnapshot.exists || warehouseSnapshot.get("organizationId") !== actor.organizationId || warehouseSnapshot.get("status") !== "active") throw new HttpsError("failed-precondition", "Warehouse is unavailable.");
    if (!locationSnapshot.exists || locationSnapshot.get("organizationId") !== actor.organizationId || locationSnapshot.get("warehouseId") !== input.warehouseId || locationSnapshot.get("status") !== "active") throw new HttpsError("failed-precondition", "Select an active stock location inside the warehouse.");
    const productSnapshots = snapshots.slice(cursor);
    const calculated = input.lines.map((line, index) => {
      const product = productSnapshots[index]!;
      if (!product.exists || product.get("organizationId") !== actor.organizationId || product.get("active") !== true) throw new HttpsError("failed-precondition", "A purchase product is unavailable.");
      const net = line.quantity * line.unitCostMinor, vat = Math.round(net * line.vatRateBasisPoints / 10_000);
      return { line, product, net, vat, gross: net + vat };
    });
    const sequence = Number(counterSnapshot.get("value") ?? 0) + 1, purchaseOrderNumber = sequenceNumber(`PO-${String(warehouseSnapshot.get("code"))}`, sequence), now = FieldValue.serverTimestamp();
    const total = (key: "net" | "vat" | "gross") => calculated.reduce((sum, line) => sum + line[key], 0);
    transaction.set(counter, { organizationId: actor.organizationId, value: sequence, updatedAt: now }, { merge: true });
    transaction.create(purchaseOrder, clean({ organizationId: actor.organizationId, purchaseOrderNumber, sequence, supplierId: supplier.id, supplierNumber: supplierSnapshot.get("supplierNumber"), supplierName: supplierSnapshot.get("name"), warehouseId: warehouse.id, warehouseName: warehouseSnapshot.get("name"), receivingLocationId: receivingLocation.id, receivingLocationName: locationSnapshot.get("name"), status: "draft", expectedAt: input.expectedAt ? Timestamp.fromDate(new Date(input.expectedAt)) : undefined, notes: input.notes, netAmountMinor: total("net"), vatAmountMinor: total("vat"), grossAmountMinor: total("gross"), receivedNetAmountMinor: 0, invoicedNetAmountMinor: 0, currency: "NGN", createdAt: now, createdBy: actor.userId, updatedAt: now }));
    for (const line of calculated) transaction.create(db.collection("purchaseOrderItems").doc(), { organizationId: actor.organizationId, purchaseOrderId: purchaseOrder.id, purchaseOrderNumber, supplierId: supplier.id, warehouseId: warehouse.id, productId: line.product.id, sku: line.product.get("sku"), productName: line.product.get("name"), trackingType: line.product.get("trackingType"), unitOfMeasure: line.product.get("unitOfMeasure"), orderedQuantity: line.line.quantity, receivedQuantity: 0, unitCostMinor: line.line.unitCostMinor, vatRateBasisPoints: line.line.vatRateBasisPoints, netAmountMinor: line.net, vatAmountMinor: line.vat, grossAmountMinor: line.gross, currency: "NGN", createdAt: now });
    transaction.create(operation, { organizationId: actor.organizationId, action: "createPurchaseOrder", entityId: purchaseOrder.id, purchaseOrderNumber, status: "completed", createdAt: now, createdBy: actor.userId });
    writeAuditLog(transaction, actor, { action: "purchase_order.created", entityType: "purchaseOrder", entityId: purchaseOrder.id, correlationId: correlationId(), sourceFunction: "createPurchaseOrder", after: { purchaseOrderNumber, supplierId: supplier.id, warehouseId: warehouse.id, grossAmountMinor: total("gross") } });
    result = { purchaseOrderId: purchaseOrder.id, purchaseOrderNumber, created: true };
  });
  return result;
});

async function purchaseOrderStatusAction(request: Parameters<typeof requireAccess>[0], action: "submit" | "approve") {
  const actor = await requireAccess(request); requirePermission(actor, action === "submit" ? "procurement.create" : "procurement.approve");
  const input = parseInput(purchaseOrderActionInput, request.data), purchaseOrder = db.doc(`purchaseOrders/${input.purchaseOrderId}`);
  const initial = await purchaseOrder.get();
  if (!initial.exists || initial.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Purchase order not found.");
  requireWarehouseScope(actor, String(initial.get("warehouseId")));
  const operation = db.doc(`idempotencyKeys/${actor.organizationId}_${action}PurchaseOrder_${input.idempotencyKey}`);
  await db.runTransaction(async (transaction) => {
    const snapshots = await transaction.getAll(operation, purchaseOrder), previous = snapshots[0]!, current = snapshots[1]!; if (previous.exists) return;
    const expected = action === "submit" ? "draft" : "submitted";
    if (!current.exists || current.get("status") !== expected) throw new HttpsError("failed-precondition", `Only a ${expected} purchase order can be ${action === "submit" ? "submitted" : "approved"}.`);
    if (action === "approve" && current.get("createdBy") === actor.userId) throw new HttpsError("permission-denied", "The purchase-order creator cannot approve their own order.", { code: "PURCHASE_ORDER_SELF_APPROVAL_FORBIDDEN" });
    const now = FieldValue.serverTimestamp(), next = action === "submit" ? "submitted" : "approved";
    transaction.update(purchaseOrder, clean({ status: next, [`${action}tedAt`]: now, [`${action}tedBy`]: actor.userId, approvalNotes: action === "approve" ? input.notes : undefined, updatedAt: now }));
    transaction.create(operation, { organizationId: actor.organizationId, action: `${action}PurchaseOrder`, entityId: purchaseOrder.id, status: "completed", createdAt: now, createdBy: actor.userId });
    writeAuditLog(transaction, actor, { action: `purchase_order.${next}`, entityType: "purchaseOrder", entityId: purchaseOrder.id, correlationId: correlationId(), sourceFunction: `${action}PurchaseOrder`, after: { status: next } });
  });
  return { purchaseOrderId: purchaseOrder.id, status: action === "submit" ? "submitted" : "approved" };
}
export const submitPurchaseOrder = onCall({ enforceAppCheck }, (request) => purchaseOrderStatusAction(request, "submit"));
export const approvePurchaseOrder = onCall({ enforceAppCheck }, (request) => purchaseOrderStatusAction(request, "approve"));

export const receivePurchaseOrderItem = onCall({ enforceAppCheck, timeoutSeconds: 60 }, async (request) => {
  const actor = await requireAccess(request); requirePermission(actor, "procurement.receive");
  const input = parseInput(receivePurchaseOrderItemInput, request.data), purchaseOrder = db.doc(`purchaseOrders/${input.purchaseOrderId}`), item = db.doc(`purchaseOrderItems/${input.purchaseOrderItemId}`);
  const operation = db.doc(`idempotencyKeys/${actor.organizationId}_receivePurchaseOrderItem_${input.idempotencyKey}`);
  const priorOperation = await operation.get();
  if (priorOperation.exists) return { receiptId: String(priorOperation.get("receiptId")), inventoryTransactionId: String(priorOperation.get("inventoryTransactionId")), posted: false };
  const [orderSnapshot, itemSnapshot] = await Promise.all([purchaseOrder.get(), item.get()]);
  if (!orderSnapshot.exists || orderSnapshot.get("organizationId") !== actor.organizationId || !["approved", "partially_received"].includes(String(orderSnapshot.get("status")))) throw new HttpsError("failed-precondition", "Only an approved open purchase order can be received.");
  requireWarehouseScope(actor, String(orderSnapshot.get("warehouseId")));
  if (!itemSnapshot.exists || itemSnapshot.get("purchaseOrderId") !== purchaseOrder.id) throw new HttpsError("invalid-argument", "Purchase-order item is unavailable.");
  const receipt = db.collection("purchaseReceipts").doc();
  let previousReceipt: { receiptId: string; inventoryTransactionId: string; posted: boolean } | null = null;
  await db.runTransaction(async (transaction) => {
    const snapshots = await transaction.getAll(operation, item), previous = snapshots[0]!, current = snapshots[1]!;
    if (previous.exists) { previousReceipt = { receiptId: String(previous.get("receiptId")), inventoryTransactionId: String(previous.get("inventoryTransactionId")), posted: false }; return; }
    if (!current.exists || current.get("purchaseOrderId") !== purchaseOrder.id) throw new HttpsError("failed-precondition", "Purchase-order item changed.");
    const inProgress = current.get("receiptInProgressKey");
    if (inProgress && inProgress !== input.idempotencyKey) throw new HttpsError("aborted", "Another receipt is already being posted for this item.");
    const remaining = Number(current.get("orderedQuantity")) - Number(current.get("receivedQuantity") ?? 0);
    if (input.quantity > remaining) throw new HttpsError("failed-precondition", "Receipt quantity exceeds the outstanding ordered quantity.");
    transaction.update(item, { receiptInProgressKey: input.idempotencyKey, updatedAt: FieldValue.serverTimestamp() });
  });
  if (previousReceipt) return previousReceipt;
  let inventoryResult: Awaited<ReturnType<typeof postInventoryTransaction>>;
  try {
    inventoryResult = await postInventoryTransaction(actor, {
      transactionType: "inventory_receipt", productId: String(itemSnapshot.get("productId")), quantity: input.quantity,
      destinationLocationId: String(orderSnapshot.get("receivingLocationId")), externalAccount: `supplier:${String(orderSnapshot.get("supplierId"))}`,
      unitCostMinor: Number(itemSnapshot.get("unitCostMinor")), serialNumbers: input.serialNumbers,
      lot: input.lot ? { ...input.lot, supplierReference: input.supplierReference } : undefined,
      effectiveAt: input.receivedAt, reason: `Purchase receipt ${String(orderSnapshot.get("purchaseOrderNumber"))}`,
      notes: input.notes, referenceType: "purchase_order", referenceId: purchaseOrder.id, referenceNumber: String(orderSnapshot.get("purchaseOrderNumber")),
      idempotencyKey: `purchase-${input.idempotencyKey}`, correlationId: correlationId(), sourceFunction: "receivePurchaseOrderItem",
    });
  } catch (error) {
    await db.runTransaction(async (transaction) => { const current = await transaction.get(item); if (current.get("receiptInProgressKey") === input.idempotencyKey) transaction.update(item, { receiptInProgressKey: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() }); });
    throw error;
  }
  let result = { receiptId: receipt.id, inventoryTransactionId: inventoryResult.transactionId, posted: true };
  const allItems = await db.collection("purchaseOrderItems").where("purchaseOrderId", "==", purchaseOrder.id).get();
  await db.runTransaction(async (transaction) => {
    const refs = allItems.docs.map((document) => document.ref), snapshots = await transaction.getAll(operation, purchaseOrder, ...refs);
    let cursor = 0; const previous = snapshots[cursor++]!, currentOrder = snapshots[cursor++]!, currentItems = snapshots.slice(cursor);
    if (previous.exists) { result = { receiptId: String(previous.get("receiptId")), inventoryTransactionId: String(previous.get("inventoryTransactionId")), posted: false }; return; }
    const targetIndex = refs.findIndex((reference) => reference.id === item.id), target = currentItems[targetIndex]!;
    if (!target.exists || target.get("receiptInProgressKey") !== input.idempotencyKey) throw new HttpsError("aborted", "Purchase receipt finalization lost its item lock.");
    const nextReceived = Number(target.get("receivedQuantity") ?? 0) + input.quantity;
    transaction.update(item, { receivedQuantity: nextReceived, receiptInProgressKey: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
    const complete = currentItems.every((snapshot, index) => Number(snapshot.get("receivedQuantity") ?? 0) + (index === targetIndex ? input.quantity : 0) >= Number(snapshot.get("orderedQuantity")));
    const netReceived = input.quantity * Number(target.get("unitCostMinor")), now = FieldValue.serverTimestamp();
    transaction.update(purchaseOrder, { status: complete ? "received" : "partially_received", receivedNetAmountMinor: Number(currentOrder.get("receivedNetAmountMinor") ?? 0) + netReceived, updatedAt: now });
    transaction.create(receipt, clean({ organizationId: actor.organizationId, purchaseOrderId: purchaseOrder.id, purchaseOrderNumber: currentOrder.get("purchaseOrderNumber"), purchaseOrderItemId: item.id, supplierId: currentOrder.get("supplierId"), warehouseId: currentOrder.get("warehouseId"), receivingLocationId: currentOrder.get("receivingLocationId"), productId: target.get("productId"), sku: target.get("sku"), productName: target.get("productName"), quantity: input.quantity, unitCostMinor: target.get("unitCostMinor"), netAmountMinor: netReceived, supplierReference: input.supplierReference, inventoryTransactionId: inventoryResult.transactionId, receivedAt: Timestamp.fromDate(new Date(input.receivedAt)), receivedBy: actor.userId, createdAt: now }));
    transaction.create(operation, { organizationId: actor.organizationId, action: "receivePurchaseOrderItem", entityId: purchaseOrder.id, receiptId: receipt.id, inventoryTransactionId: inventoryResult.transactionId, status: "completed", createdAt: now, createdBy: actor.userId });
    writeAuditLog(transaction, actor, { action: "purchase_order.received", entityType: "purchaseOrder", entityId: purchaseOrder.id, correlationId: correlationId(), sourceFunction: "receivePurchaseOrderItem", after: { purchaseOrderItemId: item.id, quantity: input.quantity, inventoryTransactionId: inventoryResult.transactionId } });
  });
  return result;
});

export const submitSupplierInvoice = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request); requirePermission(actor, "payables.create");
  const input = parseInput(submitSupplierInvoiceInput, request.data), purchaseOrder = db.doc(`purchaseOrders/${input.purchaseOrderId}`);
  const order = await purchaseOrder.get(); if (!order.exists || order.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Purchase order not found.");
  requireWarehouseScope(actor, String(order.get("warehouseId")));
  const itemRefs = input.lines.map((line) => db.doc(`purchaseOrderItems/${line.purchaseOrderItemId}`));
  const counterRefs = input.lines.map((line) => db.doc(`purchaseInvoiceItemCounters/${invoiceCounterId(actor.organizationId, line.purchaseOrderItemId)}`));
  const invoice = db.collection("supplierInvoices").doc(), operation = db.doc(`idempotencyKeys/${actor.organizationId}_submitSupplierInvoice_${input.idempotencyKey}`);
  const uniqueness = db.doc(`supplierInvoiceCodes/${uniquenessDocumentId(actor.organizationId, String(order.get("supplierId")), normalizeInventoryIdentifier(input.supplierInvoiceNumber))}`);
  let result = { supplierInvoiceId: invoice.id, submitted: true };
  await db.runTransaction(async (transaction) => {
    const snapshots = await transaction.getAll(operation, uniqueness, ...itemRefs, ...counterRefs); const previous = snapshots[0]!, unique = snapshots[1]!;
    if (previous.exists) { result = { supplierInvoiceId: String(previous.get("entityId")), submitted: false }; return; }
    if (unique.exists) throw new HttpsError("already-exists", "This supplier invoice number has already been recorded.");
    const items = snapshots.slice(2, 2 + itemRefs.length), counters = snapshots.slice(2 + itemRefs.length);
    const calculated = input.lines.map((line, index) => { const itemSnapshot = items[index]!; if (!itemSnapshot.exists || itemSnapshot.get("purchaseOrderId") !== purchaseOrder.id) throw new HttpsError("invalid-argument", "An invoice line does not belong to this purchase order."); const available = Number(itemSnapshot.get("receivedQuantity") ?? 0) - Number(counters[index]!.get("invoicedQuantity") ?? 0); if (line.quantity > available) throw new HttpsError("failed-precondition", "Invoice quantity exceeds received uninvoiced goods."); const net = line.quantity * Number(itemSnapshot.get("unitCostMinor")), vat = Math.round(net * Number(itemSnapshot.get("vatRateBasisPoints")) / 10_000); return { line, itemSnapshot, net, vat, gross: net + vat }; });
    const net = calculated.reduce((sum, line) => sum + line.net, 0), vat = calculated.reduce((sum, line) => sum + line.vat, 0), now = FieldValue.serverTimestamp();
    transaction.create(invoice, clean({ organizationId: actor.organizationId, supplierId: order.get("supplierId"), supplierNumber: order.get("supplierNumber"), supplierName: order.get("supplierName"), purchaseOrderId: purchaseOrder.id, purchaseOrderNumber: order.get("purchaseOrderNumber"), warehouseId: order.get("warehouseId"), supplierInvoiceNumber: input.supplierInvoiceNumber, invoiceDate: input.invoiceDate, dueDate: input.dueDate, status: "submitted", netAmountMinor: net, vatAmountMinor: vat, grossAmountMinor: net + vat, outstandingAmountMinor: net + vat, currency: "NGN", notes: input.notes, createdAt: now, createdBy: actor.userId, submittedAt: now }));
    for (const line of calculated) transaction.create(db.collection("supplierInvoiceItems").doc(), { organizationId: actor.organizationId, supplierInvoiceId: invoice.id, purchaseOrderId: purchaseOrder.id, purchaseOrderItemId: line.itemSnapshot.id, warehouseId: order.get("warehouseId"), productId: line.itemSnapshot.get("productId"), sku: line.itemSnapshot.get("sku"), productName: line.itemSnapshot.get("productName"), quantity: line.line.quantity, unitCostMinor: line.itemSnapshot.get("unitCostMinor"), vatRateBasisPoints: line.itemSnapshot.get("vatRateBasisPoints"), netAmountMinor: line.net, vatAmountMinor: line.vat, grossAmountMinor: line.gross, currency: "NGN", createdAt: now });
    transaction.create(uniqueness, { organizationId: actor.organizationId, supplierId: order.get("supplierId"), supplierInvoiceId: invoice.id, normalizedInvoiceNumber: normalizeInventoryIdentifier(input.supplierInvoiceNumber), createdAt: now });
    transaction.create(operation, { organizationId: actor.organizationId, action: "submitSupplierInvoice", entityId: invoice.id, status: "completed", createdAt: now, createdBy: actor.userId });
    writeAuditLog(transaction, actor, { action: "supplier_invoice.submitted", entityType: "supplierInvoice", entityId: invoice.id, correlationId: correlationId(), sourceFunction: "submitSupplierInvoice", after: { purchaseOrderId: purchaseOrder.id, supplierInvoiceNumber: input.supplierInvoiceNumber, grossAmountMinor: net + vat } });
  });
  return result;
});

export const approveSupplierInvoice = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request); requirePermission(actor, "payables.approve"); const input = parseInput(supplierInvoiceActionInput, request.data);
  const invoice = db.doc(`supplierInvoices/${input.supplierInvoiceId}`), initial = await invoice.get(); if (!initial.exists || initial.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Supplier invoice not found.");
  requireWarehouseScope(actor, String(initial.get("warehouseId")));
  const invoiceItems = await db.collection("supplierInvoiceItems").where("supplierInvoiceId", "==", invoice.id).get();
  const counterRefs = invoiceItems.docs.map((line) => db.doc(`purchaseInvoiceItemCounters/${invoiceCounterId(actor.organizationId, String(line.get("purchaseOrderItemId")))}`));
  const itemRefs = invoiceItems.docs.map((line) => db.doc(`purchaseOrderItems/${line.get("purchaseOrderItemId")}`));
  const supplier = db.doc(`suppliers/${initial.get("supplierId")}`), purchaseOrder = db.doc(`purchaseOrders/${initial.get("purchaseOrderId")}`), operation = db.doc(`idempotencyKeys/${actor.organizationId}_approveSupplierInvoice_${input.idempotencyKey}`), journalCounter = db.doc(`journalCounters/${uniquenessDocumentId(actor.organizationId, "general")}`), journal = db.collection("journalEntries").doc();
  await db.runTransaction(async (transaction) => {
    const snapshots = await transaction.getAll(operation, invoice, supplier, purchaseOrder, journalCounter, ...itemRefs, ...counterRefs); let cursor = 0;
    const previous = snapshots[cursor++]!, current = snapshots[cursor++]!, supplierSnapshot = snapshots[cursor++]!, order = snapshots[cursor++]!, journalCounterSnapshot = snapshots[cursor++]!;
    if (previous.exists) return; if (!current.exists || current.get("status") !== "submitted") throw new HttpsError("failed-precondition", "Only a submitted supplier invoice can be approved.");
    if (current.get("createdBy") === actor.userId) throw new HttpsError("permission-denied", "The invoice creator cannot approve their own invoice.", { code: "SUPPLIER_INVOICE_SELF_APPROVAL_FORBIDDEN" });
    if (!supplierSnapshot.exists || supplierSnapshot.get("organizationId") !== actor.organizationId) throw new HttpsError("failed-precondition", "Supplier is unavailable.");
    const items = snapshots.slice(cursor, cursor += itemRefs.length), counters = snapshots.slice(cursor);
    invoiceItems.docs.forEach((line, index) => { const orderedItem = items[index]!, counter = counters[index]!, quantity = Number(line.get("quantity")); if (!orderedItem.exists || orderedItem.get("purchaseOrderId") !== order.id || quantity > Number(orderedItem.get("receivedQuantity") ?? 0) - Number(counter.get("invoicedQuantity") ?? 0)) throw new HttpsError("failed-precondition", "An invoice quantity is no longer available for approval."); });
    const now = FieldValue.serverTimestamp(), effectiveAt = Timestamp.fromDate(new Date(String(current.get("invoiceDate")))), gross = Number(current.get("grossAmountMinor"));
    const lines = journalLines(Number(current.get("netAmountMinor")), Number(current.get("vatAmountMinor")), "2000");
    writeJournal(transaction, actor, { journal, journalCounter, journalCounterValue: Number(journalCounterSnapshot.get("value") ?? 0) + 1, journalType: "supplier_invoice", referenceType: "supplierInvoice", referenceId: invoice.id, referenceNumber: String(current.get("supplierInvoiceNumber")), description: `Supplier invoice ${String(current.get("supplierInvoiceNumber"))}`, warehouseId: String(current.get("warehouseId")), effectiveAt, lines });
    transaction.update(invoice, { status: "approved", approvedAt: now, approvedBy: actor.userId, approvalNotes: input.notes ?? null, journalEntryId: journal.id, updatedAt: now });
    invoiceItems.docs.forEach((line, index) => {
      const nextInvoiced = Number(counters[index]!.get("invoicedQuantity") ?? 0) + Number(line.get("quantity"));
      transaction.set(counterRefs[index]!, { organizationId: actor.organizationId, purchaseOrderId: order.id, purchaseOrderItemId: line.get("purchaseOrderItemId"), invoicedQuantity: nextInvoiced, updatedAt: now }, { merge: true });
      transaction.update(itemRefs[index]!, { invoicedQuantity: nextInvoiced, updatedAt: now });
    });
    transaction.update(supplier, { outstandingBalanceMinor: Number(supplierSnapshot.get("outstandingBalanceMinor") ?? 0) + gross, updatedAt: now, updatedBy: actor.userId });
    transaction.update(purchaseOrder, { invoicedNetAmountMinor: Number(order.get("invoicedNetAmountMinor") ?? 0) + Number(current.get("netAmountMinor")), updatedAt: now });
    transaction.create(db.collection("supplierAccountEntries").doc(), { organizationId: actor.organizationId, supplierId: supplier.id, warehouseId: current.get("warehouseId"), entryType: "supplier_invoice", referenceType: "supplierInvoice", referenceId: invoice.id, referenceNumber: current.get("supplierInvoiceNumber"), amountMinor: gross, balanceAfterMinor: Number(supplierSnapshot.get("outstandingBalanceMinor") ?? 0) + gross, currency: "NGN", effectiveAt, createdAt: now, createdBy: actor.userId });
    transaction.create(operation, { organizationId: actor.organizationId, action: "approveSupplierInvoice", entityId: invoice.id, status: "completed", createdAt: now, createdBy: actor.userId });
    writeAuditLog(transaction, actor, { action: "supplier_invoice.approved", entityType: "supplierInvoice", entityId: invoice.id, correlationId: correlationId(), sourceFunction: "approveSupplierInvoice", after: { grossAmountMinor: gross, journalEntryId: journal.id } });
  });
  return { supplierInvoiceId: invoice.id, approved: true };
});

export const recordSupplierPayment = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request); requirePermission(actor, "payables.pay"); const input = parseInput(recordSupplierPaymentInput, request.data);
  const supplier = db.doc(`suppliers/${input.supplierId}`), invoiceRefs = input.allocations.map((allocation) => db.doc(`supplierInvoices/${allocation.supplierInvoiceId}`));
  const operation = db.doc(`idempotencyKeys/${actor.organizationId}_recordSupplierPayment_${input.idempotencyKey}`), payment = db.collection("supplierPayments").doc(), journalCounter = db.doc(`journalCounters/${uniquenessDocumentId(actor.organizationId, "general")}`), journal = db.collection("journalEntries").doc();
  let result = { paymentId: payment.id, recorded: true };
  await db.runTransaction(async (transaction) => {
    const snapshots = await transaction.getAll(operation, supplier, journalCounter, ...invoiceRefs); const previous = snapshots[0]!, supplierSnapshot = snapshots[1]!, journalCounterSnapshot = snapshots[2]!;
    if (previous.exists) { result = { paymentId: String(previous.get("entityId")), recorded: false }; return; }
    if (!supplierSnapshot.exists || supplierSnapshot.get("organizationId") !== actor.organizationId) throw new HttpsError("failed-precondition", "Supplier is unavailable.");
    const invoices = snapshots.slice(3), total = input.allocations.reduce((sum, allocation) => sum + allocation.amountMinor, 0);
    input.allocations.forEach((allocation, index) => { const invoice = invoices[index]!; if (!invoice.exists || invoice.get("organizationId") !== actor.organizationId || invoice.get("supplierId") !== supplier.id || !["approved", "partially_paid"].includes(String(invoice.get("status"))) || allocation.amountMinor > Number(invoice.get("outstandingAmountMinor") ?? 0)) throw new HttpsError("failed-precondition", "A payment allocation exceeds an approved outstanding supplier invoice."); });
    if (total > Number(supplierSnapshot.get("outstandingBalanceMinor") ?? 0)) throw new HttpsError("failed-precondition", "Payment exceeds the supplier's outstanding balance.");
    const effectiveAt = Timestamp.fromDate(new Date(input.paidAt)), now = FieldValue.serverTimestamp(), paymentNumber = `PAY-${payment.id.slice(0, 10).toUpperCase()}`;
    const lines = [{ accountCode: "2000", debitMinor: total, creditMinor: 0 }, { accountCode: paymentAccounts[input.method]!, debitMinor: 0, creditMinor: total }]; assertBalancedJournal(lines);
    writeJournal(transaction, actor, { journal, journalCounter, journalCounterValue: Number(journalCounterSnapshot.get("value") ?? 0) + 1, journalType: "supplier_payment", referenceType: "supplierPayment", referenceId: payment.id, referenceNumber: paymentNumber, description: `Supplier payment ${paymentNumber}`, effectiveAt, lines });
    input.allocations.forEach((allocation, index) => { const invoice = invoices[index]!, next = Number(invoice.get("outstandingAmountMinor")) - allocation.amountMinor; transaction.update(invoiceRefs[index]!, { outstandingAmountMinor: next, status: next === 0 ? "paid" : "partially_paid", updatedAt: now, lastPaymentId: payment.id }); transaction.create(db.collection("supplierPaymentAllocations").doc(), { organizationId: actor.organizationId, supplierId: supplier.id, supplierPaymentId: payment.id, supplierInvoiceId: invoice.id, amountMinor: allocation.amountMinor, currency: "NGN", createdAt: now }); });
    const nextBalance = Number(supplierSnapshot.get("outstandingBalanceMinor")) - total;
    transaction.update(supplier, { outstandingBalanceMinor: nextBalance, updatedAt: now, updatedBy: actor.userId });
    transaction.create(payment, clean({ organizationId: actor.organizationId, supplierId: supplier.id, supplierNumber: supplierSnapshot.get("supplierNumber"), supplierName: supplierSnapshot.get("name"), paymentNumber, method: input.method, reference: input.reference, amountMinor: total, currency: "NGN", status: "recorded", paidAt: effectiveAt, recordedAt: now, recordedBy: actor.userId, notes: input.notes, journalEntryId: journal.id, createdAt: now }));
    transaction.create(db.collection("supplierAccountEntries").doc(), { organizationId: actor.organizationId, supplierId: supplier.id, entryType: "supplier_payment", referenceType: "supplierPayment", referenceId: payment.id, referenceNumber: paymentNumber, amountMinor: -total, balanceAfterMinor: nextBalance, currency: "NGN", effectiveAt, createdAt: now, createdBy: actor.userId });
    transaction.create(operation, { organizationId: actor.organizationId, action: "recordSupplierPayment", entityId: payment.id, status: "completed", createdAt: now, createdBy: actor.userId });
    writeAuditLog(transaction, actor, { action: "supplier_payment.recorded", entityType: "supplierPayment", entityId: payment.id, correlationId: correlationId(), sourceFunction: "recordSupplierPayment", after: { supplierId: supplier.id, amountMinor: total, method: input.method } });
  });
  return result;
});
