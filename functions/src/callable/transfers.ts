import {
  FieldPath,
  FieldValue,
  Timestamp,
  type DocumentSnapshot,
  type Query,
  type Transaction,
} from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import {
  hasServerPermission,
  requireAccess,
  requireBranchScope,
  requirePermission,
  requireWarehouseScope,
  type AccessProfile,
} from "../auth/authorize.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { enforceAppCheck } from "../config.js";
import { postInventoryTransaction } from "../inventory/post-inventory-transaction.js";
import { createIntegrationEvent, writeIntegrationOutbox } from "../integrations/outbox.js";
import { applyTransferFulfilmentToRequest } from "../requests/apply-transfer-fulfilment.js";
import {
  reserveTransferStockService,
  releaseTransferReservationService,
  type ReservationLine,
} from "../transfers/reservation-service.js";
import { assertTransferTransition } from "../transfers/transfer-state-machine.js";
import { assertTransferInvariantGate } from "../transfers/validate-transfer-invariants.js";
import { correlationId, parseInput } from "../utils/callable.js";
import {
  costActionInput,
  costInput,
  createAdminTransferInput,
  createTransferFromRequestInput,
  discrepancyInput,
  dispatchInput,
  packageActionInput,
  packageInput,
  pickedItemsInput,
  receiptInput,
  releaseReservationInput,
  reserveTransferInput,
  resolveDiscrepancyInput,
  transferActionInput,
  transferQueryInput,
  updateTransferDraftInput,
  verifyPickInput,
  logisticsResourceInput,
} from "../validation/transfers.js";

type Snapshot = DocumentSnapshot;
type RecordValue = Record<string, unknown>;
const clean = (value: RecordValue) =>
  Object.fromEntries(
    Object.entries(value).filter(
      ([, item]) => item !== undefined && item !== "",
    ),
  );
const number = (snapshot: Snapshot, field: string) =>
  Number(snapshot.get(field) ?? 0);
const transferRef = (id: string) => db.doc(`transfers/${id}`);
const operationRef = (actor: AccessProfile, action: string, key: string) =>
  db.doc(`idempotencyKeys/${actor.organizationId}_${action}_${key}`);
const itemId = (transferId: string, productId: string) =>
  `${transferId}__${encodeURIComponent(productId)}`;
async function serialNumbersForIds(
  actor: AccessProfile,
  productId: string,
  ids: readonly string[],
): Promise<string[]> {
  if (!ids.length) return [];
  const snapshots = await db.getAll(
    ...ids.map((id) => db.doc(`serializedItems/${id}`)),
  );
  return snapshots.map((snapshot, index) => {
    if (
      !snapshot.exists ||
      snapshot.id !== ids[index] ||
      snapshot.get("organizationId") !== actor.organizationId ||
      snapshot.get("productId") !== productId
    )
      throw new HttpsError(
        "failed-precondition",
        "A serialized item is outside the transfer product or organization.",
      );
    return String(snapshot.get("serialNumber"));
  });
}
const serialize = (snapshot: Snapshot) => {
  const output = { id: snapshot.id, ...snapshot.data() } as RecordValue;
  for (const [key, value] of Object.entries(output))
    if (value instanceof Timestamp) output[key] = value.toDate().toISOString();
  return output;
};
function assertTransferScope(actor: AccessProfile, transfer: Snapshot) {
  if (
    !transfer.exists ||
    transfer.get("organizationId") !== actor.organizationId
  )
    throw new HttpsError("not-found", "Transfer not found.");
  if (hasServerPermission(actor, "transfers.read.all")) return;
  if (
    hasServerPermission(actor, "transfers.read.assigned_warehouse") &&
    actor.warehouseIds.includes(String(transfer.get("originWarehouseId")))
  )
    return;
  if (
    hasServerPermission(actor, "transfers.read.own_branch") &&
    actor.branchIds.includes(String(transfer.get("destinationBranchId")))
  )
    return;
  throw new HttpsError(
    "permission-denied",
    "The transfer is outside your assigned scope.",
  );
}
function event(
  transaction: Transaction,
  actor: AccessProfile,
  transfer: Snapshot,
  eventType: string,
  cid: string,
  extra: RecordValue = {},
) {
  transaction.create(
    db.collection("transferEvents").doc(),
    clean({
      organizationId: actor.organizationId,
      transferId: transfer.id,
      originWarehouseId: transfer.get("originWarehouseId"),
      destinationBranchId: transfer.get("destinationBranchId"),
      eventType,
      actorUserId: actor.userId,
      actorRoleId: actor.roleId,
      correlationId: cid,
      createdAt: FieldValue.serverTimestamp(),
      ...extra,
    }),
  );
  const integrationType = {
    dispatched: "warehouse.transfer.dispatched.v1",
    received: "warehouse.transfer.received.v1",
    partially_received: "warehouse.transfer.partially_received.v1",
    cancelled: "warehouse.transfer.cancelled.v1",
  }[eventType] as
    | "warehouse.transfer.dispatched.v1"
    | "warehouse.transfer.received.v1"
    | "warehouse.transfer.partially_received.v1"
    | "warehouse.transfer.cancelled.v1"
    | undefined;
  if (integrationType) {
    const occurrence = String(extra.dispatchId ?? extra.receiptId ?? transfer.id);
    writeIntegrationOutbox(
      transaction,
      createIntegrationEvent({
        eventType: integrationType,
        organizationId: actor.organizationId,
        branchId: String(transfer.get("destinationBranchId")),
        warehouseId: String(transfer.get("originWarehouseId")),
        entityId: transfer.id,
        occurredAt: new Date().toISOString(),
        correlationId: cid,
        idempotencyKey: `${integrationType}:${transfer.id}:${occurrence}`,
        payload: clean({ transferId: transfer.id, transferNumber: transfer.get("transferNumber"), ...extra }),
      }),
    );
  }
}
function notification(
  transaction: Transaction,
  actor: AccessProfile,
  transfer: Snapshot,
  type: string,
  key: string,
) {
  transaction.create(db.collection("notificationEvents").doc(), {
    organizationId: actor.organizationId,
    eventType: `transfer.${type}`,
    entityType: "transfer",
    entityId: transfer.id,
    branchId: transfer.get("destinationBranchId"),
    warehouseId: transfer.get("originWarehouseId"),
    recipientRoles: type.includes("cost")
      ? ["finance_officer"]
      : ["operations_administrator", "warehouse_manager", "branch_manager"],
    idempotencyKey: `${type}:${key}`,
    status: "pending",
    createdAt: FieldValue.serverTimestamp(),
  });
}
function operation(
  transaction: Transaction,
  ref: FirebaseFirestore.DocumentReference,
  actor: AccessProfile,
  action: string,
  entityId: string,
) {
  transaction.create(ref, {
    organizationId: actor.organizationId,
    action,
    entityId,
    status: "completed",
    createdAt: FieldValue.serverTimestamp(),
    createdBy: actor.userId,
  });
}

interface CreateInput {
  originWarehouseId: string;
  originLocationId: string;
  destinationBranchId: string;
  destinationLocationId: string;
  purpose: string;
  priority: string;
  expectedDispatchDate?: string;
  expectedDeliveryDate?: string;
  items: Array<{
    productId: string;
    quantity: number;
    sourceRequestItemId?: string;
  }>;
  idempotencyKey: string;
  sourceRequestId?: string;
  sourceRequestVersion?: number;
  sourceApprovalId?: string;
  directTransferReason?: string;
}
async function createTransfer(
  actor: AccessProfile,
  input: CreateInput,
  sourceType: "branch_request" | "admin_allocation",
) {
  requirePermission(
    actor,
    sourceType === "branch_request"
      ? "transfers.create.from_request"
      : "transfers.create.direct",
  );
  requireWarehouseScope(actor, input.originWarehouseId);
  const transfer = db.collection("transfers").doc();
  const op = operationRef(actor, "createTransfer", input.idempotencyKey);
  const warehouse = db.doc(`warehouses/${input.originWarehouseId}`);
  const branch = db.doc(`branches/${input.destinationBranchId}`);
  const origin = db.doc(`inventoryLocations/${input.originLocationId}`);
  const destination = db.doc(
    `inventoryLocations/${input.destinationLocationId}`,
  );
  const request = input.sourceRequestId
    ? db.doc(`branchRequests/${input.sourceRequestId}`)
    : undefined;
  const approval = input.sourceApprovalId
    ? db.doc(`branchRequestApprovals/${input.sourceApprovalId}`)
    : undefined;
  const transitId = `transit__${encodeURIComponent(actor.organizationId)}__${encodeURIComponent(input.destinationBranchId)}`;
  const damagedId = `damaged__${encodeURIComponent(actor.organizationId)}__${encodeURIComponent(input.destinationBranchId)}`;
  const transit = db.doc(`inventoryLocations/${transitId}`);
  const damaged = db.doc(`inventoryLocations/${damagedId}`);
  const counter = db.doc(
    `transferCounters/${actor.organizationId}__${input.originWarehouseId}__${input.destinationBranchId}__${new Date().getUTCFullYear()}`,
  );
  return db.runTransaction(async (transaction) => {
    const productRefs = input.items.map((line) =>
      db.doc(`products/${line.productId}`),
    );
    const requestItemRefs =
      sourceType === "branch_request"
        ? input.items.map((line) =>
            db.doc(`branchRequestItems/${line.sourceRequestItemId}`),
          )
        : [];
    const snapshots = await transaction.getAll(
      op,
      warehouse,
      branch,
      origin,
      destination,
      transit,
      damaged,
      counter,
      ...(request ? [request] : []),
      ...(approval ? [approval] : []),
      ...productRefs,
      ...requestItemRefs,
    );
    let cursor = 0;
    const previous = snapshots[cursor++]!;
    if (previous.exists)
      return { transferId: String(previous.get("entityId")), created: false };
    const warehouseDoc = snapshots[cursor++]!;
    const branchDoc = snapshots[cursor++]!;
    const originDoc = snapshots[cursor++]!;
    const destinationDoc = snapshots[cursor++]!;
    const transitDoc = snapshots[cursor++]!;
    const damagedDoc = snapshots[cursor++]!;
    const counterDoc = snapshots[cursor++]!;
    const requestDoc = request ? snapshots[cursor++]! : undefined;
    const approvalDoc = approval ? snapshots[cursor++]! : undefined;
    const products = snapshots.slice(cursor, (cursor += productRefs.length));
    const requestItems = snapshots.slice(cursor);
    for (const doc of [warehouseDoc, branchDoc, originDoc, destinationDoc])
      if (
        !doc.exists ||
        doc.get("organizationId") !== actor.organizationId ||
        doc.get("status") !== "active"
      )
        throw new HttpsError(
          "failed-precondition",
          "A transfer organization unit or location is unavailable.",
        );
    if (
      originDoc.get("warehouseId") !== input.originWarehouseId ||
      destinationDoc.get("branchId") !== input.destinationBranchId
    )
      throw new HttpsError(
        "failed-precondition",
        "Transfer locations do not match their warehouse or branch.",
      );
    if (
      new Set(input.items.map((line) => line.productId)).size !==
      input.items.length
    )
      throw new HttpsError(
        "invalid-argument",
        "Duplicate product lines are not permitted.",
      );
    if (sourceType === "branch_request") {
      if (
        !requestDoc?.exists ||
        requestDoc.get("organizationId") !== actor.organizationId ||
        requestDoc.get("branchId") !== input.destinationBranchId ||
        !["approved", "partially_approved", "partially_fulfilled"].includes(
          String(requestDoc.get("status")),
        ) ||
        requestDoc.get("version") !== input.sourceRequestVersion
      )
        throw new HttpsError(
          "failed-precondition",
          "The approved request version is unavailable.",
        );
      if (
        !approvalDoc?.exists ||
        approvalDoc.get("requestId") !== requestDoc.id ||
        approvalDoc.get("requestVersion") !== input.sourceRequestVersion ||
        !["approved", "partially_approved"].includes(
          String(approvalDoc.get("decision")),
        )
      )
        throw new HttpsError(
          "failed-precondition",
          "The selected request approval is invalid.",
        );
    }
    let total = 0;
    const now = FieldValue.serverTimestamp();
    for (let index = 0; index < input.items.length; index++) {
      const line = input.items[index]!;
      const product = products[index]!;
      if (
        !product.exists ||
        product.get("organizationId") !== actor.organizationId ||
        product.get("active") !== true
      )
        throw new HttpsError(
          "failed-precondition",
          "A transfer product is unavailable.",
        );
      if (sourceType === "branch_request") {
        const requestItem = requestItems[index]!;
        if (
          !requestItem.exists ||
          requestItem.get("requestId") !== requestDoc!.id ||
          requestItem.get("productId") !== line.productId ||
          number(requestItem, "outstandingQuantity") -
            number(requestItem, "transferAllocatedQuantity") <
            line.quantity
        )
          throw new HttpsError(
            "failed-precondition",
            "Transfer quantity exceeds approved request quantity not already allocated.",
          );
        transaction.update(requestItem.ref, {
          transferAllocatedQuantity:
            number(requestItem, "transferAllocatedQuantity") + line.quantity,
          updatedAt: now,
        });
      }
      total += line.quantity;
      transaction.create(
        db.doc(`transferItems/${itemId(transfer.id, line.productId)}`),
        {
          organizationId: actor.organizationId,
          transferId: transfer.id,
          sourceRequestId: input.sourceRequestId ?? null,
          sourceRequestItemId: line.sourceRequestItemId ?? null,
          productId: product.id,
          sku: product.get("sku"),
          productName: product.get("name"),
          trackingType: product.get("trackingType"),
          unitOfMeasure: product.get("unitOfMeasure"),
          plannedQuantity: line.quantity,
          approvedQuantity: 0,
          reservedQuantity: 0,
          pickedQuantity: 0,
          packedQuantity: 0,
          dispatchedQuantity: 0,
          receivedQuantity: 0,
          damagedQuantity: 0,
          missingQuantity: 0,
          returnedQuantity: 0,
          writtenOffQuantity: 0,
          rejectedAtReceiptQuantity: 0,
          outstandingQuantity: line.quantity,
          itemStatus: "draft",
          createdAt: now,
          updatedAt: now,
        },
      );
    }
    const sequence = number(counterDoc, "value") + 1;
    const year = new Date().getUTCFullYear();
    const transferNumber = `TRF-${String(warehouseDoc.get("code"))}-${String(branchDoc.get("code"))}-${year}-${String(sequence).padStart(6, "0")}`;
    transaction.set(
      counter,
      {
        organizationId: actor.organizationId,
        originWarehouseId: input.originWarehouseId,
        destinationBranchId: input.destinationBranchId,
        year,
        value: sequence,
        updatedAt: now,
      },
      { merge: true },
    );
    if (!transitDoc.exists)
      transaction.create(transit, {
        organizationId: actor.organizationId,
        branchId: input.destinationBranchId,
        name: `${branchDoc.get("name")} goods in transit`,
        code: `GIT-${branchDoc.get("code")}`,
        type: "goods_in_transit",
        status: "active",
        systemManaged: true,
        createdAt: now,
        createdBy: actor.userId,
        updatedAt: now,
        updatedBy: actor.userId,
      });
    if (!damagedDoc.exists)
      transaction.create(damaged, {
        organizationId: actor.organizationId,
        branchId: input.destinationBranchId,
        name: `${branchDoc.get("name")} damaged stock`,
        code: `DMG-${branchDoc.get("code")}`,
        type: "damaged",
        status: "active",
        systemManaged: true,
        createdAt: now,
        createdBy: actor.userId,
        updatedAt: now,
        updatedBy: actor.userId,
      });
    transaction.create(
      transfer,
      clean({
        organizationId: actor.organizationId,
        transferNumber,
        sourceType,
        sourceRequestId: input.sourceRequestId,
        sourceRequestVersion: input.sourceRequestVersion,
        sourceApprovalId: input.sourceApprovalId,
        directTransferReason: input.directTransferReason,
        originWarehouseId: input.originWarehouseId,
        originLocationId: input.originLocationId,
        destinationBranchId: input.destinationBranchId,
        destinationLocationId: input.destinationLocationId,
        transitLocationId: transitId,
        damagedLocationId: damagedId,
        purpose: input.purpose,
        priority: input.priority,
        status: "draft",
        expectedDispatchDate: input.expectedDispatchDate
          ? Timestamp.fromDate(
              new Date(`${input.expectedDispatchDate}T00:00:00Z`),
            )
          : undefined,
        expectedDeliveryDate: input.expectedDeliveryDate
          ? Timestamp.fromDate(
              new Date(`${input.expectedDeliveryDate}T00:00:00Z`),
            )
          : undefined,
        totalPlannedQuantity: total,
        totalApprovedQuantity: 0,
        totalReservedQuantity: 0,
        totalPickedQuantity: 0,
        totalPackedQuantity: 0,
        totalDispatchedQuantity: 0,
        totalReceivedQuantity: 0,
        totalDamagedQuantity: 0,
        totalMissingQuantity: 0,
        totalReturnedQuantity: 0,
        totalWrittenOffQuantity: 0,
        totalOutstandingQuantity: total,
        estimatedCostMinor: 0,
        approvedCostMinor: 0,
        actualCostMinor: 0,
        costVarianceMinor: 0,
        currency: "NGN",
        initiatedAt: now,
        initiatedBy: actor.userId,
        version: 0,
        createdAt: now,
        createdBy: actor.userId,
        updatedAt: now,
        updatedBy: actor.userId,
      }),
    );
    const synthetic = {
      id: transfer.id,
      exists: true,
      get: (field: string) =>
        (
          ({
            originWarehouseId: input.originWarehouseId,
            destinationBranchId: input.destinationBranchId,
          }) as RecordValue
        )[field],
    } as unknown as Snapshot;
    event(transaction, actor, synthetic, "created", correlationId(), {
      sourceType,
    });
    operation(transaction, op, actor, "createTransfer", transfer.id);
    writeAuditLog(transaction, actor, {
      action: "transfer.created",
      entityType: "transfer",
      entityId: transfer.id,
      correlationId: correlationId(),
      sourceFunction:
        sourceType === "branch_request"
          ? "createTransferFromRequest"
          : "createAdminTransfer",
      after: { transferNumber, sourceType, totalPlannedQuantity: total },
    });
    return { transferId: transfer.id, transferNumber, created: true };
  });
}

