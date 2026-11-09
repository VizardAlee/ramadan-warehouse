import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import { requirePermission } from "../auth/authorize.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { correlationId } from "../utils/callable.js";
import { requestFingerprint } from "../utils/request-fingerprint.js";
import { editDraftPurchaseOrderInput } from "../validation/procurement.js";
import { requireProcurementScope, type ProcurementAccess } from "./authorize.js";

type Input = ReturnType<typeof editDraftPurchaseOrderInput.parse>;
const scopeOf = (row: FirebaseFirestore.DocumentSnapshot) => ({
  branchId: row.get("branchId") || undefined, warehouseId: row.get("warehouseId") || undefined,
});
const clean = (data: Record<string, unknown>) => Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
const locked = (): never => { throw new HttpsError("failed-precondition", "Only an untouched draft purchase order can be edited. Submitted orders and orders with receiving or invoicing evidence are locked."); };
const zero = (value: unknown) => value === undefined || value === null || value === 0;
const auditLine = (data: Record<string, unknown>) => Object.fromEntries(Object.entries(data).filter(([key]) => !["createdAt", "updatedAt"].includes(key)));
const commercial = (row: FirebaseFirestore.DocumentSnapshot) => Object.fromEntries([
  "purchaseOrderNumber", "supplierId", "supplierName", "branchId", "warehouseId", "receivingLocationId",
  "expectedAt", "notes", "netAmountMinor", "vatAmountMinor", "grossAmountMinor", "revision",
].map(key => [key, row.get(key) ?? null]));