export const createTransferFromRequest = onCall(
  { enforceAppCheck },
  async (request) =>
    createTransfer(
      await requireAccess(request),
      parseInput(createTransferFromRequestInput, request.data),
      "branch_request",
    ),
);
export const createAdminTransfer = onCall(
  { enforceAppCheck },
  async (request) =>
    createTransfer(
      await requireAccess(request),
      parseInput(createAdminTransferInput, request.data),
      "admin_allocation",
    ),
);

export const updateTransferDraft = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "transfers.update_draft");
    const input = parseInput(updateTransferDraftInput, request.data);
    const ref = transferRef(input.transferId);
    const op = operationRef(actor, "updateTransferDraft", input.idempotencyKey);
    const cid = correlationId();
    return db.runTransaction(async (transaction) => {
      const [existingOp, transfer] = (await transaction.getAll(op, ref)) as [
        Snapshot,
        Snapshot,
      ];
      if (existingOp.exists)
        return { transferId: input.transferId, updated: false };
      assertTransferScope(actor, transfer);
      if (
        !["draft", "changes_requested"].includes(
          String(transfer.get("status")),
        ) ||
        number(transfer, "version") !== input.expectedVersion
      )
        throw new HttpsError(
          "failed-precondition",
          "Only the current editable transfer version can be updated.",
        );
      if (
        transfer.get("createdBy") !== actor.userId &&
        actor.roleId !== "system_administrator"
      )
        throw new HttpsError(
          "permission-denied",
          "Only the creator can edit this draft.",
        );
      const items = await transaction.get(
        db
          .collection("transferItems")
          .where("transferId", "==", input.transferId),
      );
      const currentByProduct = new Map(
        items.docs.map((doc) => [String(doc.get("productId")), doc]),
      );
      if (
        input.items.length !== items.size ||
        input.items.some((line) => !currentByProduct.has(line.productId))
      )
        throw new HttpsError(
          "failed-precondition",
          "Changing draft product identity is not supported; cancel and recreate the transfer.",
        );
      let total = 0;
      const now = FieldValue.serverTimestamp();
      for (const line of input.items) {
        const item = currentByProduct.get(line.productId)!;
        if (
          number(item, "reservedQuantity") > 0 ||
          number(item, "dispatchedQuantity") > 0
        )
          throw new HttpsError(
            "failed-precondition",
            "Operational quantities lock draft lines.",
          );
        if (
          transfer.get("sourceType") === "branch_request" &&
          line.quantity > number(item, "plannedQuantity")
        )
          throw new HttpsError(
            "failed-precondition",
            "A request-linked draft cannot increase its original allocation.",
          );
        total += line.quantity;
        transaction.update(item.ref, {
          plannedQuantity: line.quantity,
          outstandingQuantity: line.quantity,
          updatedAt: now,
        });
      }
      transaction.update(
        ref,
        clean({
          originWarehouseId: input.originWarehouseId,
          originLocationId: input.originLocationId,
          destinationBranchId: input.destinationBranchId,
          destinationLocationId: input.destinationLocationId,
          purpose: input.purpose,
          priority: input.priority,
          expectedDispatchDate: input.expectedDispatchDate
            ? Timestamp.fromDate(
                new Date(`${input.expectedDispatchDate}T00:00:00Z`),
              )
            : undefined,
          expectedDeliveryDate: input.expectedDeliveryDate
            ? Timestamp.fromDate(
                new Date(`${input.expectedDeliveryDate}T00:00:00Z`),
              )
            : undefined,
          totalPlannedQuantity: total,
          totalOutstandingQuantity: total,
          updatedAt: now,
          updatedBy: actor.userId,
        }),
      );
      event(transaction, actor, transfer, "updated", cid);
      operation(
        transaction,
        op,
        actor,
        "updateTransferDraft",
        input.transferId,
      );
      writeAuditLog(transaction, actor, {
        action: "transfer.updated",
        entityType: "transfer",
        entityId: input.transferId,
        correlationId: cid,
        sourceFunction: "updateTransferDraft",
      });
      return { transferId: input.transferId, updated: true };
    });
  },
);

async function transition(
  actor: AccessProfile,
  input: {
    transferId: string;
    expectedVersion: number;
    reason?: string;
    idempotencyKey: string;
  },
  config: {
    action: string;
    permission: Parameters<typeof requirePermission>[1];
    from: string[];
    to: string;
    eventType: string;
    makerCheck?: boolean;
    approve?: boolean;
  },
) {
  requirePermission(actor, config.permission);
  const ref = transferRef(input.transferId);
  const op = operationRef(actor, config.action, input.idempotencyKey);
  const cid = correlationId();
  return db.runTransaction(async (transaction) => {
    const [previousOp, transfer] = (await transaction.getAll(op, ref)) as [
      Snapshot,
      Snapshot,
    ];
    if (previousOp.exists)
      return { transferId: input.transferId, changed: false };
    const items = await transaction.get(
      db
        .collection("transferItems")
        .where("transferId", "==", input.transferId),
    );
    assertTransferScope(actor, transfer);
    if (
      !config.from.includes(String(transfer.get("status"))) ||
      number(transfer, "version") !== input.expectedVersion
    )
      throw new HttpsError(
        "failed-precondition",
        "The transfer status or version changed.",
      );
    assertTransferTransition(String(transfer.get("status")), config.to);
    if (config.makerCheck && transfer.get("createdBy") === actor.userId)
      throw new HttpsError(
        "permission-denied",
        "The transfer creator cannot approve their own transfer.",
      );
    const now = FieldValue.serverTimestamp();
    const nextVersion =
      config.action === "submitTransfer"
        ? input.expectedVersion + 1
        : input.expectedVersion;
    if (config.action === "submitTransfer") {
      if (items.empty)
        throw new HttpsError(
          "failed-precondition",
          "A transfer requires items before submission.",
        );
      transaction.create(
        db.doc(`transferVersions/${input.transferId}__v${nextVersion}`),
        {
          organizationId: actor.organizationId,
          transferId: input.transferId,
          transferNumber: transfer.get("transferNumber"),
          version: nextVersion,
          headerSnapshot: transfer.data(),
          itemSnapshot: items.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          })),
          sourceRequestId: transfer.get("sourceRequestId") ?? null,
          sourceRequestVersion: transfer.get("sourceRequestVersion") ?? null,
          estimatedCostMinor: transfer.get("estimatedCostMinor"),
          submittedBy: actor.userId,
          submittedAt: now,
          correlationId: cid,
          createdAt: now,
        },
      );
    }
    const updates: RecordValue = {
      status: config.to,
      version: nextVersion,
      updatedAt: now,
      updatedBy: actor.userId,
    };
    if (config.action === "submitTransfer")
      Object.assign(updates, { submittedAt: now, submittedBy: actor.userId });
    if (config.approve)
      Object.assign(updates, {
        approvedAt: now,
        approvedBy: actor.userId,
        totalApprovedQuantity: transfer.get("totalPlannedQuantity"),
        totalOutstandingQuantity: transfer.get("totalPlannedQuantity"),
      });
    transaction.update(ref, updates);
    if (config.approve) {
      for (const item of items.docs)
        transaction.update(item.ref, {
          approvedQuantity: item.get("plannedQuantity"),
          outstandingQuantity: item.get("plannedQuantity"),
          itemStatus: "approved",
          updatedAt: now,
        });
      const approval = db.collection("transferApprovals").doc();
      transaction.create(approval, {
        organizationId: actor.organizationId,
        transferId: input.transferId,
        transferVersion: input.expectedVersion,
        stage: "operational_approval",
        decision: "approved",
        approverId: actor.userId,
        approverRoleId: actor.roleId,
        reason: input.reason ?? null,
        createdAt: now,
        correlationId: cid,
      });
    }
    event(transaction, actor, transfer, config.eventType, cid, {
      fromStatus: transfer.get("status"),
      toStatus: config.to,
      transferVersion: nextVersion,
      reason: input.reason,
    });
    notification(
      transaction,
      actor,
      transfer,
      config.eventType === "approved" ? "approved" : config.eventType,
      input.idempotencyKey,
    );
    operation(transaction, op, actor, config.action, input.transferId);
    writeAuditLog(transaction, actor, {
      action: `transfer.${config.eventType}`,
      entityType: "transfer",
      entityId: input.transferId,
      reason: input.reason,
      correlationId: cid,
      sourceFunction: config.action,
      before: { status: transfer.get("status") },
      after: { status: config.to, version: nextVersion },
    });
    return {
      transferId: input.transferId,
      changed: true,
      version: nextVersion,
    };
  });
}
const actionCallable = (config: Parameters<typeof transition>[2]) =>
  onCall({ enforceAppCheck }, async (request) =>
    transition(
      await requireAccess(request),
      parseInput(transferActionInput, request.data),
      config,
    ),
  );
export const submitTransfer = actionCallable({
  action: "submitTransfer",
  permission: "transfers.submit",
  from: ["draft", "changes_requested"],
  to: "submitted",
  eventType: "submitted",
});
export const startTransferReview = actionCallable({
  action: "startTransferReview",
  permission: "transfers.review",
  from: ["submitted"],
  to: "under_review",
  eventType: "review_started",
});
export const requestTransferChanges = actionCallable({
  action: "requestTransferChanges",
  permission: "transfers.review",
  from: ["submitted", "under_review"],
  to: "changes_requested",
  eventType: "changes_requested",
});
export const approveTransfer = actionCallable({
  action: "approveTransfer",
  permission: "transfers.approve",
  from: ["submitted", "under_review"],
  to: "approved",
  eventType: "approved",
  makerCheck: true,
  approve: true,
});
export const rejectTransfer = actionCallable({
  action: "rejectTransfer",
  permission: "transfers.approve",
  from: ["submitted", "under_review"],
  to: "cancelled",
  eventType: "cancelled",
  makerCheck: true,
});

export const reserveTransferStock = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "transfers.reserve");
    const input = parseInput(reserveTransferInput, request.data);
    const transfer = await transferRef(input.transferId).get();
    assertTransferScope(actor, transfer);
    requireWarehouseScope(actor, String(transfer.get("originWarehouseId")));
    if (number(transfer, "version") !== input.expectedVersion)
      throw new HttpsError("aborted", "The transfer version changed.");
    const itemDocs = await db
      .collection("transferItems")
      .where("transferId", "==", input.transferId)
      .get();
    const byId = new Map(itemDocs.docs.map((doc) => [doc.id, doc]));
    const supplied =
      input.lines ??
      itemDocs.docs.map((doc) => ({
        transferItemId: doc.id,
        productId: String(doc.get("productId")),
        quantity:
          number(doc, "approvedQuantity") - number(doc, "reservedQuantity"),
        serialItemIds: [],
        lotAllocations: [],
      }));
    const lines: ReservationLine[] = supplied
      .filter((line) => line.quantity > 0)
      .map((line) => {
        const item = byId.get(line.transferItemId);
        if (!item || item.get("productId") !== line.productId)
          throw new HttpsError(
            "invalid-argument",
            "Reservation item identity is invalid.",
          );
        return {
          transferItemId: line.transferItemId,
          productId: line.productId,
          quantity: line.quantity,
          serialItemIds: line.serialItemIds,
          lotAllocations: line.lotAllocations,
        };
      });
    return reserveTransferStockService(
      actor,
      input.transferId,
      lines,
      input.idempotencyKey,
      correlationId(),
    );
  },
);
export const releaseTransferReservation = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "transfers.release_reservation");
    const input = parseInput(releaseReservationInput, request.data);
    const transfer = await transferRef(input.transferId).get();
    assertTransferScope(actor, transfer);
    if (number(transfer, "version") !== input.expectedVersion)
      throw new HttpsError("aborted", "The transfer version changed.");
    return releaseTransferReservationService(
      actor,
      input.transferId,
      input.reservationIds,
      input.idempotencyKey,
      correlationId(),
    );
  },
);

export const startTransferPicking = actionCallable({
  action: "startTransferPicking",
  permission: "transfers.pick",
  from: ["reserved", "partially_reserved"],
  to: "picking",
  eventType: "picking_started",
});
export const recordPickedItems = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "transfers.pick");
    const input = parseInput(pickedItemsInput, request.data);
    const ref = transferRef(input.transferId);
    const op = operationRef(actor, "recordPickedItems", input.idempotencyKey);
    const cid = correlationId();
    return db.runTransaction(async (transaction) => {
      const itemRefs = input.lines.map((line) =>
        db.doc(`transferItems/${line.transferItemId}`),
      );
      const serialRefs = input.lines.flatMap((line) =>
        line.serialItemIds.map((id) => db.doc(`serializedItems/${id}`)),
      );
      const snapshots = await transaction.getAll(
        op,
        ref,
        ...itemRefs,
        ...serialRefs,
      );
      let cursor = 0;
      if (snapshots[cursor++]!.exists)
        return { transferId: input.transferId, picked: false };
      const transfer = snapshots[cursor++]!;
      const items = snapshots.slice(cursor, (cursor += itemRefs.length));
      const serials = snapshots.slice(cursor);
      assertTransferScope(actor, transfer);
      requireWarehouseScope(actor, String(transfer.get("originWarehouseId")));
      if (
        ![
          "picking",
          "reserved",
          "partially_reserved",
          "partially_picked",
        ].includes(String(transfer.get("status"))) ||
        number(transfer, "version") !== input.expectedVersion
      )
        throw new HttpsError(
          "failed-precondition",
          "Transfer is not ready for picking.",
        );
      let serialCursor = 0;
      let total = 0;
      const pick = db.collection("transferPicks").doc();
      const now = FieldValue.serverTimestamp();
      for (let index = 0; index < input.lines.length; index++) {
        const line = input.lines[index]!;
        const item = items[index]!;
        if (
          !item.exists ||
          item.get("transferId") !== input.transferId ||
          number(item, "pickedQuantity") + line.quantity >
            number(item, "reservedQuantity")
        )
          throw new HttpsError(
            "failed-precondition",
            "Picked quantity exceeds reservation.",
          );
        if (
          item.get("trackingType") === "serial" &&
          line.serialItemIds.length !== line.quantity
        )
          throw new HttpsError(
            "invalid-argument",
            "Picked serial count must equal quantity.",
          );
        for (const serialId of line.serialItemIds) {
          const serial = serials[serialCursor++]!;
          if (
            !serial.exists ||
            serial.id !== serialId ||
            serial.get("reservedTransferId") !== input.transferId ||
            serial.get("status") !== "reserved"
          )
            throw new HttpsError(
              "failed-precondition",
              "An unreserved serial cannot be picked.",
            );
        }
        const next = number(item, "pickedQuantity") + line.quantity;
        transaction.update(item.ref, {
          pickedQuantity: next,
          itemStatus:
            next === number(item, "approvedQuantity")
              ? "picked"
              : "partially_picked",
          updatedAt: now,
        });
        transaction.create(db.collection("transferPickItems").doc(), {
          organizationId: actor.organizationId,
          transferId: input.transferId,
          pickId: pick.id,
          transferItemId: item.id,
          productId: item.get("productId"),
          sku: item.get("sku"),
          reservedQuantity: item.get("reservedQuantity"),
          pickedQuantity: line.quantity,
          serialItemIds: line.serialItemIds,
          lotAllocations: line.lotAllocations,
          varianceReason: line.varianceReason ?? null,
          pickerNote: input.pickerNote ?? null,
          pickedBy: actor.userId,
          createdAt: now,
        });
        total += line.quantity;
      }
      const nextTotal = number(transfer, "totalPickedQuantity") + total;
      transaction.create(pick, {
        organizationId: actor.organizationId,
        transferId: input.transferId,
        originWarehouseId: transfer.get("originWarehouseId"),
        pickerId: actor.userId,
        status: "awaiting_check",
        quantity: total,
        startedAt: now,
        completedAt: now,
        createdAt: now,
      });
      transaction.update(ref, {
        totalPickedQuantity: nextTotal,
        status:
          nextTotal === number(transfer, "totalApprovedQuantity")
            ? "picked"
            : "partially_picked",
        updatedAt: now,
        updatedBy: actor.userId,
      });
      event(transaction, actor, transfer, "item_picked", cid, {
        pickId: pick.id,
        quantity: total,
      });
      operation(transaction, op, actor, "recordPickedItems", input.transferId);
      writeAuditLog(transaction, actor, {
        action: "transfer.picked",
        entityType: "transferPick",
        entityId: pick.id,
        correlationId: cid,
        sourceFunction: "recordPickedItems",
        after: { quantity: total },
      });
      return { transferId: input.transferId, pickId: pick.id, picked: true };
    });
  },
);
export const verifyPickedItems = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "transfers.check_pick");
    const input = parseInput(verifyPickInput, request.data);
    const ref = transferRef(input.transferId);
    const pickRef = db.doc(`transferPicks/${input.pickId}`);
    const op = operationRef(actor, "verifyPickedItems", input.idempotencyKey);
    const cid = correlationId();
    return db.runTransaction(async (transaction) => {
      const [previous, transfer, pick] = (await transaction.getAll(
        op,
        ref,
        pickRef,
      )) as [Snapshot, Snapshot, Snapshot];
      if (previous.exists) return { verified: false };
      assertTransferScope(actor, transfer);
      if (
        !pick.exists ||
        pick.get("transferId") !== input.transferId ||
        pick.get("status") !== "awaiting_check"
      )
        throw new HttpsError(
          "failed-precondition",
          "Pick is not awaiting verification.",
        );
      if (pick.get("pickerId") === actor.userId)
        throw new HttpsError(
          "permission-denied",
          "Picker and checker must be different users.",
        );
      requireWarehouseScope(actor, String(transfer.get("originWarehouseId")));
      const now = FieldValue.serverTimestamp();
      transaction.update(pickRef, {
        status: input.accepted ? "verified" : "rejected",
        checkedBy: actor.userId,
        checkedAt: now,
        checkerNote: input.note ?? null,
      });
      if (!input.accepted)
        transaction.update(ref, {
          status: "picking",
          updatedAt: now,
          updatedBy: actor.userId,
        });
      event(
        transaction,
        actor,
        transfer,
        input.accepted ? "picking_completed" : "picking_started",
        cid,
        { pickId: input.pickId, accepted: input.accepted },
      );
      operation(transaction, op, actor, "verifyPickedItems", input.transferId);
      writeAuditLog(transaction, actor, {
        action: "transfer.pick_verified",
        entityType: "transferPick",
        entityId: input.pickId,
        correlationId: cid,
        sourceFunction: "verifyPickedItems",
        after: { accepted: input.accepted },
      });
      return { verified: true, accepted: input.accepted };
    });
  },
);

export const createTransferPackage = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "transfers.pack");
    const input = parseInput(packageInput, request.data);
    const ref = transferRef(input.transferId);
    const op = operationRef(
      actor,
      "createTransferPackage",
      input.idempotencyKey,
    );
    const cid = correlationId();
    return db.runTransaction(async (transaction) => {
      const itemRefs = input.lines.map((line) =>
        db.doc(`transferItems/${line.transferItemId}`),
      );
      const snapshots = await transaction.getAll(op, ref, ...itemRefs);
      let cursor = 0;
      if (snapshots[cursor++]!.exists)
        return {
          packageId: String(snapshots[0]!.get("resultId")),
          created: false,
        };
      const transfer = snapshots[cursor++]!;
      const items = snapshots.slice(cursor);
      assertTransferScope(actor, transfer);
      if (
        !["picked", "partially_picked", "packing"].includes(
          String(transfer.get("status")),
        )
      )
        throw new HttpsError(
          "failed-precondition",
          "Transfer is not ready for packing.",
        );
      const pkg = db.collection("transferPackages").doc();
      const existingPackages = await transaction.get(
        db
          .collection("transferPackages")
          .where("transferId", "==", input.transferId),
      );
      const [existingPackageItems, pickedItems] = await Promise.all([
        transaction.get(db.collection("transferPackageItems").where("transferId", "==", input.transferId)),
        transaction.get(db.collection("transferPickItems").where("transferId", "==", input.transferId)),
      ]);
      const alreadyPackedSerials = new Set(existingPackageItems.docs.flatMap((item) => (item.get("serialItemIds") as string[] | undefined) ?? []));
      const pickedSerials = new Set(pickedItems.docs.flatMap((item) => (item.get("serialItemIds") as string[] | undefined) ?? []));
      const packageNumber = `${transfer.get("transferNumber")}-PKG-${String(existingPackages.size + 1).padStart(3, "0")}`;
      const allSerials = new Set<string>();
      const now = FieldValue.serverTimestamp();
      let total = 0;
      for (let index = 0; index < input.lines.length; index++) {
        const line = input.lines[index]!;
        const item = items[index]!;
        if (
          !item.exists ||
          item.get("transferId") !== input.transferId ||
          number(item, "packedQuantity") + line.quantity >
            number(item, "pickedQuantity")
        )
          throw new HttpsError(
            "failed-precondition",
            "Packed quantity exceeds picked quantity.",
          );
        for (const serial of line.serialItemIds) {
          if (allSerials.has(serial) || alreadyPackedSerials.has(serial))
            throw new HttpsError(
              "invalid-argument",
              "A serial cannot be packed twice.",
            );
          if (!pickedSerials.has(serial))
            throw new HttpsError(
              "failed-precondition",
              "Only a picked serial can be packed.",
            );
          allSerials.add(serial);
        }
        if (item.get("trackingType") === "serial" && line.serialItemIds.length !== line.quantity)
          throw new HttpsError("invalid-argument", "Packed serial count must equal quantity.");
        if (item.get("trackingType") === "batch" && line.lotAllocations.reduce((total, lot) => total + lot.quantity, 0) !== line.quantity)
          throw new HttpsError("invalid-argument", "Packed lot allocations must equal quantity.");
        transaction.create(db.collection("transferPackageItems").doc(), {
          organizationId: actor.organizationId,
          transferId: input.transferId,
          packageId: pkg.id,
          transferItemId: item.id,
          productId: item.get("productId"),
          sku: item.get("sku"),
          quantity: line.quantity,
          serialItemIds: line.serialItemIds,
          lotAllocations: line.lotAllocations,
          createdAt: now,
        });
        total += line.quantity;
      }
      transaction.create(
        pkg,
        clean({
          organizationId: actor.organizationId,
          transferId: input.transferId,
          packageNumber,
          packageType: input.packageType,
          weightKg: input.weightKg,
          lengthCm: input.dimensions?.lengthCm,
          widthCm: input.dimensions?.widthCm,
          heightCm: input.dimensions?.heightCm,
          sealNumber: input.sealNumber,
          barcodeValue: packageNumber,
          qrCodeValue: packageNumber,
          status: "open",
          packedBy: actor.userId,
          notes: input.notes,
          quantity: total,
          createdAt: now,
          updatedAt: now,
        }),
      );
      transaction.update(ref, {
        status: "packing",
        updatedAt: now,
        updatedBy: actor.userId,
      });
      transaction.create(op, {
        organizationId: actor.organizationId,
        action: "createTransferPackage",
        entityId: input.transferId,
        resultId: pkg.id,
        status: "completed",
        createdAt: now,
        createdBy: actor.userId,
      });
      event(transaction, actor, transfer, "packing_started", cid, {
        packageId: pkg.id,
      });
      return { packageId: pkg.id, packageNumber, created: true };
    });
  },
);
export const updateTransferPackage = createTransferPackage;
export const sealTransferPackage = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "transfers.pack");
    const input = parseInput(packageActionInput, request.data);
    const ref = transferRef(input.transferId);
    const pkgRef = db.doc(`transferPackages/${input.packageId}`);
    const op = operationRef(actor, "sealTransferPackage", input.idempotencyKey);
    const cid = correlationId();
    return db.runTransaction(async (transaction) => {
      const [previous, transfer, pkg] = (await transaction.getAll(
        op,
        ref,
        pkgRef,
      )) as [Snapshot, Snapshot, Snapshot];
      if (previous.exists) return { sealed: false };
      const packageItems = await transaction.get(
        db
          .collection("transferPackageItems")
          .where("packageId", "==", input.packageId),
      );
      const transferItemRefs = packageItems.docs.map((item) =>
        db.doc(`transferItems/${String(item.get("transferItemId"))}`),
      );
      const transferItems = await transaction.getAll(...transferItemRefs);
      assertTransferScope(actor, transfer);
      if (
        !pkg.exists ||
        pkg.get("transferId") !== input.transferId ||
        pkg.get("status") !== "open"
      )
        throw new HttpsError("failed-precondition", "Package is not open.");
      const now = FieldValue.serverTimestamp();
      let total = 0;
      for (let index = 0; index < packageItems.size; index++) {
        const packageItem = packageItems.docs[index]!;
        const item = transferItems[index]!;
        const qty = number(packageItem, "quantity");
        if (
          number(item, "packedQuantity") + qty >
          number(item, "pickedQuantity")
        )
          throw new HttpsError(
            "failed-precondition",
            "Package would exceed picked quantity.",
          );
        transaction.update(item.ref, {
          packedQuantity: number(item, "packedQuantity") + qty,
          itemStatus:
            number(item, "packedQuantity") + qty ===
            number(item, "approvedQuantity")
              ? "packed"
              : item.get("itemStatus"),
          updatedAt: now,
        });
        total += qty;
      }
      const next = number(transfer, "totalPackedQuantity") + total;
      transaction.update(pkgRef, {
        status: "sealed",
        sealedAt: now,
        updatedAt: now,
      });
      transaction.update(ref, {
        totalPackedQuantity: next,
        status:
          next === number(transfer, "totalApprovedQuantity")
            ? "ready_for_dispatch"
            : "packing",
        updatedAt: now,
        updatedBy: actor.userId,
      });
      event(transaction, actor, transfer, "packing_completed", cid, {
        packageId: input.packageId,
        quantity: total,
      });
      operation(
        transaction,
        op,
        actor,
        "sealTransferPackage",
        input.transferId,
      );
      return { sealed: true };
    });
  },
);
export const verifyPacking = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request);
  requirePermission(actor, "transfers.check_pack");
  const input = parseInput(packageActionInput, request.data);
  const pkg = await db.doc(`transferPackages/${input.packageId}`).get();
  if (
    !pkg.exists ||
    pkg.get("transferId") !== input.transferId ||
    pkg.get("organizationId") !== actor.organizationId ||
    pkg.get("status") !== "sealed"
  )
    throw new HttpsError("failed-precondition", "Sealed package not found.");
  if (pkg.get("packedBy") === actor.userId)
    throw new HttpsError(
      "permission-denied",
      "Packer and checker must be different users.",
    );
  await pkg.ref.update({
    checkedBy: actor.userId,
    checkedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { verified: true };
});