/** Invoked only by createPurchaseOrder's explicit edit_draft command. Never reopens a submitted order. */
export async function editDraftPurchaseOrder(actor: ProcurementAccess, input: Input) {
  requirePermission(actor, "procurement.create");
  requireProcurementScope(actor, input, "procurement.create");
  const orderRef = db.doc(`purchaseOrders/${input.purchaseOrderId}`);
  const operationRef = db.doc(`idempotencyKeys/${actor.organizationId}_editDraftPurchaseOrder_${input.idempotencyKey}`);
  const ownerType = input.branchId ? "branch" : "warehouse", ownerId = input.branchId ?? input.warehouseId!;
  const fingerprint = requestFingerprint({ ...input, actorUserId: actor.userId });
  return db.runTransaction(async transaction => {
    const [order, previous] = await transaction.getAll(orderRef, operationRef);
    if (!order!.exists || order!.get("organizationId") !== actor.organizationId)
      throw new HttpsError("not-found", "Purchase order not found.");
    const scope = scopeOf(order!);
    requireProcurementScope(actor, scope, "procurement.create");
    if (scope.branchId !== input.branchId || scope.warehouseId !== input.warehouseId)
      throw new HttpsError("permission-denied", "A draft must remain in its original operating location.");
    if (previous!.exists) {
      if (previous!.get("requestHash") !== fingerprint || previous!.get("entityId") !== orderRef.id || previous!.get("createdBy") !== actor.userId)
        throw new HttpsError("already-exists", "This retry reference belongs to different draft changes. Reload the order before trying again.");
      return { purchaseOrderId: orderRef.id, purchaseOrderNumber: previous!.get("purchaseOrderNumber"), revision: previous!.get("revision"), updated: false };
    }
    if (order!.get("status") !== "draft" ||
      ["submittedAt", "submittedBy", "approvedAt", "approvedBy", "receivedAt", "receivedBy"].some(key => order!.get(key) != null) ||
      !["receivedNetAmountMinor", "invoicedNetAmountMinor", "receivedQuantity", "invoicedQuantity"].every(key => zero(order!.get(key)))) locked();
    const revision = order!.get("revision") ?? 0;
    if (!Number.isSafeInteger(revision) || revision < 0 || revision !== input.expectedRevision)
      throw new HttpsError("aborted", "This draft changed since you opened it. Reload the order and review the latest version before editing.");

    // Read authoritative related documents too: a damaged draft header must not unlock posted evidence.
    // Single-field queries avoid introducing a new composite-index deployment requirement.
    const items = await transaction.get(db.collection("purchaseOrderItems").where("purchaseOrderId", "==", orderRef.id).limit(101));
    if (items.empty || items.size > 100) throw new HttpsError("failed-precondition", "Draft lines require reconciliation before editing.");
    for (const collection of ["purchaseReceipts", "supplierInvoices", "supplierInvoiceItems", "purchaseInvoiceItemCounters", "supplierReturns"]) {
      const related = await transaction.get(db.collection(collection).where("purchaseOrderId", "==", orderRef.id).limit(1));
      if (!related.empty) locked();
    }
    const movements = await transaction.get(db.collection("inventoryTransactions").where("referenceId", "==", orderRef.id).limit(1));
    if (!movements.empty) locked();
    const existing = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
    for (const item of items.docs) {
      const productId = item.get("productId");
      if (item.get("organizationId") !== actor.organizationId || scopeOf(item).branchId !== scope.branchId || scopeOf(item).warehouseId !== scope.warehouseId ||
        typeof productId !== "string" || existing.has(productId) || !zero(item.get("receivedQuantity")) || !zero(item.get("invoicedQuantity")) || item.get("receiptInProgressKey"))
        throw new HttpsError("failed-precondition", "Draft lines or their receiving/invoicing evidence require reconciliation before editing.");
      existing.set(productId, item);
    }
    const [supplier, owner, location, ...products] = await transaction.getAll(
      db.doc(`suppliers/${input.supplierId}`), db.doc(`${ownerType === "branch" ? "branches" : "warehouses"}/${ownerId}`),
      db.doc(`inventoryLocations/${input.receivingLocationId}`), ...input.lines.map(line => db.doc(`products/${line.productId}`)),
    );
    if (!supplier!.exists || supplier!.get("organizationId") !== actor.organizationId || supplier!.get("active") !== true)
      throw new HttpsError("failed-precondition", "Select an active supplier.");
    if (!owner!.exists || owner!.get("organizationId") !== actor.organizationId || owner!.get("status") !== "active")
      throw new HttpsError("failed-precondition", "Receiving operating location is unavailable.");
    if (!location!.exists || location!.get("organizationId") !== actor.organizationId || location!.get(`${ownerType}Id`) !== ownerId || location!.get("status") !== "active")
      throw new HttpsError("failed-precondition", "Select an active stock location inside the receiving location.");
    const now = FieldValue.serverTimestamp();
    const calculated = input.lines.map((line, index) => {
      const product = products[index]!;
      if (!product.exists || product.get("organizationId") !== actor.organizationId || product.get("active") !== true || product.get("itemKind") === "service")
        throw new HttpsError("failed-precondition", "A purchase product is unavailable.");
      const net = line.quantity * line.unitCostMinor;
      const vat = Number((BigInt(net) * BigInt(line.vatRateBasisPoints) + 5_000n) / 10_000n);
      const old = existing.get(line.productId), ref = old?.ref ?? db.collection("purchaseOrderItems").doc();
      const data = clean({
        organizationId: actor.organizationId, purchaseOrderId: orderRef.id, purchaseOrderNumber: order!.get("purchaseOrderNumber"),
        supplierId: input.supplierId, ...scope, operationalLocationType: order!.get("operationalLocationType"), operationalLocationId: ownerId,
        productId: product.id, sku: product.get("sku"), productName: product.get("name"), trackingType: product.get("trackingType"), unitOfMeasure: product.get("unitOfMeasure"),
        orderedQuantity: line.quantity, receivedQuantity: 0, invoicedQuantity: 0, unitCostMinor: line.unitCostMinor, vatRateBasisPoints: line.vatRateBasisPoints,
        netAmountMinor: net, vatAmountMinor: vat, grossAmountMinor: net + vat, currency: "NGN", updatedAt: now,
        ...(!old ? { createdAt: now } : {}),
      });
      return { ref, old, data, net, vat, gross: net + vat };
    });
    const total = (key: "net" | "vat" | "gross") => calculated.reduce((sum, line) => sum + line[key], 0);
    const next = {
      supplierId: supplier!.id, supplierNumber: supplier!.get("supplierNumber") ?? null, supplierName: supplier!.get("name"),
      receivingLocationId: location!.id, receivingLocationName: location!.get("name"),
      expectedAt: input.expectedAt ? Timestamp.fromDate(new Date(input.expectedAt)) : null, notes: input.notes || null,
      netAmountMinor: total("net"), vatAmountMinor: total("vat"), grossAmountMinor: total("gross"), revision: revision + 1,
    };
    transaction.update(orderRef, { ...next, updatedAt: now, updatedBy: actor.userId });
    for (const line of calculated) {
      if (line.old) transaction.update(line.ref, line.data);
      else transaction.create(line.ref, line.data);
    }
    const retained = new Set(input.lines.map(line => line.productId));
    for (const [productId, item] of existing) if (!retained.has(productId)) transaction.delete(item.ref);
    transaction.create(operationRef, { organizationId: actor.organizationId, action: "editDraftPurchaseOrder", entityId: orderRef.id,
      purchaseOrderNumber: order!.get("purchaseOrderNumber"), revision: next.revision, requestHash: fingerprint, status: "completed", createdBy: actor.userId, createdAt: now });
    writeAuditLog(transaction, actor, { action: "purchase_order.draft_edited", entityType: "purchaseOrder", entityId: orderRef.id,
      correlationId: correlationId(), sourceFunction: "createPurchaseOrder",
      before: { ...commercial(order!), lines: items.docs.map(item => ({ ...auditLine(item.data()), id: item.id })) },
      after: { ...commercial(order!), ...next, lines: calculated.map(line => ({ ...auditLine(line.data), id: line.ref.id })) },
    });
    return { purchaseOrderId: orderRef.id, purchaseOrderNumber: order!.get("purchaseOrderNumber"), revision: next.revision, updated: true };
  });
}