export const createTransferDispatch = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "transfers.dispatch");
    const input = parseInput(dispatchInput, request.data);
    const ref = transferRef(input.transferId);
    const op = operationRef(
      actor,
      "createTransferDispatch",
      input.idempotencyKey,
    );
    const cid = correlationId();
    return db.runTransaction(async (transaction) => {
      const packageRefs = input.packageIds.map((id) =>
        db.doc(`transferPackages/${id}`),
      );
      const [previous, transfer, ...packages] = (await transaction.getAll(
        op,
        ref,
        ...packageRefs,
      )) as [Snapshot, Snapshot, ...Snapshot[]];
      if (previous.exists)
        return { dispatchId: String(previous.get("resultId")), created: false };
      assertTransferScope(actor, transfer);
      requireWarehouseScope(actor, String(transfer.get("originWarehouseId")));
      if (
        !["ready_for_dispatch", "packing", "partially_dispatched"].includes(
          String(transfer.get("status")),
        ) ||
        number(transfer, "version") !== input.expectedVersion
      )
        throw new HttpsError(
          "failed-precondition",
          "Transfer is not ready for dispatch.",
        );
      for (const pkg of packages)
        if (
          !pkg.exists ||
          pkg.get("transferId") !== input.transferId ||
          pkg.get("status") !== "sealed" ||
          !pkg.get("checkedBy")
        )
          throw new HttpsError(
            "failed-precondition",
            "Every dispatch package must be sealed and independently checked.",
          );
      if (input.verifiedBy === actor.userId)
        throw new HttpsError(
          "permission-denied",
          "Dispatcher and verifier must be different users.",
        );
      const verifier = await transaction.get(
        db.doc(`users/${input.verifiedBy}`),
      );
      if (
        !verifier.exists ||
        verifier.get("organizationId") !== actor.organizationId ||
        verifier.get("status") !== "active" ||
        !(verifier.get("warehouseIds") as string[] | undefined)?.includes(
          String(transfer.get("originWarehouseId")),
        )
      )
        throw new HttpsError(
          "permission-denied",
          "Dispatch verifier is not assigned to the origin warehouse.",
        );
      const counter = db.doc(`transferDispatchCounters/${input.transferId}`);
      const counterDoc = await transaction.get(counter);
      const sequence = number(counterDoc, "value") + 1;
      const dispatch = db.collection("transferDispatches").doc();
      const dispatchNumber = `${transfer.get("transferNumber")}-DSP-${String(sequence).padStart(3, "0")}`;
      const dispatchQuantity = packages.reduce(
        (total, pkg) => total + number(pkg, "quantity"),
        0,
      );
      const now = FieldValue.serverTimestamp();
      transaction.set(
        counter,
        {
          organizationId: actor.organizationId,
          transferId: input.transferId,
          value: sequence,
          updatedAt: now,
        },
        { merge: true },
      );
      transaction.create(
        dispatch,
        clean({
          organizationId: actor.organizationId,
          transferId: input.transferId,
          dispatchNumber,
          originWarehouseId: transfer.get("originWarehouseId"),
          destinationBranchId: transfer.get("destinationBranchId"),
          vehicleId: input.vehicleId,
          vehicleRegistration: input.vehicleRegistration,
          driverName: input.driverName,
          driverPhoneNumber: input.driverPhoneNumber,
          transportCompany: input.transportCompany,
          waybillNumber: input.waybillNumber,
          packageIds: input.packageIds,
          quantity: dispatchQuantity,
          expectedArrivalAt: input.expectedArrivalAt
            ? Timestamp.fromDate(new Date(input.expectedArrivalAt))
            : undefined,
          dispatchedBy: actor.userId,
          verifiedBy: input.verifiedBy,
          status: "draft",
          inventoryTransactionIds: [],
          createdAt: now,
          updatedAt: now,
        }),
      );
      transaction.create(op, {
        organizationId: actor.organizationId,
        action: "createTransferDispatch",
        entityId: input.transferId,
        resultId: dispatch.id,
        status: "completed",
        createdAt: now,
        createdBy: actor.userId,
      });
      event(transaction, actor, transfer, "dispatch_created", cid, {
        dispatchId: dispatch.id,
        dispatchNumber,
      });
      return { dispatchId: dispatch.id, dispatchNumber, created: true };
    });
  },
);

export const confirmTransferDispatch = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "transfers.dispatch");
    const input = parseInput(dispatchInput, request.data);
    if (!input.dispatchId)
      throw new HttpsError("invalid-argument", "Dispatch ID is required.");
    const ref = transferRef(input.transferId);
    const dispatchRef = db.doc(`transferDispatches/${input.dispatchId}`);
    const confirmOp = operationRef(actor, "confirmTransferDispatch", input.idempotencyKey);
    const [priorConfirmation, transfer, dispatch] = (await db.getAll(confirmOp, ref, dispatchRef)) as [
      Snapshot,
      Snapshot,
      Snapshot,
    ];
    if (priorConfirmation.exists)
      return { dispatchId: input.dispatchId, confirmed: false, inventoryTransactionIds: priorConfirmation.get("inventoryTransactionIds") ?? [] };
    assertTransferScope(actor, transfer);
    requireWarehouseScope(actor, String(transfer.get("originWarehouseId")));
    if (
      !dispatch.exists ||
      dispatch.get("transferId") !== input.transferId ||
      dispatch.get("status") !== "draft" ||
      number(transfer, "version") !== input.expectedVersion
    )
      throw new HttpsError(
        "failed-precondition",
        "Dispatch is not awaiting confirmation.",
      );
    if (dispatch.get("dispatchedBy") === dispatch.get("verifiedBy"))
      throw new HttpsError(
        "permission-denied",
        "Dispatcher and verifier must be different users.",
      );
    await assertTransferInvariantGate(actor.organizationId, input.transferId, "before_dispatch");
    const packageIds = dispatch.get("packageIds") as string[];
    const packageItems = await db
      .collection("transferPackageItems")
      .where("packageId", "in", packageIds.slice(0, 30))
      .get();
    const grouped = new Map<
      string,
      {
        itemId: string;
        productId: string;
        quantity: number;
        serialItemIds: string[];
        lotAllocations: { lotId: string; quantity: number }[];
      }
    >();
    for (const row of packageItems.docs) {
      const itemIdValue = String(row.get("transferItemId"));
      const current = grouped.get(itemIdValue) ?? {
        itemId: itemIdValue,
        productId: String(row.get("productId")),
        quantity: 0,
        serialItemIds: [],
        lotAllocations: [],
      };
      current.quantity += number(row, "quantity");
      current.serialItemIds.push(
        ...((row.get("serialItemIds") as string[] | undefined) ?? []),
      );
      current.lotAllocations.push(
        ...((row.get("lotAllocations") as { lotId: string; quantity: number }[] | undefined) ?? []),
      );
      grouped.set(itemIdValue, current);
    }
    const transactionIds: string[] = [];
    const cid = correlationId();
    for (const line of grouped.values()) {
      const reservation = await db
        .doc(`stockReservations/${input.transferId}__${line.itemId}`)
        .get();
      if (
        !reservation.exists ||
        number(reservation, "remainingQuantity") < line.quantity
      )
        throw new HttpsError(
          "failed-precondition",
          "Dispatch exceeds active reservation.",
        );
      const movements = line.lotAllocations.length
        ? line.lotAllocations
        : [{ lotId: undefined, quantity: line.quantity }];
      for (let movementIndex = 0; movementIndex < movements.length; movementIndex++) {
        const movement = movements[movementIndex]!;
        const posted = await postInventoryTransaction(actor, {
          transactionType: "transfer_dispatch",
          productId: line.productId,
          quantity: movement.quantity,
          sourceLocationId: String(transfer.get("originLocationId")),
          destinationLocationId: String(transfer.get("transitLocationId")),
          serialNumbers: await serialNumbersForIds(actor, line.productId, line.serialItemIds),
          lotId: movement.lotId,
          effectiveAt: new Date().toISOString(),
          reason: "Confirmed warehouse transfer dispatch",
          referenceType: "transfer_dispatch",
          referenceId: input.dispatchId,
          referenceNumber: String(dispatch.get("dispatchNumber")),
          idempotencyKey: `${input.idempotencyKey.slice(0, 22)}-${line.itemId.slice(-20)}-${movementIndex}`,
          correlationId: cid,
          sourceFunction: "confirmTransferDispatch",
          transferContext: {
            transferId: input.transferId,
            consumeReservedQuantity: movement.quantity,
          },
        });
        transactionIds.push(posted.transactionId);
      }
    }
    return db.runTransaction(async (transaction) => {
      const [currentConfirmation, currentTransfer, currentDispatch] = (await transaction.getAll(
        confirmOp,
        ref,
        dispatchRef,
      )) as [Snapshot, Snapshot, Snapshot];
      if (currentConfirmation.exists)
        return { dispatchId: input.dispatchId, confirmed: false, inventoryTransactionIds: currentConfirmation.get("inventoryTransactionIds") ?? [] };
      if (currentDispatch.get("status") !== "draft")
        return {
          dispatchId: input.dispatchId,
          confirmed: false,
          inventoryTransactionIds: currentDispatch.get(
            "inventoryTransactionIds",
          ),
        };
      const itemRefs = [...grouped.values()].map((line) =>
        db.doc(`transferItems/${line.itemId}`),
      );
      const reservationRefs = [...grouped.values()].map((line) =>
        db.doc(`stockReservations/${input.transferId}__${line.itemId}`),
      );
      const snapshots = await transaction.getAll(
        ...itemRefs,
        ...reservationRefs,
      );
      const items = snapshots.slice(0, itemRefs.length);
      const reservations = snapshots.slice(itemRefs.length);
      let total = 0;
      const now = FieldValue.serverTimestamp();
      let index = 0;
      for (const line of grouped.values()) {
        const item = items[index]!;
        const reservation = reservations[index++]!;
        const dispatched = number(item, "dispatchedQuantity") + line.quantity;
        const remaining =
          number(reservation, "remainingQuantity") - line.quantity;
        transaction.update(item.ref, {
          dispatchedQuantity: dispatched,
          outstandingQuantity: Math.max(
            0,
            number(item, "approvedQuantity") -
              number(item, "receivedQuantity") -
              number(item, "damagedQuantity") -
              number(item, "returnedQuantity") -
              number(item, "writtenOffQuantity") -
              number(item, "cancelledQuantity"),
          ),
          itemStatus:
            dispatched === number(item, "approvedQuantity")
              ? "dispatched"
              : "partially_dispatched",
          updatedAt: now,
        });
        transaction.update(reservation.ref, {
          consumedQuantity:
            number(reservation, "consumedQuantity") + line.quantity,
          remainingQuantity: remaining,
          status: remaining === 0 ? "consumed" : "partially_consumed",
          updatedAt: now,
        });
        total += line.quantity;
      }
      const next = number(currentTransfer, "totalDispatchedQuantity") + total;
      const status =
        next === number(currentTransfer, "totalApprovedQuantity")
          ? "dispatched"
          : "partially_dispatched";
      transaction.update(dispatchRef, {
        status: "in_transit",
        dispatchedAt: now,
        inventoryTransactionIds: transactionIds,
        updatedAt: now,
      });
      for (const id of packageIds)
        transaction.update(db.doc(`transferPackages/${id}`), {
          status: "dispatched",
          updatedAt: now,
        });
      transaction.update(ref, {
        totalDispatchedQuantity: next,
        totalReservedQuantity: Math.max(
          0,
          number(currentTransfer, "totalReservedQuantity") - total,
        ),
        status,
        dispatchedAt: now,
        dispatchedBy: actor.userId,
        updatedAt: now,
        updatedBy: actor.userId,
      });
      operation(transaction, confirmOp, actor, "confirmTransferDispatch", input.transferId);
      transaction.update(confirmOp, { inventoryTransactionIds: transactionIds });
      event(transaction, actor, currentTransfer, "dispatched", cid, {
        dispatchId: input.dispatchId,
        quantity: total,
        inventoryTransactionIds: transactionIds,
      });
      notification(
        transaction,
        actor,
        currentTransfer,
        "dispatched",
        input.idempotencyKey,
      );
      writeAuditLog(transaction, actor, {
        action: "transfer.dispatched",
        entityType: "transferDispatch",
        entityId: input.dispatchId!,
        correlationId: cid,
        sourceFunction: "confirmTransferDispatch",
        after: { quantity: total, inventoryTransactionIds: transactionIds },
      });
      return {
        dispatchId: input.dispatchId,
        confirmed: true,
        inventoryTransactionIds: transactionIds,
      };
    });
  },
);

export const createTransferReceipt = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "transfers.receive");
    const input = parseInput(receiptInput, request.data);
    const ref = transferRef(input.transferId);
    const dispatchRef = db.doc(`transferDispatches/${input.dispatchId}`);
    const op = operationRef(
      actor,
      "createTransferReceipt",
      input.idempotencyKey,
    );
    const cid = correlationId();
    return db.runTransaction(async (transaction) => {
      const [previous, transfer, dispatch] = (await transaction.getAll(
        op,
        ref,
        dispatchRef,
      )) as [Snapshot, Snapshot, Snapshot];
      if (previous.exists)
        return { receiptId: String(previous.get("resultId")), created: false };
      assertTransferScope(actor, transfer);
      requireBranchScope(actor, String(transfer.get("destinationBranchId")));
      if (
        !dispatch.exists ||
        dispatch.get("transferId") !== input.transferId ||
        !["in_transit", "partially_received"].includes(
          String(dispatch.get("status")),
        ) ||
        number(transfer, "version") !== input.expectedVersion
      )
        throw new HttpsError(
          "failed-precondition",
          "Dispatch is not available for receipt.",
        );
      const counter = db.doc(`transferReceiptCounters/${input.dispatchId}`);
      const counterDoc = await transaction.get(counter);
      const sequence = number(counterDoc, "value") + 1;
      const receipt = db.collection("transferReceipts").doc();
      const receiptNumber = `${dispatch.get("dispatchNumber")}-RCV-${String(sequence).padStart(3, "0")}`;
      const now = FieldValue.serverTimestamp();
      transaction.set(
        counter,
        {
          organizationId: actor.organizationId,
          transferId: input.transferId,
          dispatchId: input.dispatchId,
          value: sequence,
          updatedAt: now,
        },
        { merge: true },
      );
      transaction.create(receipt, {
        organizationId: actor.organizationId,
        transferId: input.transferId,
        dispatchId: input.dispatchId,
        receiptNumber,
        destinationBranchId: transfer.get("destinationBranchId"),
        destinationLocationId: transfer.get("destinationLocationId"),
        deliveryCondition: input.deliveryCondition,
        receiverNote: input.receiverNote ?? null,
        signatureReference: input.signatureReference ?? null,
        photoReferences: input.photoReferences,
        receivedBy: actor.userId,
        status: "draft",
        inventoryTransactionIds: [],
        createdAt: now,
        updatedAt: now,
      });
      transaction.create(op, {
        organizationId: actor.organizationId,
        action: "createTransferReceipt",
        entityId: input.transferId,
        resultId: receipt.id,
        status: "completed",
        createdAt: now,
        createdBy: actor.userId,
      });
      event(transaction, actor, transfer, "receipt_recorded", cid, {
        receiptId: receipt.id,
        dispatchId: input.dispatchId,
      });
      return { receiptId: receipt.id, receiptNumber, created: true };
    });
  },
);

export const confirmTransferReceipt = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "transfers.receive");
    const input = parseInput(receiptInput, request.data);
    if (!input.receiptId)
      throw new HttpsError("invalid-argument", "Receipt ID is required.");
    const ref = transferRef(input.transferId);
    const dispatchRef = db.doc(`transferDispatches/${input.dispatchId}`);
    const receiptRef = db.doc(`transferReceipts/${input.receiptId}`);
    const confirmOp = operationRef(actor, "confirmTransferReceipt", input.idempotencyKey);
    const [priorConfirmation, transfer, dispatch, receipt] = (await db.getAll(
      confirmOp,
      ref,
      dispatchRef,
      receiptRef,
    )) as [Snapshot, Snapshot, Snapshot, Snapshot];
    if (priorConfirmation.exists)
      return { receiptId: input.receiptId, confirmed: false, inventoryTransactionIds: priorConfirmation.get("inventoryTransactionIds") ?? [] };
    assertTransferScope(actor, transfer);
    requireBranchScope(actor, String(transfer.get("destinationBranchId")));
    if (
      !dispatch.exists ||
      dispatch.get("transferId") !== input.transferId ||
      !receipt.exists ||
      receipt.get("dispatchId") !== input.dispatchId ||
      receipt.get("status") !== "draft" ||
      number(transfer, "version") !== input.expectedVersion
    )
      throw new HttpsError(
        "failed-precondition",
        "Receipt is not awaiting confirmation.",
      );
    if (dispatch.get("dispatchedBy") === actor.userId)
      throw new HttpsError(
        "permission-denied",
        "The dispatcher cannot confirm branch receipt.",
      );
    await assertTransferInvariantGate(actor.organizationId, input.transferId, "before_receipt");
    const itemRefs = input.lines.map((line) =>
      db.doc(`transferItems/${line.transferItemId}`),
    );
    const items = await db.getAll(...itemRefs);
    const cid = correlationId();
    await db.runTransaction(async (transaction) => {
      const claimRefs = input.lines.map((line) =>
        db.doc(
          `dispatchReceiptBalances/${input.dispatchId}__${line.transferItemId}`,
        ),
      );
      const receiptClaimRefs = input.lines.map((line) =>
        db.doc(
          `transferReceiptClaims/${input.receiptId}__${line.transferItemId}`,
        ),
      );
      const snapshots = await transaction.getAll(
        ...claimRefs,
        ...receiptClaimRefs,
      );
      const claims = snapshots.slice(0, claimRefs.length);
      const receiptClaims = snapshots.slice(claimRefs.length);
      const now = FieldValue.serverTimestamp();
      for (let index = 0; index < input.lines.length; index++) {
        if (receiptClaims[index]!.exists) continue;
        const line = input.lines[index]!;
        const item = items[index]!;
        if (!item.exists || item.get("transferId") !== input.transferId)
          throw new HttpsError(
            "failed-precondition",
            "Receipt item is invalid.",
          );
        const disposition =
          line.receivedQuantity + line.damagedQuantity + line.rejectedQuantity;
        if (disposition <= 0 && line.missingQuantity <= 0)
          throw new HttpsError(
            "invalid-argument",
            "Receipt line must record a disposition or missing quantity.",
          );
        const claimed = number(claims[index]!, "claimedQuantity");
        if (claimed + disposition > number(item, "dispatchedQuantity"))
          throw new HttpsError(
            "failed-precondition",
            "Receipt exceeds outstanding dispatched quantity.",
          );
        transaction.set(
          claimRefs[index]!,
          {
            organizationId: actor.organizationId,
            transferId: input.transferId,
            dispatchId: input.dispatchId,
            transferItemId: line.transferItemId,
            dispatchedQuantity: item.get("dispatchedQuantity"),
            claimedQuantity: claimed + disposition,
            updatedAt: now,
          },
          { merge: true },
        );
        transaction.create(receiptClaimRefs[index]!, {
          organizationId: actor.organizationId,
          transferId: input.transferId,
          dispatchId: input.dispatchId,
          receiptId: input.receiptId,
          transferItemId: line.transferItemId,
          quantity: disposition,
          createdAt: now,
        });
      }
    });
    const transactionIds: string[] = [];
    for (let index = 0; index < input.lines.length; index++) {
      const line = input.lines[index]!;
      const item = items[index]!;
      if (
        item.get("trackingType") === "batch" &&
        line.lotAllocations.reduce((total, allocation) => total + allocation.quantity, 0) !==
          line.receivedQuantity + line.damagedQuantity
      )
        throw new HttpsError(
          "invalid-argument",
          "Receipt lot allocations must equal received and damaged quantities.",
        );
      if (line.receivedQuantity > 0) {
        if (
          item.get("trackingType") === "serial" &&
          line.serialItemIds.length !== line.receivedQuantity
        )
          throw new HttpsError(
            "invalid-argument",
            "Accepted serial count must equal received quantity.",
          );
        const movements = item.get("trackingType") === "batch"
          ? line.lotAllocations.filter((allocation) => allocation.disposition === "received")
          : [{ lotId: undefined, quantity: line.receivedQuantity }];
        if (movements.reduce((total, movement) => total + movement.quantity, 0) !== line.receivedQuantity)
          throw new HttpsError("invalid-argument", "Received lot allocations do not reconcile.");
        for (let movementIndex = 0; movementIndex < movements.length; movementIndex++) {
          const movement = movements[movementIndex]!;
          const posted = await postInventoryTransaction(actor, {
            transactionType: "transfer_receipt",
            productId: String(item.get("productId")),
            quantity: movement.quantity,
            sourceLocationId: String(transfer.get("transitLocationId")),
            destinationLocationId: String(transfer.get("destinationLocationId")),
            serialNumbers: await serialNumbersForIds(actor, String(item.get("productId")), line.serialItemIds),
            lotId: movement.lotId,
            effectiveAt: new Date().toISOString(),
            reason: "Confirmed branch transfer receipt",
            referenceType: "transfer_receipt",
            referenceId: input.receiptId,
            referenceNumber: String(receipt.get("receiptNumber")),
            idempotencyKey: `${input.idempotencyKey.slice(0, 20)}-ok-${index}-${movementIndex}`,
            correlationId: cid,
            sourceFunction: "confirmTransferReceipt",
            transferContext: { transferId: input.transferId },
          });
          transactionIds.push(posted.transactionId);
        }
      }
      if (line.damagedQuantity > 0) {
        if (
          item.get("trackingType") === "serial" &&
          line.damagedSerialItemIds.length !== line.damagedQuantity
        )
          throw new HttpsError(
            "invalid-argument",
            "Damaged serial count must equal damaged quantity.",
          );
        const movements = item.get("trackingType") === "batch"
          ? line.lotAllocations.filter((allocation) => allocation.disposition === "damaged")
          : [{ lotId: undefined, quantity: line.damagedQuantity }];
        if (movements.reduce((total, movement) => total + movement.quantity, 0) !== line.damagedQuantity)
          throw new HttpsError("invalid-argument", "Damaged lot allocations do not reconcile.");
        for (let movementIndex = 0; movementIndex < movements.length; movementIndex++) {
          const movement = movements[movementIndex]!;
          const posted = await postInventoryTransaction(actor, {
            transactionType: "transfer_receipt",
            productId: String(item.get("productId")),
            quantity: movement.quantity,
            sourceLocationId: String(transfer.get("transitLocationId")),
            destinationLocationId: String(transfer.get("damagedLocationId")),
            serialNumbers: await serialNumbersForIds(actor, String(item.get("productId")), line.damagedSerialItemIds),
            lotId: movement.lotId,
            effectiveAt: new Date().toISOString(),
            reason: "Confirmed damaged branch transfer receipt",
            referenceType: "transfer_receipt_damage",
            referenceId: input.receiptId,
            referenceNumber: String(receipt.get("receiptNumber")),
            idempotencyKey: `${input.idempotencyKey.slice(0, 18)}-dmg-${index}-${movementIndex}`,
            correlationId: cid,
            sourceFunction: "confirmTransferReceipt",
            transferContext: { transferId: input.transferId },
          });
          transactionIds.push(posted.transactionId);
        }
      }
    }
    if (transfer.get("sourceType") === "branch_request") {
      const fulfilmentLines = input.lines
        .map((line, index) => ({
          requestItemId: String(items[index]!.get("sourceRequestItemId")),
          quantity: line.receivedQuantity,
        }))
        .filter((line) => line.quantity > 0);
      if (fulfilmentLines.length)
        await applyTransferFulfilmentToRequest(actor, {
          organizationId: actor.organizationId,
          requestId: String(transfer.get("sourceRequestId")),
          transferId: input.transferId,
          receiptId: input.receiptId,
          lines: fulfilmentLines,
          correlationId: cid,
        });
    }
    const dispatchClaimsSnapshot = await db
      .collection("dispatchReceiptBalances")
      .where("dispatchId", "==", input.dispatchId)
      .get();
    const cumulativeDispatchClaimed = dispatchClaimsSnapshot.docs.reduce(
      (total, claim) => total + number(claim, "claimedQuantity"),
      0,
    );
    return db.runTransaction(async (transaction) => {
      const [
        currentConfirmation,
        currentTransfer,
        currentDispatch,
        currentReceipt,
        ...currentItems
      ] = (await transaction.getAll(
        confirmOp,
        ref,
        dispatchRef,
        receiptRef,
        ...itemRefs,
      )) as [Snapshot, Snapshot, Snapshot, Snapshot, ...Snapshot[]];
      if (currentConfirmation.exists)
        return { receiptId: input.receiptId, confirmed: false, inventoryTransactionIds: currentConfirmation.get("inventoryTransactionIds") ?? [] };
      if (currentReceipt.get("status") !== "draft")
        return {
          receiptId: input.receiptId,
          confirmed: false,
          inventoryTransactionIds: currentReceipt.get(
            "inventoryTransactionIds",
          ),
        };
      let received = 0;
      let damaged = 0;
      let missing = 0;
      const now = FieldValue.serverTimestamp();
      for (let index = 0; index < input.lines.length; index++) {
        const line = input.lines[index]!;
        const item = currentItems[index]!;
        const nextReceived =
          number(item, "receivedQuantity") + line.receivedQuantity;
        const nextDamaged =
          number(item, "damagedQuantity") + line.damagedQuantity;
        transaction.update(item.ref, {
          receivedQuantity: nextReceived,
          damagedQuantity: nextDamaged,
          missingQuantity:
            number(item, "missingQuantity") + line.missingQuantity,
          rejectedAtReceiptQuantity:
            number(item, "rejectedAtReceiptQuantity") + line.rejectedQuantity,
          outstandingQuantity: Math.max(
            0,
            number(item, "approvedQuantity") -
              nextReceived -
              nextDamaged -
              number(item, "returnedQuantity") -
              number(item, "writtenOffQuantity") -
              number(item, "cancelledQuantity"),
          ),
          itemStatus:
            nextReceived === number(item, "approvedQuantity")
              ? "received"
              : line.missingQuantity + line.damagedQuantity > 0
                ? "disputed"
                : "partially_received",
          updatedAt: now,
        });
        transaction.create(db.collection("transferReceiptItems").doc(), {
          organizationId: actor.organizationId,
          transferId: input.transferId,
          dispatchId: input.dispatchId,
          receiptId: input.receiptId,
          transferItemId: line.transferItemId,
          productId: item.get("productId"),
          sku: item.get("sku"),
          dispatchedQuantity: item.get("dispatchedQuantity"),
          receivedQuantity: line.receivedQuantity,
          damagedQuantity: line.damagedQuantity,
          missingQuantity: line.missingQuantity,
          rejectedQuantity: line.rejectedQuantity,
          serialItemIds: line.serialItemIds,
          damagedSerialItemIds: line.damagedSerialItemIds,
          lotAllocations: line.lotAllocations,
          note: line.note ?? null,
          createdAt: now,
        });
        if (line.missingQuantity + line.damagedQuantity > 0) {
          const discrepancy = db.collection("transferDiscrepancies").doc();
          transaction.create(discrepancy, {
            organizationId: actor.organizationId,
            transferId: input.transferId,
            dispatchId: input.dispatchId,
            receiptId: input.receiptId,
            destinationBranchId: currentTransfer.get("destinationBranchId"),
            type:
              line.missingQuantity > 0
                ? "missing_quantity"
                : "damaged_quantity",
            quantity: line.missingQuantity + line.damagedQuantity,
            status: "open",
            description: line.note ?? "Discrepancy recorded during receipt",
            reportedBy: actor.userId,
            reportedAt: now,
            createdAt: now,
            updatedAt: now,
          });
          transaction.create(
            db.collection("transferDiscrepancyItems").doc(),
            {
              organizationId: actor.organizationId,
              transferId: input.transferId,
              discrepancyId: discrepancy.id,
              transferItemId: line.transferItemId,
              productId: item.get("productId"),
              sku: item.get("sku"),
              quantity: line.missingQuantity + line.damagedQuantity,
              serialItemIds:
                line.missingQuantity > 0
                  ? []
                  : line.damagedSerialItemIds,
              lotAllocations: line.lotAllocations,
              createdAt: now,
            },
          );
        }
        received += line.receivedQuantity;
        damaged += line.damagedQuantity;
        missing += line.missingQuantity;
      }
      const totalReceived =
        number(currentTransfer, "totalReceivedQuantity") + received;
      const totalDamaged =
        number(currentTransfer, "totalDamagedQuantity") + damaged;
      const totalMissing =
        number(currentTransfer, "totalMissingQuantity") + missing;
      const disputed = damaged + missing > 0;
      const transferStatus = disputed
        ? "disputed"
        : totalReceived === number(currentTransfer, "totalApprovedQuantity")
          ? "received"
          : "partially_received";
      const dispatchStatus =
        cumulativeDispatchClaimed >= number(currentDispatch, "quantity")
          ? disputed
            ? "disputed"
            : "received"
          : "partially_received";
      transaction.update(receiptRef, {
        status: disputed
          ? "disputed"
          : cumulativeDispatchClaimed >= number(currentDispatch, "quantity")
            ? "received"
            : "partially_received",
        receivedAt: now,
        inventoryTransactionIds: transactionIds,
        updatedAt: now,
      });
      transaction.update(dispatchRef, {
        status: dispatchStatus,
        updatedAt: now,
      });
      transaction.update(ref, {
        totalReceivedQuantity: totalReceived,
        totalDamagedQuantity: totalDamaged,
        totalMissingQuantity: totalMissing,
        totalOutstandingQuantity: Math.max(
          0,
          number(currentTransfer, "totalApprovedQuantity") -
            totalReceived -
            totalDamaged -
            number(currentTransfer, "totalReturnedQuantity") -
            number(currentTransfer, "totalWrittenOffQuantity") -
            number(currentTransfer, "cancelledRemainingQuantity"),
        ),
        status: transferStatus,
        receivedAt:
          transferStatus === "received"
            ? now
            : (currentTransfer.get("receivedAt") ?? null),
        receivedBy: actor.userId,
        updatedAt: now,
        updatedBy: actor.userId,
      });
      operation(transaction, confirmOp, actor, "confirmTransferReceipt", input.transferId);
      transaction.update(confirmOp, { inventoryTransactionIds: transactionIds });
      event(
        transaction,
        actor,
        currentTransfer,
        disputed
          ? "discrepancy_opened"
          : transferStatus === "received"
            ? "received"
            : "partially_received",
        cid,
        {
          receiptId: input.receiptId,
          dispatchId: input.dispatchId,
          receivedQuantity: received,
          damagedQuantity: damaged,
          missingQuantity: missing,
          inventoryTransactionIds: transactionIds,
        },
      );
      notification(
        transaction,
        actor,
        currentTransfer,
        disputed ? "discrepancy_opened" : transferStatus,
        input.idempotencyKey,
      );
      writeAuditLog(transaction, actor, {
        action: "transfer.received",
        entityType: "transferReceipt",
        entityId: input.receiptId!,
        correlationId: cid,
        sourceFunction: "confirmTransferReceipt",
        after: {
          received,
          damaged,
          missing,
          inventoryTransactionIds: transactionIds,
        },
      });
      return {
        receiptId: input.receiptId,
        confirmed: true,
        inventoryTransactionIds: transactionIds,
      };
    });
  },
);

export const reportTransferDiscrepancy = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "transfers.report_discrepancy");
    const input = parseInput(discrepancyInput, request.data);
    const ref = transferRef(input.transferId);
    const op = operationRef(
      actor,
      "reportTransferDiscrepancy",
      input.idempotencyKey,
    );
    const cid = correlationId();
    return db.runTransaction(async (transaction) => {
      const itemRefs = input.lines.map((line) =>
        db.doc(`transferItems/${line.transferItemId}`),
      );
      const serialRefs = input.lines.flatMap((line) =>
        line.serialItemIds.map((id) => db.doc(`serializedItems/${id}`)),
      );
      const snapshots = await transaction.getAll(
        op,
        ref,
        db.doc(`transferDispatches/${input.dispatchId}`),
        ...itemRefs,
        ...serialRefs,
      );
      const previous = snapshots[0]!;
      const transfer = snapshots[1]!;
      const dispatch = snapshots[2]!;
      const items = snapshots.slice(3, 3 + itemRefs.length);
      const serials = snapshots.slice(3 + itemRefs.length);
      if (previous.exists)
        return {
          discrepancyId: String(previous.get("resultId")),
          created: false,
        };
      assertTransferScope(actor, transfer);
      if (!dispatch.exists || dispatch.get("transferId") !== input.transferId)
        throw new HttpsError("failed-precondition", "Dispatch is unavailable.");
      const discrepancy = db.collection("transferDiscrepancies").doc();
      const now = FieldValue.serverTimestamp();
      let quantity = 0;
      let serialCursor = 0;
      for (let index = 0; index < input.lines.length; index++) {
        const line = input.lines[index]!;
        const item = items[index]!;
        if (!item.exists || item.get("transferId") !== input.transferId)
          throw new HttpsError(
            "failed-precondition",
            "Discrepancy item is invalid.",
          );
        if (input.type === "delivery_refused") {
          if (!input.receiptId || line.quantity > number(item, "receivedQuantity"))
            throw new HttpsError(
              "failed-precondition",
              "Returned quantity exceeds eligible received quantity.",
            );
          if (
            item.get("trackingType") === "serial" &&
            line.serialItemIds.length !== line.quantity
          )
            throw new HttpsError(
              "invalid-argument",
              "Returned serial count must equal quantity.",
            );
          for (const serialId of line.serialItemIds) {
            const serial = serials[serialCursor++]!;
            if (
              !serial.exists ||
              serial.id !== serialId ||
              serial.get("organizationId") !== actor.organizationId ||
              serial.get("productId") !== item.get("productId") ||
              serial.get("currentLocationId") !== transfer.get("destinationLocationId")
            )
              throw new HttpsError(
                "failed-precondition",
                "A returned serial is not eligible at the branch location.",
              );
          }
        } else {
          serialCursor += line.serialItemIds.length;
        }
        quantity += line.quantity;
        transaction.create(db.collection("transferDiscrepancyItems").doc(), {
          organizationId: actor.organizationId,
          transferId: input.transferId,
          dispatchId: input.dispatchId,
          receiptId: input.receiptId ?? null,
          discrepancyId: discrepancy.id,
          transferItemId: item.id,
          productId: item.get("productId"),
          sku: item.get("sku"),
          quantity: line.quantity,
          serialItemIds: line.serialItemIds,
          lotId: line.lotId ?? null,
          createdAt: now,
        });
      }
      transaction.create(discrepancy, {
        organizationId: actor.organizationId,
        transferId: input.transferId,
        dispatchId: input.dispatchId,
        receiptId: input.receiptId ?? null,
        destinationBranchId: transfer.get("destinationBranchId"),
        type: input.type,
        quantity,
        description: input.description,
        status: "open",
        reportedBy: actor.userId,
        reportedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      transaction.update(ref, {
        status: "disputed",
        updatedAt: now,
        updatedBy: actor.userId,
      });
      transaction.create(op, {
        organizationId: actor.organizationId,
        action: "reportTransferDiscrepancy",
        entityId: input.transferId,
        resultId: discrepancy.id,
        status: "completed",
        createdAt: now,
        createdBy: actor.userId,
      });
      event(transaction, actor, transfer, "discrepancy_opened", cid, {
        discrepancyId: discrepancy.id,
        type: input.type,
        quantity,
      });
      notification(
        transaction,
        actor,
        transfer,
        "discrepancy_opened",
        input.idempotencyKey,
      );
      writeAuditLog(transaction, actor, {
        action: "transfer.discrepancy_created",
        entityType: "transferDiscrepancy",
        entityId: discrepancy.id,
        correlationId: cid,
        sourceFunction: "reportTransferDiscrepancy",
        after: { type: input.type, quantity },
      });
      return { discrepancyId: discrepancy.id, created: true };
    });
  },
);
export const assignTransferDiscrepancy = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "transfers.resolve_discrepancy");
    const input = parseInput(resolveDiscrepancyInput, request.data);
    const discrepancy = await db
      .doc(`transferDiscrepancies/${input.discrepancyId}`)
      .get();
    if (
      !discrepancy.exists ||
      discrepancy.get("organizationId") !== actor.organizationId ||
      discrepancy.get("transferId") !== input.transferId
    )
      throw new HttpsError("not-found", "Discrepancy not found.");
    await discrepancy.ref.update({
      status: "under_investigation",
      assignedUserId: actor.userId,
      investigationNote: input.note,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { assigned: true };
  },
);
export const resolveTransferDiscrepancy = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "transfers.resolve_discrepancy");
    const input = parseInput(resolveDiscrepancyInput, request.data);
    const ref = transferRef(input.transferId);
    const discrepancyRef = db.doc(
      `transferDiscrepancies/${input.discrepancyId}`,
    );
    const [transfer, discrepancy] = (await db.getAll(ref, discrepancyRef)) as [
      Snapshot,
      Snapshot,
    ];
    assertTransferScope(actor, transfer);
    if (!discrepancy.exists || discrepancy.get("transferId") !== input.transferId)
      throw new HttpsError("failed-precondition", "Discrepancy is not open.");
    if (["resolved", "closed"].includes(String(discrepancy.get("status"))))
      return {
        resolved: false,
        inventoryTransactionIds:
          discrepancy.get("resolutionTransactionIds") ?? [],
      };
    const discrepancyType = String(discrepancy.get("type"));
    const branchReturn =
      input.resolutionType === "returned_to_warehouse" &&
      discrepancyType === "delivery_refused";
    if (branchReturn) {
      if (!input.resolutionLocationId)
        throw new HttpsError(
          "invalid-argument",
          "A controlled return or quarantine location is required.",
        );
      const destination = await db
        .doc(`inventoryLocations/${input.resolutionLocationId}`)
        .get();
      if (
        !destination.exists ||
        destination.get("organizationId") !== actor.organizationId ||
        destination.get("warehouseId") !== transfer.get("originWarehouseId") ||
        !["returned", "quarantined"].includes(String(destination.get("type")))
      )
        throw new HttpsError(
          "failed-precondition",
          "Return destination must be an origin-warehouse return or quarantine location.",
        );
      requireWarehouseScope(actor, String(transfer.get("originWarehouseId")));
    }
    const claimed = await db.runTransaction(async (transaction) => {
      const current = await transaction.get(discrepancyRef);
      if (["resolved", "closed"].includes(String(current.get("status"))))
        return false;
      if (
        current.get("resolutionInProgress") === true &&
        current.get("resolutionIdempotencyKey") !== input.idempotencyKey
      )
        throw new HttpsError(
          "aborted",
          "This discrepancy is already being resolved.",
        );
      transaction.update(discrepancyRef, {
        resolutionInProgress: true,
        resolutionIdempotencyKey: input.idempotencyKey,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return true;
    });
    if (!claimed) {
      const current = await discrepancyRef.get();
      return {
        resolved: false,
        inventoryTransactionIds:
          current.get("resolutionTransactionIds") ?? [],
      };
    }
    try {
    const lines = await db
      .collection("transferDiscrepancyItems")
      .where("discrepancyId", "==", input.discrepancyId)
      .get();
    const resolutionItems = lines.empty
      ? []
      : await db.getAll(
          ...lines.docs.map((line) =>
            db.doc(`transferItems/${String(line.get("transferItemId"))}`),
          ),
        );
    const transactionIds: string[] = [];
    const cid = correlationId();
    const requiresMovement =
      ["delivered_later", "returned_to_warehouse", "written_off"].includes(
        input.resolutionType,
      ) ||
      (input.resolutionType === "accepted_as_damaged" &&
        discrepancyType !== "damaged_quantity");
    if (requiresMovement && lines.empty)
      throw new HttpsError(
        "failed-precondition",
        "Discrepancy resolution requires item detail.",
      );
    for (let index = 0; index < lines.size && requiresMovement; index++) {
      const line = lines.docs[index]!;
      let sourceLocationId = branchReturn
        ? String(transfer.get("destinationLocationId"))
        : String(transfer.get("transitLocationId"));
      let destinationLocationId: string | undefined;
      if (input.resolutionType === "delivered_later")
        destinationLocationId = String(transfer.get("destinationLocationId"));
      if (input.resolutionType === "accepted_as_damaged")
        destinationLocationId = String(transfer.get("damagedLocationId"));
      if (input.resolutionType === "returned_to_warehouse")
        destinationLocationId =
          input.resolutionLocationId ??
          String(transfer.get("originLocationId"));
      if (
        input.resolutionType === "written_off" &&
        discrepancy.get("type") === "damaged_quantity"
      )
        sourceLocationId = String(transfer.get("damagedLocationId"));
      const posted = await postInventoryTransaction(actor, {
        transactionType: "discrepancy_resolution",
        productId: String(line.get("productId")),
        quantity: number(line, "quantity"),
        sourceLocationId,
        destinationLocationId,
        externalAccount: destinationLocationId
          ? undefined
          : "transfer_loss_write_off",
        serialNumbers: await serialNumbersForIds(
          actor,
          String(line.get("productId")),
          (line.get("serialItemIds") as string[] | undefined) ?? [],
        ),
        lotId: line.get("lotId") ?? undefined,
        effectiveAt: new Date().toISOString(),
        reason: input.note,
        referenceType: "transfer_discrepancy",
        referenceId: input.discrepancyId,
        referenceNumber: String(transfer.get("transferNumber")),
        idempotencyKey: `${input.idempotencyKey.slice(0, 25)}-res-${index}`,
        correlationId: cid,
        sourceFunction: "resolveTransferDiscrepancy",
        transferContext: { transferId: input.transferId },
      });
      transactionIds.push(posted.transactionId);
    }
    if (
      input.resolutionType === "delivered_later" &&
      transfer.get("sourceType") === "branch_request"
    ) {
      const fulfilmentLines = resolutionItems
        .map((item, index) => ({
          requestItemId: String(item.get("sourceRequestItemId") ?? ""),
          quantity: number(lines.docs[index]!, "quantity"),
        }))
        .filter((line) => line.requestItemId && line.quantity > 0);
      if (fulfilmentLines.length)
        await applyTransferFulfilmentToRequest(actor, {
          organizationId: actor.organizationId,
          requestId: String(transfer.get("sourceRequestId")),
          transferId: input.transferId,
          receiptId: `discrepancy-${input.discrepancyId}`,
          lines: fulfilmentLines,
          correlationId: cid,
        });
    }
    return await db.runTransaction(async (transaction) => {
      const itemRefs = lines.docs.map((line) =>
        db.doc(`transferItems/${String(line.get("transferItemId"))}`),
      );
      const resolutionDispatchRef = db.doc(
        `transferDispatches/${String(discrepancy.get("dispatchId"))}`,
      );
      const [
        currentTransfer,
        currentDiscrepancy,
        currentDispatch,
        ...currentItems
      ] = (await transaction.getAll(
        ref,
        discrepancyRef,
        resolutionDispatchRef,
        ...itemRefs,
      )) as [
          Snapshot,
          Snapshot,
          Snapshot,
          ...Snapshot[],
        ];
      if (
        currentDiscrepancy.get("status") === "resolved" ||
        currentDiscrepancy.get("status") === "closed"
      )
        return {
          resolved: false,
          inventoryTransactionIds: currentDiscrepancy.get(
            "resolutionTransactionIds",
          ),
        };
      const open = await transaction.get(
        db
          .collection("transferDiscrepancies")
          .where("transferId", "==", input.transferId)
          .where("status", "in", [
            "open",
            "under_investigation",
            "awaiting_warehouse",
            "awaiting_logistics",
            "awaiting_branch",
            "replacement_pending",
            "return_pending",
            "write_off_pending",
          ]),
      );
      const now = FieldValue.serverTimestamp();
      let resolvedQuantity = 0;
      for (let index = 0; index < lines.size; index++) {
        const line = lines.docs[index]!;
        const item = currentItems[index]!;
        const quantity = number(line, "quantity");
        if (!item.exists || item.get("transferId") !== input.transferId)
          throw new HttpsError(
            "failed-precondition",
            "Discrepancy item is invalid.",
          );
        const updates: RecordValue = { updatedAt: now };
        if (input.resolutionType === "delivered_later") {
          updates.receivedQuantity = number(item, "receivedQuantity") + quantity;
          updates.missingQuantity = Math.max(
            0,
            number(item, "missingQuantity") - quantity,
          );
        } else if (input.resolutionType === "returned_to_warehouse") {
          updates.returnedQuantity = number(item, "returnedQuantity") + quantity;
          if (branchReturn)
            updates.receivedQuantity = Math.max(
              0,
              number(item, "receivedQuantity") - quantity,
            );
          else
            updates.missingQuantity = Math.max(
              0,
              number(item, "missingQuantity") - quantity,
            );
        } else if (input.resolutionType === "accepted_as_damaged") {
          if (discrepancyType !== "damaged_quantity") {
            updates.damagedQuantity = number(item, "damagedQuantity") + quantity;
            updates.missingQuantity = Math.max(
              0,
              number(item, "missingQuantity") - quantity,
            );
          }
        } else if (input.resolutionType === "written_off") {
          updates.writtenOffQuantity =
            number(item, "writtenOffQuantity") + quantity;
          if (discrepancyType === "damaged_quantity")
            updates.damagedQuantity = Math.max(
              0,
              number(item, "damagedQuantity") - quantity,
            );
          else
            updates.missingQuantity = Math.max(
              0,
              number(item, "missingQuantity") - quantity,
            );
        }
        const nextDisposed =
          Number(updates.receivedQuantity ?? item.get("receivedQuantity") ?? 0) +
          Number(updates.damagedQuantity ?? item.get("damagedQuantity") ?? 0) +
          Number(updates.returnedQuantity ?? item.get("returnedQuantity") ?? 0) +
          Number(updates.writtenOffQuantity ?? item.get("writtenOffQuantity") ?? 0);
        updates.outstandingQuantity = Math.max(
          0,
          number(item, "approvedQuantity") -
            nextDisposed -
            number(item, "cancelledQuantity"),
        );
        updates.itemStatus =
          nextDisposed >= number(item, "approvedQuantity")
            ? "received"
            : "partially_received";
        transaction.update(item.ref, updates);
        resolvedQuantity += quantity;
      }
      transaction.update(discrepancyRef, {
        status: "resolved",
        resolutionInProgress: false,
        resolutionType: input.resolutionType,
        resolutionNote: input.note,
        resolutionTransactionIds: transactionIds,
        resolvedBy: actor.userId,
        resolvedAt: now,
        updatedAt: now,
      });
      const transferUpdates: RecordValue = {
        updatedAt: now,
        updatedBy: actor.userId,
      };
      if (input.resolutionType === "delivered_later") {
        transferUpdates.totalReceivedQuantity =
          number(currentTransfer, "totalReceivedQuantity") + resolvedQuantity;
        transferUpdates.totalMissingQuantity = Math.max(
          0,
          number(currentTransfer, "totalMissingQuantity") - resolvedQuantity,
        );
      } else if (input.resolutionType === "returned_to_warehouse") {
        transferUpdates.totalReturnedQuantity =
          number(currentTransfer, "totalReturnedQuantity") + resolvedQuantity;
        if (branchReturn)
          transferUpdates.totalReceivedQuantity = Math.max(
            0,
            number(currentTransfer, "totalReceivedQuantity") - resolvedQuantity,
          );
        else
          transferUpdates.totalMissingQuantity = Math.max(
            0,
            number(currentTransfer, "totalMissingQuantity") - resolvedQuantity,
          );
      } else if (
        input.resolutionType === "accepted_as_damaged" &&
        discrepancyType !== "damaged_quantity"
      ) {
        transferUpdates.totalDamagedQuantity =
          number(currentTransfer, "totalDamagedQuantity") + resolvedQuantity;
        transferUpdates.totalMissingQuantity = Math.max(
          0,
          number(currentTransfer, "totalMissingQuantity") - resolvedQuantity,
        );
      } else if (input.resolutionType === "written_off") {
        transferUpdates.totalWrittenOffQuantity =
          number(currentTransfer, "totalWrittenOffQuantity") + resolvedQuantity;
        if (discrepancyType === "damaged_quantity")
          transferUpdates.totalDamagedQuantity = Math.max(
            0,
            number(currentTransfer, "totalDamagedQuantity") - resolvedQuantity,
          );
        else
          transferUpdates.totalMissingQuantity = Math.max(
            0,
            number(currentTransfer, "totalMissingQuantity") - resolvedQuantity,
          );
      }
      const disposed =
        Number(
          transferUpdates.totalReceivedQuantity ??
            currentTransfer.get("totalReceivedQuantity") ??
            0,
        ) +
        Number(
          transferUpdates.totalDamagedQuantity ??
            currentTransfer.get("totalDamagedQuantity") ??
            0,
        ) +
        Number(
          transferUpdates.totalReturnedQuantity ??
            currentTransfer.get("totalReturnedQuantity") ??
            0,
        ) +
        Number(
          transferUpdates.totalWrittenOffQuantity ??
            currentTransfer.get("totalWrittenOffQuantity") ??
            0,
        );
      transferUpdates.totalOutstandingQuantity = Math.max(
        0,
        number(currentTransfer, "totalApprovedQuantity") -
          disposed -
          number(currentTransfer, "cancelledRemainingQuantity"),
      );
      transferUpdates.status =
        open.size > 1
          ? "disputed"
          : disposed >= number(currentTransfer, "totalApprovedQuantity")
            ? "received"
            : "partially_received";
      transaction.update(ref, transferUpdates);
      if (
        currentDispatch.exists &&
        currentDispatch.get("transferId") === input.transferId
      )
        transaction.update(resolutionDispatchRef, {
          status:
            open.size <= 1 && input.resolutionType === "delivered_later"
              ? "received"
              : "disputed",
          updatedAt: now,
        });
      event(transaction, actor, currentTransfer, "discrepancy_resolved", cid, {
        discrepancyId: input.discrepancyId,
        resolutionType: input.resolutionType,
        inventoryTransactionIds: transactionIds,
      });
      notification(
        transaction,
        actor,
        currentTransfer,
        "discrepancy_resolved",
        input.idempotencyKey,
      );
      writeAuditLog(transaction, actor, {
        action: "transfer.discrepancy_resolved",
        entityType: "transferDiscrepancy",
        entityId: input.discrepancyId,
        correlationId: cid,
        sourceFunction: "resolveTransferDiscrepancy",
        reason: input.note,
        after: {
          resolutionType: input.resolutionType,
          inventoryTransactionIds: transactionIds,
        },
      });
      return { resolved: true, inventoryTransactionIds: transactionIds };
    });
    } catch (error) {
      await db.runTransaction(async (transaction) => {
        const current = await transaction.get(discrepancyRef);
        if (
          current.exists &&
          current.get("resolutionInProgress") === true &&
          current.get("resolutionIdempotencyKey") === input.idempotencyKey &&
          !["resolved", "closed"].includes(String(current.get("status")))
        )
          transaction.update(discrepancyRef, {
            resolutionInProgress: false,
            resolutionIdempotencyKey: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
          });
      });
      throw error;
    }
  },
);

export const createTransferCost = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "transfers.cost.create");
    const input = parseInput(costInput, request.data);
    const ref = transferRef(input.transferId);
    const op = operationRef(actor, "createTransferCost", input.idempotencyKey);
    const cid = correlationId();
    return db.runTransaction(async (transaction) => {
      const [previous, transfer] = (await transaction.getAll(op, ref)) as [
        Snapshot,
        Snapshot,
      ];
      if (previous.exists)
        return { costId: String(previous.get("resultId")), created: false };
      assertTransferScope(actor, transfer);
      if (["closed", "cancelled"].includes(String(transfer.get("status"))))
        throw new HttpsError(
          "failed-precondition",
          "Closed or cancelled transfers cannot receive costs.",
        );
      const cost = db.collection("transferCosts").doc();
      const now = FieldValue.serverTimestamp();
      transaction.create(
        cost,
        clean({
          organizationId: actor.organizationId,
          transferId: input.transferId,
          category: input.category,
          description: input.description,
          estimatedAmountMinor: input.estimatedAmountMinor,
          approvedAmountMinor: 0,
          actualAmountMinor: 0,
          currency: "NGN",
          vendorName: input.vendorName,
          vendorReference: input.vendorReference,
          status: "draft",
          createdBy: actor.userId,
          createdAt: now,
          updatedAt: now,
        }),
      );
      transaction.update(ref, {
        estimatedCostMinor:
          number(transfer, "estimatedCostMinor") + input.estimatedAmountMinor,
        updatedAt: now,
        updatedBy: actor.userId,
      });
      transaction.create(op, {
        organizationId: actor.organizationId,
        action: "createTransferCost",
        entityId: input.transferId,
        resultId: cost.id,
        status: "completed",
        createdAt: now,
        createdBy: actor.userId,
      });
      event(transaction, actor, transfer, "cost_added", cid, {
        costId: cost.id,
        category: input.category,
      });
      return { costId: cost.id, created: true };
    });
  },
);
async function costTransition(
  actor: AccessProfile,
  input: {
    transferId: string;
    costId: string;
    amountMinor?: number;
    reason?: string;
    idempotencyKey: string;
  },
  action: "submit" | "approve" | "actual" | "reconcile",
) {
  const permission =
    action === "approve"
      ? "transfers.cost.approve"
      : action === "reconcile"
        ? "transfers.cost.reconcile"
        : "transfers.cost.create";
  requirePermission(actor, permission);
  const ref = transferRef(input.transferId);
  const costRef = db.doc(`transferCosts/${input.costId}`);
  const op = operationRef(actor, `${action}TransferCost`, input.idempotencyKey);
  const cid = correlationId();
  return db.runTransaction(async (transaction) => {
    const [previous, transfer, cost] = (await transaction.getAll(
      op,
      ref,
      costRef,
    )) as [Snapshot, Snapshot, Snapshot];
    if (previous.exists) return { changed: false };
    assertTransferScope(actor, transfer);
    if (!cost.exists || cost.get("transferId") !== input.transferId)
      throw new HttpsError("not-found", "Transfer cost not found.");
    if (action === "approve" && cost.get("createdBy") === actor.userId)
      throw new HttpsError(
        "permission-denied",
        "Cost creator cannot approve their own cost.",
      );
    const expected =
      action === "submit"
        ? "draft"
        : action === "approve"
          ? "submitted"
          : action === "actual"
            ? "approved"
            : "incurred";
    if (cost.get("status") !== expected)
      throw new HttpsError(
        "failed-precondition",
        `Cost must be ${expected} before ${action}.`,
      );
    if (
      (action === "approve" || action === "actual") &&
      input.amountMinor === undefined
    )
      throw new HttpsError("invalid-argument", "An amount is required.");
    const now = FieldValue.serverTimestamp();
    const status =
      action === "submit"
        ? "submitted"
        : action === "approve"
          ? "approved"
          : action === "actual"
            ? "incurred"
            : "reconciled";
    const updates: RecordValue = { status, updatedAt: now };
    if (action === "approve")
      Object.assign(updates, {
        approvedAmountMinor: input.amountMinor,
        approvedBy: actor.userId,
        approvedAt: now,
      });
    if (action === "actual")
      Object.assign(updates, {
        actualAmountMinor: input.amountMinor,
        incurredAt: now,
        actualRecordedBy: actor.userId,
      });
    if (action === "reconcile")
      Object.assign(updates, { reconciledAt: now, reconciledBy: actor.userId });
    transaction.update(costRef, updates);
    const transferUpdates: RecordValue = {
      updatedAt: now,
      updatedBy: actor.userId,
    };
    if (action === "approve")
      transferUpdates.approvedCostMinor =
        number(transfer, "approvedCostMinor") + input.amountMinor!;
    if (action === "actual") {
      transferUpdates.actualCostMinor =
        number(transfer, "actualCostMinor") + input.amountMinor!;
      transferUpdates.costVarianceMinor =
        number(transfer, "actualCostMinor") +
        input.amountMinor! -
        number(transfer, "approvedCostMinor");
    }
    transaction.update(ref, transferUpdates);
    operation(
      transaction,
      op,
      actor,
      `${action}TransferCost`,
      input.transferId,
    );
    event(
      transaction,
      actor,
      transfer,
      action === "approve"
        ? "cost_approved"
        : action === "reconcile"
          ? "cost_reconciled"
          : "cost_added",
      cid,
      { costId: input.costId, amountMinor: input.amountMinor },
    );
    if (action === "submit")
      notification(
        transaction,
        actor,
        transfer,
        "cost_approval_required",
        input.idempotencyKey,
      );
    writeAuditLog(transaction, actor, {
      action: `transfer.cost_${action}`,
      entityType: "transferCost",
      entityId: input.costId,
      correlationId: cid,
      sourceFunction: `${action}TransferCost`,
      reason: input.reason,
      after: clean({ status, amountMinor: input.amountMinor }),
    });
    return { changed: true, status };
  });
}
export const submitTransferCost = onCall({ enforceAppCheck }, async (request) =>
  costTransition(
    await requireAccess(request),
    parseInput(costActionInput, request.data),
    "submit",
  ),
);
export const approveTransferCost = onCall(
  { enforceAppCheck },
  async (request) =>
    costTransition(
      await requireAccess(request),
      parseInput(costActionInput, request.data),
      "approve",
    ),
);
export const recordActualTransferCost = onCall(
  { enforceAppCheck },
  async (request) =>
    costTransition(
      await requireAccess(request),
      parseInput(costActionInput, request.data),
      "actual",
    ),
);
export const reconcileTransferCosts = onCall(
  { enforceAppCheck },
  async (request) =>
    costTransition(
      await requireAccess(request),
      parseInput(costActionInput, request.data),
      "reconcile",
    ),
);

export const cancelTransfer = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request);
  requirePermission(actor, "transfers.cancel");
  const input = parseInput(transferActionInput, request.data);
  if (!input.reason)
    throw new HttpsError(
      "invalid-argument",
      "A cancellation reason is required.",
    );
  const ref = transferRef(input.transferId);
  let transfer = await ref.get();
  assertTransferScope(actor, transfer);
  if (
    ["received", "closed", "cancelled"].includes(String(transfer.get("status")))
  )
    throw new HttpsError(
      "failed-precondition",
      "This transfer cannot be cancelled.",
    );
  if (number(transfer, "totalReservedQuantity") > 0) {
    await releaseTransferReservationService(
      actor,
      input.transferId,
      undefined,
      `${input.idempotencyKey}-release`,
      correlationId(),
    );
    transfer = await ref.get();
  }
  const op = operationRef(actor, "cancelTransfer", input.idempotencyKey);
  const cid = correlationId();
  return db.runTransaction(async (transaction) => {
    const [previous, current] = (await transaction.getAll(op, ref)) as [
      Snapshot,
      Snapshot,
    ];
    if (previous.exists) return { cancelled: false };
    if (number(current, "version") !== input.expectedVersion)
      throw new HttpsError("aborted", "The transfer version changed.");
    const items = await transaction.get(
      db
        .collection("transferItems")
        .where("transferId", "==", input.transferId),
    );
    const draftDispatches = await transaction.get(
      db
        .collection("transferDispatches")
        .where("transferId", "==", input.transferId)
        .where("status", "==", "draft"),
    );
    const requestItemRefs =
      current.get("sourceType") === "branch_request"
        ? items.docs
            .filter((item) => item.get("sourceRequestItemId"))
            .map((item) =>
              db.doc(
                `branchRequestItems/${String(item.get("sourceRequestItemId"))}`,
              ),
            )
        : [];
    const requestItemSnapshots = requestItemRefs.length
      ? await transaction.getAll(...requestItemRefs)
      : [];
    const requestItemsById = new Map(
      requestItemSnapshots.map((item) => [item.id, item]),
    );
    const now = FieldValue.serverTimestamp();
    const partial = number(current, "totalDispatchedQuantity") > 0;
    for (const draftDispatch of draftDispatches.docs)
      transaction.update(draftDispatch.ref, {
        status: "cancelled",
        cancellationReason: input.reason,
        cancelledAt: now,
        cancelledBy: actor.userId,
        updatedAt: now,
      });
    for (const item of items.docs) {
      const undispatched =
        number(item, "approvedQuantity") - number(item, "dispatchedQuantity");
      transaction.update(item.ref, {
        cancelledQuantity: undispatched,
        outstandingQuantity: Math.max(
          0,
          number(item, "approvedQuantity") -
            undispatched -
            number(item, "receivedQuantity") -
            number(item, "damagedQuantity") -
            number(item, "returnedQuantity") -
            number(item, "writtenOffQuantity"),
        ),
        itemStatus:
          partial && number(item, "dispatchedQuantity") > 0
            ? "partially_dispatched"
            : "cancelled",
        updatedAt: now,
      });
      if (
        current.get("sourceType") === "branch_request" &&
        item.get("sourceRequestItemId") &&
        undispatched > 0
      ) {
        const requestItemRef = db.doc(
          `branchRequestItems/${String(item.get("sourceRequestItemId"))}`,
        );
        const requestItem = requestItemsById.get(requestItemRef.id)!;
        transaction.update(requestItemRef, {
          transferAllocatedQuantity: Math.max(
            0,
            number(requestItem, "transferAllocatedQuantity") - undispatched,
          ),
          updatedAt: now,
        });
      }
    }
    transaction.update(ref, {
      status: partial ? "partially_dispatched" : "cancelled",
      cancelledRemainingQuantity: Math.max(
        0,
        number(current, "totalApprovedQuantity") -
          number(current, "totalDispatchedQuantity"),
      ),
      totalOutstandingQuantity: Math.max(
        0,
        number(current, "totalApprovedQuantity") -
          Math.max(
            0,
            number(current, "totalApprovedQuantity") -
              number(current, "totalDispatchedQuantity"),
          ) -
          number(current, "totalReceivedQuantity") -
          number(current, "totalDamagedQuantity") -
          number(current, "totalReturnedQuantity") -
          number(current, "totalWrittenOffQuantity"),
      ),
      cancelledAt: now,
      cancelledBy: actor.userId,
      cancellationReason: input.reason,
      updatedAt: now,
      updatedBy: actor.userId,
    });
    event(transaction, actor, current, "cancelled", cid, {
      partial,
      reason: input.reason,
    });
    operation(transaction, op, actor, "cancelTransfer", input.transferId);
    writeAuditLog(transaction, actor, {
      action: "transfer.cancelled",
      entityType: "transfer",
      entityId: input.transferId,
      correlationId: cid,
      sourceFunction: "cancelTransfer",
      reason: input.reason,
      after: { partial },
    });
    return { cancelled: !partial, remainingCancelled: true };
  });
});

export const closeTransfer = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request);
  requirePermission(actor, "transfers.close");
  const input = parseInput(transferActionInput, request.data);
  const ref = transferRef(input.transferId);
  const op = operationRef(actor, "closeTransfer", input.idempotencyKey);
  const cid = correlationId();
  await assertTransferInvariantGate(actor.organizationId, input.transferId, "before_closure");
  return db.runTransaction(async (transaction) => {
    const [previous, transfer] = (await transaction.getAll(op, ref)) as [
      Snapshot,
      Snapshot,
    ];
    if (previous.exists) return { closed: false };
    assertTransferScope(actor, transfer);
    if (
      number(transfer, "version") !== input.expectedVersion ||
      !["received", "partially_received", "cost_reconciliation"].includes(
        String(transfer.get("status")),
      )
    )
      throw new HttpsError(
        "failed-precondition",
        "Transfer is not ready for closure.",
      );
    const [reservations, discrepancies, costs, dispatches] = await Promise.all([
      transaction.get(
        db
          .collection("stockReservations")
          .where("transferId", "==", input.transferId)
          .where("status", "in", ["active", "partially_consumed"]),
      ),
      transaction.get(
        db
          .collection("transferDiscrepancies")
          .where("transferId", "==", input.transferId)
          .where("status", "not-in", ["resolved", "closed"]),
      ),
      transaction.get(
        db
          .collection("transferCosts")
          .where("transferId", "==", input.transferId),
      ),
      transaction.get(
        db
          .collection("transferDispatches")
          .where("transferId", "==", input.transferId),
      ),
    ]);
    if (!reservations.empty)
      throw new HttpsError(
        "failed-precondition",
        "Active reservations must be consumed or released.",
      );
    if (!discrepancies.empty)
      throw new HttpsError(
        "failed-precondition",
        "All discrepancies must be resolved.",
      );
    if (costs.docs.some((cost) => cost.get("status") !== "reconciled"))
      throw new HttpsError(
        "failed-precondition",
        "All transfer costs must be reconciled.",
      );
    if (
      dispatches.docs.some(
        (dispatch) =>
          !["received", "disputed", "cancelled"].includes(
            String(dispatch.get("status")),
          ),
      )
    )
      throw new HttpsError(
        "failed-precondition",
        "Every dispatch must be received or formally resolved.",
      );
    const disposed =
      number(transfer, "totalReceivedQuantity") +
      number(transfer, "totalDamagedQuantity") +
      number(transfer, "totalReturnedQuantity") +
      number(transfer, "totalWrittenOffQuantity") +
      number(transfer, "cancelledRemainingQuantity");
    if (disposed < number(transfer, "totalApprovedQuantity"))
      throw new HttpsError(
        "failed-precondition",
        "Transfer quantities do not reconcile for closure.",
      );
    const now = FieldValue.serverTimestamp();
    transaction.update(ref, {
      status: "closed",
      closedAt: now,
      closedBy: actor.userId,
      updatedAt: now,
      updatedBy: actor.userId,
    });
    event(transaction, actor, transfer, "closed", cid, {
      reconciliation: {
        approved: transfer.get("totalApprovedQuantity"),
        dispatched: transfer.get("totalDispatchedQuantity"),
        received: transfer.get("totalReceivedQuantity"),
        damaged: transfer.get("totalDamagedQuantity"),
        actualCostMinor: transfer.get("actualCostMinor"),
      },
    });
    notification(transaction, actor, transfer, "closed", input.idempotencyKey);
    operation(transaction, op, actor, "closeTransfer", input.transferId);
    writeAuditLog(transaction, actor, {
      action: "transfer.closed",
      entityType: "transfer",
      entityId: input.transferId,
      correlationId: cid,
      sourceFunction: "closeTransfer",
    });
    return {
      closed: true,
      reconciliation: {
        approvedQuantity: number(transfer, "totalApprovedQuantity"),
        dispatchedQuantity: number(transfer, "totalDispatchedQuantity"),
        receivedQuantity: number(transfer, "totalReceivedQuantity"),
        damagedQuantity: number(transfer, "totalDamagedQuantity"),
        actualCostMinor: number(transfer, "actualCostMinor"),
      },
    };
  });
});

export const getTransfer = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request);
  const input = parseInput(transferQueryInput, request.data);
  if (!input.transferId)
    throw new HttpsError("invalid-argument", "Transfer ID is required.");
  const transfer = await transferRef(input.transferId).get();
  assertTransferScope(actor, transfer);
  const related = await Promise.all(
    [
      "transferItems",
      "transferPackages",
      "transferDispatches",
      "transferReceipts",
      "transferDiscrepancies",
      "transferEvents",
      "transferVersions",
      "transferApprovals",
    ].map((collection) =>
      db
        .collection(collection)
        .where("transferId", "==", input.transferId)
        .limit(200)
        .get(),
    ),
  );
  const items = related[0]!;
  const packages = related[1]!;
  const dispatches = related[2]!;
  const receipts = related[3]!;
  const discrepancies = related[4]!;
  const events = related[5]!;
  const versions = related[6]!;
  const approvals = related[7]!;
  const costs = hasServerPermission(actor, "transfers.cost.read")
    ? await db
        .collection("transferCosts")
        .where("transferId", "==", input.transferId)
        .limit(200)
        .get()
    : undefined;
  const header = serialize(transfer);
  if (!hasServerPermission(actor, "transfers.cost.read"))
    for (const field of [
      "estimatedCostMinor",
      "approvedCostMinor",
      "actualCostMinor",
      "costVarianceMinor",
    ])
      delete header[field];
  return {
    transfer: header,
    items: items.docs.map(serialize),
    packages: packages.docs.map(serialize),
    dispatches: dispatches.docs.map(serialize),
    receipts: receipts.docs.map(serialize),
    discrepancies: discrepancies.docs.map(serialize),
    events: events.docs.map(serialize),
    versions: versions.docs.map(serialize),
    approvals: approvals.docs.map(serialize),
    costs: costs?.docs.map(serialize) ?? [],
  };
});
export const getTransferTimeline = getTransfer;
export const getTransferReconciliation = getTransfer;
export const getTransferAvailability = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    const input = parseInput(transferQueryInput, request.data);
    if (!input.transferId)
      throw new HttpsError("invalid-argument", "Transfer ID is required.");
    const transfer = await transferRef(input.transferId).get();
    assertTransferScope(actor, transfer);
    const items = await db
      .collection("transferItems")
      .where("transferId", "==", input.transferId)
      .get();
    const balances = await Promise.all(
      items.docs.map((item) =>
        db
          .collection("inventoryBalances")
          .where("organizationId", "==", actor.organizationId)
          .where("productId", "==", item.get("productId"))
          .where("locationId", "==", transfer.get("originLocationId"))
          .limit(1)
          .get(),
      ),
    );
    return {
      asOf: new Date().toISOString(),
      warning:
        "Availability is informational until an atomic reservation succeeds.",
      lines: items.docs.map((item, index) => ({
        transferItemId: item.id,
        productId: item.get("productId"),
        approvedQuantity: item.get("approvedQuantity"),
        reservedQuantity: item.get("reservedQuantity"),
        onHandQuantity: balances[index]?.docs[0]?.get("onHandQuantity") ?? 0,
        availableQuantity:
          balances[index]?.docs[0]?.get("availableQuantity") ?? 0,
      })),
    };
  },
);
export const listTransfers = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request);
  const input = parseInput(transferQueryInput, request.data);
  let query: Query = db
    .collection("transfers")
    .where("organizationId", "==", actor.organizationId);
  if (!hasServerPermission(actor, "transfers.read.all")) {
    if (hasServerPermission(actor, "transfers.read.assigned_warehouse")) {
      if (input.warehouseId) requireWarehouseScope(actor, input.warehouseId);
      query = query.where(
        "originWarehouseId",
        "in",
        input.warehouseId
          ? [input.warehouseId]
          : actor.warehouseIds.slice(0, 10),
      );
    } else {
      if (input.branchId) requireBranchScope(actor, input.branchId);
      query = query.where(
        "destinationBranchId",
        "in",
        input.branchId ? [input.branchId] : actor.branchIds.slice(0, 10),
      );
    }
  } else {
    if (input.warehouseId)
      query = query.where("originWarehouseId", "==", input.warehouseId);
    if (input.branchId)
      query = query.where("destinationBranchId", "==", input.branchId);
  }
  if (input.status) query = query.where("status", "==", input.status);
  if (input.sourceType)
    query = query.where("sourceType", "==", input.sourceType);
  query = query.orderBy(FieldPath.documentId()).limit(input.limit);
  if (input.cursor) query = query.startAfter(input.cursor);
  const rows = await query.get();
  return {
    rows: rows.docs.map((doc) => {
      const value = serialize(doc);
      if (!hasServerPermission(actor, "transfers.cost.read"))
        for (const field of [
          "estimatedCostMinor",
          "approvedCostMinor",
          "actualCostMinor",
          "costVarianceMinor",
        ])
          delete value[field];
      return value;
    }),
    nextCursor:
      rows.size === input.limit ? (rows.docs.at(-1)?.id ?? null) : null,
  };
});
export const generateTransferReport = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "reports.transfers.read");
    const input = parseInput(transferQueryInput, request.data);
    const listed = await db
      .collection("transfers")
      .where("organizationId", "==", actor.organizationId)
      .orderBy(FieldPath.documentId())
      .limit(input.limit)
      .get();
    const rows = listed.docs
      .filter(
        (doc) =>
          (!input.status || doc.get("status") === input.status) &&
          (!input.branchId ||
            doc.get("destinationBranchId") === input.branchId) &&
          (!input.warehouseId ||
            doc.get("originWarehouseId") === input.warehouseId),
      )
      .map(serialize);
    if (!hasServerPermission(actor, "transfers.cost.read"))
      rows.forEach((row) =>
        [
          "estimatedCostMinor",
          "approvedCostMinor",
          "actualCostMinor",
          "costVarianceMinor",
        ].forEach((field) => delete row[field]),
      );
    return {
      reportType: input.reportType,
      rows,
      nextCursor:
        listed.size === input.limit ? (listed.docs.at(-1)?.id ?? null) : null,
    };
  },
);
export const generateTransferRegisterReport = generateTransferReport;
export const generateGoodsInTransitReport = generateTransferReport;
export const generateTransferFulfilmentReport = generateTransferReport;
export const generateTransferCostReport = generateTransferReport;
export const generateTransferDiscrepancyReport = generateTransferReport;
export const generateBranchSupplyReport = generateTransferReport;

export const saveTransferLogisticsResource = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "transfers.dispatch");
    const input = parseInput(logisticsResourceInput, request.data);
    const collectionName =
      input.resourceType === "vehicle"
        ? "vehicles"
        : input.resourceType === "driver"
          ? "drivers"
          : "logisticsVendors";
    const reference = input.id
      ? db.doc(`${collectionName}/${input.id}`)
      : db.collection(collectionName).doc();
    const op = operationRef(
      actor,
      "saveTransferLogisticsResource",
      input.idempotencyKey,
    );
    const cid = correlationId();
    return db.runTransaction(async (transaction) => {
      const [previous, existing] = (await transaction.getAll(
        op,
        reference,
      )) as [Snapshot, Snapshot];
      if (previous.exists)
        return { id: String(previous.get("resultId")), saved: false };
      if (
        existing.exists &&
        existing.get("organizationId") !== actor.organizationId
      )
        throw new HttpsError("not-found", "Logistics resource not found.");
      const now = FieldValue.serverTimestamp();
      transaction.set(
        reference,
        clean({
          organizationId: actor.organizationId,
          name: input.name,
          registrationNumber: input.registrationNumber,
          phoneNumber: input.phoneNumber,
          licenseReference: input.licenseReference,
          vehicleType: input.vehicleType,
          capacityKg: input.capacityKg,
          vendorId: input.vendorId,
          active: input.active,
          createdAt: existing.exists ? existing.get("createdAt") : now,
          createdBy: existing.exists ? existing.get("createdBy") : actor.userId,
          updatedAt: now,
          updatedBy: actor.userId,
        }),
      );
      transaction.create(op, {
        organizationId: actor.organizationId,
        action: "saveTransferLogisticsResource",
        entityId: reference.id,
        resultId: reference.id,
        status: "completed",
        createdAt: now,
        createdBy: actor.userId,
      });
      writeAuditLog(transaction, actor, {
        action: `transfer.${input.resourceType}_saved`,
        entityType: input.resourceType,
        entityId: reference.id,
        correlationId: cid,
        sourceFunction: "saveTransferLogisticsResource",
      });
      return { id: reference.id, saved: true };
    });
  },
);
