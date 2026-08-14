import {
  FieldPath,
  FieldValue,
  Timestamp,
  type Query,
  type Transaction,
} from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import {
  hasRole,
  hasServerPermission,
  requireAccess,
  requireBranchScope,
  requirePermission,
  type AccessProfile,
} from "../auth/authorize.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { enforceAppCheck } from "../config.js";
import { correlationId, parseInput } from "../utils/callable.js";
import {
  createBranchRequestInput,
  requestActionInput,
  requestCommentInput,
  requestDecisionInput,
  requestQueryInput,
  updateBranchRequestInput,
} from "../validation/requests.js";

type Snapshot = FirebaseFirestore.DocumentSnapshot;
type RequestRecord = Record<string, unknown>;
const clean = (value: RequestRecord) =>
  Object.fromEntries(
    Object.entries(value).filter(
      ([, item]) => item !== undefined && item !== "",
    ),
  );
const operationRef = (actor: AccessProfile, action: string, key: string) =>
  db
    .collection("idempotencyKeys")
    .doc(`${actor.organizationId}_${action}_${key}`);
const itemRef = (requestId: string, productId: string) =>
  db
    .collection("branchRequestItems")
    .doc(`${requestId}__${encodeURIComponent(productId)}`);
const requestRef = (requestId: string) =>
  db.collection("branchRequests").doc(requestId);

function serialize(snapshot: Snapshot) {
  const output = { id: snapshot.id, ...snapshot.data() } as RequestRecord;
  for (const [key, value] of Object.entries(output))
    if (value instanceof Timestamp) output[key] = value.toDate().toISOString();
  return output;
}
function assertReadScope(actor: AccessProfile, record: Snapshot) {
  if (record.get("organizationId") !== actor.organizationId)
    throw new HttpsError("not-found", "Request not found.");
  if (hasServerPermission(actor, "requests.read.all")) return;
  requirePermission(actor, "requests.read.own_branch");
  requireBranchScope(actor, String(record.get("branchId")));
}
function assertDraftOwner(actor: AccessProfile, record: Snapshot) {
  assertReadScope(actor, record);
  requirePermission(actor, "requests.update_draft");
  if (
    record.get("createdBy") !== actor.userId &&
    !hasRole(actor, "branch_manager") &&
    !hasServerPermission(actor, "requests.read.all")
  )
    throw new HttpsError(
      "permission-denied",
      "Only the creator or an authorized manager may edit this draft.",
    );
}
function totals(
  items: readonly {
    requestedQuantity: number;
    approvedQuantity?: number;
    rejectedQuantity?: number;
    fulfilledQuantity?: number;
  }[],
) {
  return items.reduce(
    (sum, item) => ({
      requested: sum.requested + item.requestedQuantity,
      approved: sum.approved + (item.approvedQuantity ?? 0),
      rejected: sum.rejected + (item.rejectedQuantity ?? 0),
      fulfilled: sum.fulfilled + (item.fulfilledQuantity ?? 0),
    }),
    { requested: 0, approved: 0, rejected: 0, fulfilled: 0 },
  );
}
function createEvent(
  transaction: Transaction,
  actor: AccessProfile,
  requestId: string,
  branchId: string,
  eventType: string,
  previousStatus: string | undefined,
  newStatus: string,
  requestVersion: number,
  requestCorrelationId: string,
  reason?: string,
  approvalId?: string,
) {
  transaction.create(
    db.collection("branchRequestEvents").doc(),
    clean({
      organizationId: actor.organizationId,
      requestId,
      branchId,
      eventType,
      previousStatus,
      newStatus,
      actorUserId: actor.userId,
      actorRoleId: actor.roleId,
      reason,
      requestVersion,
      correlationId: requestCorrelationId,
      relatedApprovalId: approvalId,
      createdAt: FieldValue.serverTimestamp(),
    }),
  );
}
function createNotification(
  transaction: Transaction,
  actor: AccessProfile,
  requestId: string,
  branchId: string,
  eventType: string,
  requestVersion: number,
  idempotencyKey: string,
) {
  transaction.set(
    db
      .collection("notificationEvents")
      .doc(`${requestId}__${eventType}__${requestVersion}__${idempotencyKey}`),
    {
      organizationId: actor.organizationId,
      aggregateType: "branch_request",
      aggregateId: requestId,
      branchId,
      eventType: `branch_request.${eventType}`,
      requestVersion,
      recipientGroups:
        eventType === "submitted" || eventType === "resubmitted"
          ? ["operations_reviewers", "warehouse_managers"]
          : ["request_creator", "branch_managers"],
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
      createdBy: actor.userId,
    },
  );
}
function createOperation(
  transaction: Transaction,
  reference: FirebaseFirestore.DocumentReference,
  actor: AccessProfile,
  action: string,
  entityId: string,
) {
  transaction.create(reference, {
    organizationId: actor.organizationId,
    action,
    entityId,
    status: "completed",
    createdAt: FieldValue.serverTimestamp(),
    createdBy: actor.userId,
  });
}
function assertUniqueProducts(items: readonly { productId: string }[]) {
  if (new Set(items.map((item) => item.productId)).size !== items.length)
    throw new HttpsError(
      "invalid-argument",
      "A product may appear only once in a request.",
    );
}

export const createBranchRequest = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "requests.create");
    const input = parseInput(createBranchRequestInput, request.data);
    requireBranchScope(actor, input.branchId);
    assertUniqueProducts(input.items);
    const operation = operationRef(
      actor,
      "createBranchRequest",
      input.idempotencyKey,
    );
    const prior = await operation.get();
    if (prior.exists)
      return { requestId: prior.get("entityId"), created: false };
    const reference = db.collection("branchRequests").doc();
    const branch = db.collection("branches").doc(input.branchId);
    const year = new Date().getUTCFullYear();
    const counter = db
      .collection("organizationCounters")
      .doc(`${actor.organizationId}_branchRequest_${input.branchId}_${year}`);
    const requestCorrelationId = correlationId();
    await db.runTransaction(async (transaction) => {
      const [existingOperation, branchSnapshot, counterSnapshot, ...products] =
        await transaction.getAll(
          operation,
          branch,
          counter,
          ...input.items.map((item) =>
            db.collection("products").doc(item.productId),
          ),
        );
      if (!existingOperation || !branchSnapshot || !counterSnapshot)
        throw new HttpsError(
          "internal",
          "Request transaction reads were incomplete.",
        );
      if (existingOperation.exists) return;
      if (
        !branchSnapshot.exists ||
        branchSnapshot.get("organizationId") !== actor.organizationId ||
        branchSnapshot.get("status") !== "active"
      )
        throw new HttpsError(
          "failed-precondition",
          "Select an active branch in your organization.",
        );
      products.forEach((product) => {
        if (
          !product.exists ||
          product.get("organizationId") !== actor.organizationId ||
          product.get("active") !== true
        )
          throw new HttpsError(
            "failed-precondition",
            "Every requested product must be active in your organization.",
          );
      });
      const sequence = Number(counterSnapshot.get("value") ?? 0) + 1;
      const requestNumber = `REQ-${String(branchSnapshot.get("code")).toUpperCase()}-${year}-${String(sequence).padStart(6, "0")}`;
      const now = FieldValue.serverTimestamp();
      const calculated = totals(input.items);
      transaction.set(counter, {
        organizationId: actor.organizationId,
        type: "branchRequest",
        branchId: input.branchId,
        year,
        value: sequence,
        updatedAt: now,
      });
      transaction.create(
        reference,
        clean({
          organizationId: actor.organizationId,
          requestNumber,
          branchId: input.branchId,
          branchName: branchSnapshot.get("name"),
          requestType: input.requestType,
          priority: input.priority,
          purpose: input.purpose,
          requiredDate: input.requiredDate
            ? Timestamp.fromDate(
                new Date(`${input.requiredDate}T00:00:00.000Z`),
              )
            : undefined,
          projectReference: input.projectReference,
          customerReference: input.customerReference,
          warrantyReference: input.warrantyReference,
          attachmentMetadata: input.attachmentMetadata,
          status: "draft",
          totalRequestedQuantity: calculated.requested,
          totalApprovedQuantity: 0,
          totalRejectedQuantity: 0,
          totalFulfilledQuantity: 0,
          totalOutstandingQuantity: 0,
          totalCancelledOutstandingQuantity: 0,
          itemCount: input.items.length,
          version: 0,
          createdAt: now,
          createdBy: actor.userId,
          updatedAt: now,
          updatedBy: actor.userId,
        }),
      );
      input.items.forEach((item, index) => {
        const product = products[index]!;
        transaction.create(
          itemRef(reference.id, item.productId),
          clean({
            organizationId: actor.organizationId,
            requestId: reference.id,
            requestNumber,
            branchId: input.branchId,
            productId: item.productId,
            sku: product.get("sku"),
            productName: product.get("name"),
            categoryId: product.get("categoryId"),
            brand: product.get("brand"),
            unitOfMeasure: product.get("unitOfMeasure"),
            trackingType: product.get("trackingType"),
            requestedQuantity: item.requestedQuantity,
            approvedQuantity: 0,
            rejectedQuantity: 0,
            fulfilledQuantity: 0,
            outstandingQuantity: 0,
            cancelledOutstandingQuantity: 0,
            requesterNote: item.requesterNote,
            itemStatus: "pending",
            createdAt: now,
            updatedAt: now,
          }),
        );
      });
      createEvent(
        transaction,
        actor,
        reference.id,
        input.branchId,
        "created",
        undefined,
        "draft",
        0,
        requestCorrelationId,
      );
      createOperation(
        transaction,
        operation,
        actor,
        "createBranchRequest",
        reference.id,
      );
      writeAuditLog(transaction, actor, {
        action: "branch_request.created",
        entityType: "branchRequest",
        entityId: reference.id,
        correlationId: requestCorrelationId,
        sourceFunction: "createBranchRequest",
        after: {
          requestNumber,
          branchId: input.branchId,
          itemCount: input.items.length,
        },
      });
    });
    logger.info("Branch request created", {
      organizationId: actor.organizationId,
      requestId: reference.id,
      correlationId: requestCorrelationId,
    });
    return { requestId: reference.id, created: true };
  },
);

export const updateBranchRequestDraft = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    const input = parseInput(updateBranchRequestInput, request.data);
    assertUniqueProducts(input.items);
    const operation = operationRef(
      actor,
      "updateBranchRequestDraft",
      input.idempotencyKey,
    );
    const requestCorrelationId = correlationId();
    await db.runTransaction(async (transaction) => {
      const reference = requestRef(input.requestId);
      const existingItemsQuery = db
        .collection("branchRequestItems")
        .where("requestId", "==", input.requestId);
      const [record, existingItems, existingOperation, branch, ...products] =
        await Promise.all([
          transaction.get(reference),
          transaction.get(existingItemsQuery),
          transaction.get(operation),
          transaction.get(db.collection("branches").doc(input.branchId)),
          ...input.items.map((item) =>
            transaction.get(db.collection("products").doc(item.productId)),
          ),
        ]);
      if (!record || !existingItems || !existingOperation || !branch)
        throw new HttpsError(
          "internal",
          "Request transaction reads were incomplete.",
        );
      if (existingOperation.exists) return;
      if (!record.exists)
        throw new HttpsError("not-found", "Request not found.");
      assertDraftOwner(actor, record);
      if (
        !["draft", "changes_requested"].includes(String(record.get("status")))
      )
        throw new HttpsError(
          "failed-precondition",
          "Only draft or changes-requested requests can be edited.",
        );
      if (record.get("version") !== input.expectedVersion)
        throw new HttpsError(
          "aborted",
          "The request version changed. Reload before editing.",
        );
      requireBranchScope(actor, input.branchId);
      if (
        !branch.exists ||
        branch.get("organizationId") !== actor.organizationId ||
        branch.get("status") !== "active"
      )
        throw new HttpsError("failed-precondition", "Select an active branch.");
      products.forEach((product) => {
        if (
          !product.exists ||
          product.get("organizationId") !== actor.organizationId ||
          product.get("active") !== true
        )
          throw new HttpsError(
            "failed-precondition",
            "Every requested product must be active.",
          );
      });
      const now = FieldValue.serverTimestamp();
      const calculated = totals(input.items);
      transaction.update(
        reference,
        clean({
          branchId: input.branchId,
          branchName: branch.get("name"),
          requestType: input.requestType,
          priority: input.priority,
          purpose: input.purpose,
          requiredDate: input.requiredDate
            ? Timestamp.fromDate(
                new Date(`${input.requiredDate}T00:00:00.000Z`),
              )
            : FieldValue.delete(),
          projectReference: input.projectReference || FieldValue.delete(),
          customerReference: input.customerReference || FieldValue.delete(),
          warrantyReference: input.warrantyReference || FieldValue.delete(),
          attachmentMetadata: input.attachmentMetadata,
          totalRequestedQuantity: calculated.requested,
          totalApprovedQuantity: 0,
          totalRejectedQuantity: 0,
          totalFulfilledQuantity: 0,
          totalOutstandingQuantity: 0,
          itemCount: input.items.length,
          updatedAt: now,
          updatedBy: actor.userId,
        }),
      );
      const retained = new Set(
        input.items.map((item) => itemRef(input.requestId, item.productId).id),
      );
      existingItems.docs.forEach((item) => {
        if (!retained.has(item.id)) transaction.delete(item.ref);
      });
      input.items.forEach((item, index) => {
        const product = products[index]!;
        transaction.set(
          itemRef(input.requestId, item.productId),
          clean({
            organizationId: actor.organizationId,
            requestId: input.requestId,
            requestNumber: record.get("requestNumber"),
            branchId: input.branchId,
            productId: item.productId,
            sku: product.get("sku"),
            productName: product.get("name"),
            categoryId: product.get("categoryId"),
            brand: product.get("brand"),
            unitOfMeasure: product.get("unitOfMeasure"),
            trackingType: product.get("trackingType"),
            requestedQuantity: item.requestedQuantity,
            approvedQuantity: 0,
            rejectedQuantity: 0,
            fulfilledQuantity: 0,
            outstandingQuantity: 0,
            cancelledOutstandingQuantity: 0,
            requesterNote: item.requesterNote,
            itemStatus: "pending",
            createdAt:
              existingItems.docs
                .find(
                  (entry) =>
                    entry.id === itemRef(input.requestId, item.productId).id,
                )
                ?.get("createdAt") ?? now,
            updatedAt: now,
          }),
        );
      });
      createEvent(
        transaction,
        actor,
        input.requestId,
        input.branchId,
        "updated",
        String(record.get("status")),
        String(record.get("status")),
        input.expectedVersion,
        requestCorrelationId,
      );
      createOperation(
        transaction,
        operation,
        actor,
        "updateBranchRequestDraft",
        input.requestId,
      );
      writeAuditLog(transaction, actor, {
        action: "branch_request.updated",
        entityType: "branchRequest",
        entityId: input.requestId,
        correlationId: requestCorrelationId,
        sourceFunction: "updateBranchRequestDraft",
        after: {
          itemCount: input.items.length,
          totalRequestedQuantity: calculated.requested,
        },
      });
    });
    return { requestId: input.requestId, saved: true };
  },
);

export const submitBranchRequest = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "requests.submit");
    const input = parseInput(requestActionInput, request.data);
    const operation = operationRef(
      actor,
      "submitBranchRequest",
      input.idempotencyKey,
    );
    const requestCorrelationId = correlationId();
    await db.runTransaction(async (transaction) => {
      const reference = requestRef(input.requestId);
      const [record, items, existingOperation] = await Promise.all([
        transaction.get(reference),
        transaction.get(
          db
            .collection("branchRequestItems")
            .where("requestId", "==", input.requestId),
        ),
        transaction.get(operation),
      ]);
      if (existingOperation.exists) return;
      if (!record.exists)
        throw new HttpsError("not-found", "Request not found.");
      assertDraftOwner(actor, record);
      const priorStatus = String(record.get("status"));
      if (!["draft", "changes_requested"].includes(priorStatus))
        throw new HttpsError(
          "failed-precondition",
          "This request cannot be submitted from its current status.",
        );
      if (record.get("version") !== input.expectedVersion)
        throw new HttpsError("aborted", "The request version changed.");
      if (items.empty)
        throw new HttpsError(
          "failed-precondition",
          "An empty request cannot be submitted.",
        );
      const productSnapshots = await transaction.getAll(
        ...items.docs.map((item) =>
          db.collection("products").doc(String(item.get("productId"))),
        ),
      );
      productSnapshots.forEach((product) => {
        if (
          !product.exists ||
          product.get("organizationId") !== actor.organizationId ||
          product.get("active") !== true
        )
          throw new HttpsError(
            "failed-precondition",
            "All products must remain active at submission.",
          );
      });
      const version = input.expectedVersion + 1;
      const now = FieldValue.serverTimestamp();
      const snapshotItems = items.docs.map((item) => ({
        id: item.id,
        productId: item.get("productId"),
        sku: item.get("sku"),
        productName: item.get("productName"),
        unitOfMeasure: item.get("unitOfMeasure"),
        trackingType: item.get("trackingType"),
        requestedQuantity: item.get("requestedQuantity"),
        requesterNote: item.get("requesterNote") ?? null,
      }));
      transaction.update(reference, {
        status: "submitted",
        version,
        submittedAt: now,
        submittedBy: actor.userId,
        updatedAt: now,
        updatedBy: actor.userId,
      });
      transaction.create(
        db
          .collection("branchRequestVersions")
          .doc(`${input.requestId}__v${version}`),
        {
          organizationId: actor.organizationId,
          requestId: input.requestId,
          branchId: record.get("branchId"),
          version,
          header: {
            requestNumber: record.get("requestNumber"),
            requestType: record.get("requestType"),
            priority: record.get("priority"),
            purpose: record.get("purpose"),
            requiredDate: record.get("requiredDate") ?? null,
            projectReference: record.get("projectReference") ?? null,
            customerReference: record.get("customerReference") ?? null,
            warrantyReference: record.get("warrantyReference") ?? null,
          },
          items: snapshotItems,
          submittedBy: actor.userId,
          submittedAt: now,
          correlationId: requestCorrelationId,
        },
      );
      const event =
        priorStatus === "changes_requested" ? "resubmitted" : "submitted";
      createEvent(
        transaction,
        actor,
        input.requestId,
        String(record.get("branchId")),
        event,
        priorStatus,
        "submitted",
        version,
        requestCorrelationId,
        input.reason,
      );
      createNotification(
        transaction,
        actor,
        input.requestId,
        String(record.get("branchId")),
        event,
        version,
        input.idempotencyKey,
      );
      createOperation(
        transaction,
        operation,
        actor,
        "submitBranchRequest",
        input.requestId,
      );
      writeAuditLog(transaction, actor, {
        action: `branch_request.${event}`,
        entityType: "branchRequest",
        entityId: input.requestId,
        correlationId: requestCorrelationId,
        sourceFunction: "submitBranchRequest",
        after: { version },
      });
    });
    return { requestId: input.requestId, submitted: true };
  },
);

async function transitionReview(requestData: unknown) {
  const input = parseInput(requestActionInput, requestData);
  return { input };
}
export const startBranchRequestReview = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "requests.review");
    const { input } = await transitionReview(request.data);
    const operation = operationRef(
      actor,
      "startBranchRequestReview",
      input.idempotencyKey,
    );
    const requestCorrelationId = correlationId();
    await db.runTransaction(async (transaction) => {
      const reference = requestRef(input.requestId);
      const [record, existingOperation] = await transaction.getAll(
        reference,
        operation,
      );
      if (!record || !existingOperation)
        throw new HttpsError(
          "internal",
          "Request transaction reads were incomplete.",
        );
      if (existingOperation.exists) return;
      if (!record.exists)
        throw new HttpsError("not-found", "Request not found.");
      assertReadScope(actor, record);
      if (record.get("createdBy") === actor.userId)
        throw new HttpsError(
          "permission-denied",
          "A requester cannot review their own request.",
        );
      if (
        record.get("status") !== "submitted" ||
        record.get("version") !== input.expectedVersion
      )
        throw new HttpsError(
          "failed-precondition",
          "Only the current submitted version can enter review.",
        );
      const now = FieldValue.serverTimestamp();
      transaction.update(reference, {
        status: "under_review",
        reviewedAt: now,
        reviewedBy: actor.userId,
        updatedAt: now,
        updatedBy: actor.userId,
      });
      createEvent(
        transaction,
        actor,
        input.requestId,
        String(record.get("branchId")),
        "review_started",
        "submitted",
        "under_review",
        input.expectedVersion,
        requestCorrelationId,
        input.reason,
      );
      createNotification(
        transaction,
        actor,
        input.requestId,
        String(record.get("branchId")),
        "review_started",
        input.expectedVersion,
        input.idempotencyKey,
      );
      createOperation(
        transaction,
        operation,
        actor,
        "startBranchRequestReview",
        input.requestId,
      );
      writeAuditLog(transaction, actor, {
        action: "branch_request.review_started",
        entityType: "branchRequest",
        entityId: input.requestId,
        correlationId: requestCorrelationId,
        sourceFunction: "startBranchRequestReview",
      });
    });
    return { requestId: input.requestId, status: "under_review" };
  },
);

export const requestBranchRequestChanges = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "requests.request_changes");
    const { input } = await transitionReview(request.data);
    if (!input.reason)
      throw new HttpsError("invalid-argument", "A reason is required.");
    const operation = operationRef(
      actor,
      "requestBranchRequestChanges",
      input.idempotencyKey,
    );
    const requestCorrelationId = correlationId();
    await db.runTransaction(async (transaction) => {
      const reference = requestRef(input.requestId);
      const [record, existingOperation] = await transaction.getAll(
        reference,
        operation,
      );
      if (!record || !existingOperation)
        throw new HttpsError(
          "internal",
          "Request transaction reads were incomplete.",
        );
      if (existingOperation.exists) return;
      if (!record.exists)
        throw new HttpsError("not-found", "Request not found.");
      assertReadScope(actor, record);
      if (record.get("createdBy") === actor.userId)
        throw new HttpsError(
          "permission-denied",
          "A requester cannot review their own request.",
        );
      const status = String(record.get("status"));
      if (
        !["submitted", "under_review"].includes(status) ||
        record.get("version") !== input.expectedVersion
      )
        throw new HttpsError(
          "failed-precondition",
          "Only the current submitted version can be returned.",
        );
      const approval = db.collection("branchRequestApprovals").doc();
      const now = FieldValue.serverTimestamp();
      transaction.update(reference, {
        status: "changes_requested",
        updatedAt: now,
        updatedBy: actor.userId,
      });
      transaction.create(approval, {
        organizationId: actor.organizationId,
        requestId: input.requestId,
        branchId: record.get("branchId"),
        requestVersion: input.expectedVersion,
        stage: "material_review",
        decision: "changes_requested",
        approverId: actor.userId,
        approverRoleId: actor.roleId,
        itemDecisions: [],
        reason: input.reason,
        createdAt: now,
        correlationId: requestCorrelationId,
      });
      createEvent(
        transaction,
        actor,
        input.requestId,
        String(record.get("branchId")),
        "changes_requested",
        status,
        "changes_requested",
        input.expectedVersion,
        requestCorrelationId,
        input.reason,
        approval.id,
      );
      createNotification(
        transaction,
        actor,
        input.requestId,
        String(record.get("branchId")),
        "changes_requested",
        input.expectedVersion,
        input.idempotencyKey,
      );
      createOperation(
        transaction,
        operation,
        actor,
        "requestBranchRequestChanges",
        input.requestId,
      );
      writeAuditLog(transaction, actor, {
        action: "branch_request.changes_requested",
        entityType: "branchRequest",
        entityId: input.requestId,
        reason: input.reason,
        correlationId: requestCorrelationId,
        sourceFunction: "requestBranchRequestChanges",
      });
    });
    return { requestId: input.requestId, status: "changes_requested" };
  },
);

export const decideBranchRequest = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "requests.approve");
    const input = parseInput(requestDecisionInput, request.data);
    const operation = operationRef(
      actor,
      "decideBranchRequest",
      input.idempotencyKey,
    );
    const requestCorrelationId = correlationId();
    await db.runTransaction(async (transaction) => {
      const reference = requestRef(input.requestId);
      const [record, items, existingOperation] = await Promise.all([
        transaction.get(reference),
        transaction.get(
          db
            .collection("branchRequestItems")
            .where("requestId", "==", input.requestId),
        ),
        transaction.get(operation),
      ]);
      if (existingOperation.exists) return;
      if (!record.exists)
        throw new HttpsError("not-found", "Request not found.");
      assertReadScope(actor, record);
      if (record.get("createdBy") === actor.userId)
        throw new HttpsError(
          "permission-denied",
          "A requester cannot approve their own request.",
        );
      const previousStatus = String(record.get("status"));
      if (
        !["submitted", "under_review"].includes(previousStatus) ||
        record.get("version") !== input.expectedVersion
      )
        throw new HttpsError(
          "failed-precondition",
          "The decision must target the current submitted version.",
        );
      if (items.size !== input.decisions.length)
        throw new HttpsError(
          "invalid-argument",
          "Every requested item requires a complete decision.",
        );
      const decisionMap = new Map(
        input.decisions.map((decision) => [decision.requestItemId, decision]),
      );
      let totalApproved = 0;
      let totalRejected = 0;
      for (const item of items.docs) {
        const decision = decisionMap.get(item.id);
        if (!decision)
          throw new HttpsError(
            "invalid-argument",
            "Every item requires a decision.",
          );
        const requested = Number(item.get("requestedQuantity"));
        if (decision.approvedQuantity + decision.rejectedQuantity !== requested)
          throw new HttpsError(
            "invalid-argument",
            "Approved and rejected quantities must account for every requested unit.",
          );
        totalApproved += decision.approvedQuantity;
        totalRejected += decision.rejectedQuantity;
      }
      const finalStatus =
        totalApproved === 0
          ? "rejected"
          : totalRejected === 0
            ? "approved"
            : "partially_approved";
      if (finalStatus === "rejected" && !input.reason)
        throw new HttpsError(
          "invalid-argument",
          "A rejection reason is required.",
        );
      const approval = db.collection("branchRequestApprovals").doc();
      const now = FieldValue.serverTimestamp();
      for (const item of items.docs) {
        const decision = decisionMap.get(item.id)!;
        const itemStatus =
          decision.approvedQuantity === 0
            ? "rejected"
            : decision.rejectedQuantity === 0
              ? "approved"
              : "partially_approved";
        transaction.update(
          item.ref,
          clean({
            approvedQuantity: decision.approvedQuantity,
            rejectedQuantity: decision.rejectedQuantity,
            fulfilledQuantity: 0,
            outstandingQuantity: decision.approvedQuantity,
            cancelledOutstandingQuantity: 0,
            reviewerNote: decision.note,
            itemStatus,
            updatedAt: now,
          }),
        );
      }
      transaction.update(
        reference,
        clean({
          status: finalStatus,
          totalApprovedQuantity: totalApproved,
          totalRejectedQuantity: totalRejected,
          totalFulfilledQuantity: 0,
          totalOutstandingQuantity: totalApproved,
          approvedAt: totalApproved > 0 ? now : undefined,
          approvedBy: totalApproved > 0 ? actor.userId : undefined,
          rejectedAt: totalApproved === 0 ? now : undefined,
          rejectedBy: totalApproved === 0 ? actor.userId : undefined,
          rejectionReason: totalApproved === 0 ? input.reason : undefined,
          reviewedAt: now,
          reviewedBy: actor.userId,
          updatedAt: now,
          updatedBy: actor.userId,
        }),
      );
      transaction.create(approval, {
        organizationId: actor.organizationId,
        requestId: input.requestId,
        branchId: record.get("branchId"),
        requestVersion: input.expectedVersion,
        stage: "material_review",
        decision: finalStatus,
        approverId: actor.userId,
        approverRoleId: actor.roleId,
        itemDecisions: items.docs.map((item) => {
          const decision = decisionMap.get(item.id)!;
          return clean({
            requestItemId: item.id,
            productId: item.get("productId"),
            requestedQuantity: item.get("requestedQuantity"),
            approvedQuantity: decision.approvedQuantity,
            rejectedQuantity: decision.rejectedQuantity,
            note: decision.note,
          });
        }),
        reason: input.reason ?? null,
        createdAt: now,
        correlationId: requestCorrelationId,
      });
      createEvent(
        transaction,
        actor,
        input.requestId,
        String(record.get("branchId")),
        finalStatus,
        previousStatus,
        finalStatus,
        input.expectedVersion,
        requestCorrelationId,
        input.reason,
        approval.id,
      );
      createNotification(
        transaction,
        actor,
        input.requestId,
        String(record.get("branchId")),
        finalStatus,
        input.expectedVersion,
        input.idempotencyKey,
      );
      createOperation(
        transaction,
        operation,
        actor,
        "decideBranchRequest",
        input.requestId,
      );
      writeAuditLog(transaction, actor, {
        action: `branch_request.${finalStatus}`,
        entityType: "branchRequest",
        entityId: input.requestId,
        reason: input.reason,
        correlationId: requestCorrelationId,
        sourceFunction: "decideBranchRequest",
        after: {
          totalApprovedQuantity: totalApproved,
          totalRejectedQuantity: totalRejected,
          version: input.expectedVersion,
        },
      });
    });
    return { requestId: input.requestId, decided: true };
  },
);

export const cancelBranchRequest = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    const input = parseInput(requestActionInput, request.data);
    if (!input.reason)
      throw new HttpsError(
        "invalid-argument",
        "A cancellation reason is required.",
      );
    const operation = operationRef(
      actor,
      "cancelBranchRequest",
      input.idempotencyKey,
    );
    const requestCorrelationId = correlationId();
    await db.runTransaction(async (transaction) => {
      const reference = requestRef(input.requestId);
      const [record, items, existingOperation] = await Promise.all([
        transaction.get(reference),
        transaction.get(
          db
            .collection("branchRequestItems")
            .where("requestId", "==", input.requestId),
        ),
        transaction.get(operation),
      ]);
      if (existingOperation.exists) return;
      if (!record.exists)
        throw new HttpsError("not-found", "Request not found.");
      assertReadScope(actor, record);
      const status = String(record.get("status"));
      if (["cancelled", "closed", "fulfilled"].includes(status))
        throw new HttpsError(
          "failed-precondition",
          "The request cannot be cancelled.",
        );
      const ownPending =
        record.get("createdBy") === actor.userId &&
        ["draft", "submitted", "changes_requested"].includes(status) &&
        hasServerPermission(actor, "requests.cancel_own");
      if (
        !ownPending &&
        !hasServerPermission(actor, "requests.cancel_approved")
      )
        throw new HttpsError(
          "permission-denied",
          "You cannot cancel this request.",
        );
      if (record.get("version") !== input.expectedVersion)
        throw new HttpsError("aborted", "The request version changed.");
      const now = FieldValue.serverTimestamp();
      transaction.update(reference, {
        status: "cancelled",
        cancelledAt: now,
        cancelledBy: actor.userId,
        cancellationReason: input.reason,
        totalOutstandingQuantity: 0,
        totalCancelledOutstandingQuantity: Number(
          record.get("totalOutstandingQuantity") ?? 0,
        ),
        updatedAt: now,
        updatedBy: actor.userId,
      });
      items.docs.forEach((item) =>
        transaction.update(item.ref, {
          itemStatus: "cancelled",
          cancelledOutstandingQuantity: Number(
            item.get("outstandingQuantity") ?? 0,
          ),
          outstandingQuantity: 0,
          updatedAt: now,
        }),
      );
      createEvent(
        transaction,
        actor,
        input.requestId,
        String(record.get("branchId")),
        "cancelled",
        status,
        "cancelled",
        input.expectedVersion,
        requestCorrelationId,
        input.reason,
      );
      createNotification(
        transaction,
        actor,
        input.requestId,
        String(record.get("branchId")),
        "cancelled",
        input.expectedVersion,
        input.idempotencyKey,
      );
      createOperation(
        transaction,
        operation,
        actor,
        "cancelBranchRequest",
        input.requestId,
      );
      writeAuditLog(transaction, actor, {
        action: "branch_request.cancelled",
        entityType: "branchRequest",
        entityId: input.requestId,
        reason: input.reason,
        correlationId: requestCorrelationId,
        sourceFunction: "cancelBranchRequest",
      });
    });
    return { requestId: input.requestId, status: "cancelled" };
  },
);

export const closeBranchRequest = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "requests.close");
    const input = parseInput(requestActionInput, request.data);
    if (!input.reason)
      throw new HttpsError("invalid-argument", "A closure reason is required.");
    const operation = operationRef(
      actor,
      "closeBranchRequest",
      input.idempotencyKey,
    );
    const requestCorrelationId = correlationId();
    await db.runTransaction(async (transaction) => {
      const reference = requestRef(input.requestId);
      const [record, items, existingOperation] = await Promise.all([
        transaction.get(reference),
        transaction.get(
          db
            .collection("branchRequestItems")
            .where("requestId", "==", input.requestId),
        ),
        transaction.get(operation),
      ]);
      if (existingOperation.exists) return;
      if (!record.exists)
        throw new HttpsError("not-found", "Request not found.");
      assertReadScope(actor, record);
      const status = String(record.get("status"));
      if (
        ![
          "approved",
          "partially_approved",
          "rejected",
          "cancelled",
          "fulfilled",
        ].includes(status) ||
        record.get("version") !== input.expectedVersion
      )
        throw new HttpsError(
          "failed-precondition",
          "This request cannot be closed.",
        );
      const now = FieldValue.serverTimestamp();
      transaction.update(reference, {
        status: "closed",
        closedAt: now,
        closedBy: actor.userId,
        closureReason: input.reason,
        totalOutstandingQuantity: 0,
        totalCancelledOutstandingQuantity:
          Number(record.get("totalCancelledOutstandingQuantity") ?? 0) +
          Number(record.get("totalOutstandingQuantity") ?? 0),
        updatedAt: now,
        updatedBy: actor.userId,
      });
      items.docs.forEach((item) =>
        transaction.update(item.ref, {
          itemStatus:
            Number(item.get("fulfilledQuantity") ?? 0) > 0
              ? "partially_fulfilled"
              : "cancelled",
          cancelledOutstandingQuantity:
            Number(item.get("cancelledOutstandingQuantity") ?? 0) +
            Number(item.get("outstandingQuantity") ?? 0),
          outstandingQuantity: 0,
          updatedAt: now,
        }),
      );
      createEvent(
        transaction,
        actor,
        input.requestId,
        String(record.get("branchId")),
        "closed",
        status,
        "closed",
        input.expectedVersion,
        requestCorrelationId,
        input.reason,
      );
      createOperation(
        transaction,
        operation,
        actor,
        "closeBranchRequest",
        input.requestId,
      );
      writeAuditLog(transaction, actor, {
        action: "branch_request.closed",
        entityType: "branchRequest",
        entityId: input.requestId,
        reason: input.reason,
        correlationId: requestCorrelationId,
        sourceFunction: "closeBranchRequest",
      });
    });
    return { requestId: input.requestId, status: "closed" };
  },
);

export const addBranchRequestComment = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    const input = parseInput(requestCommentInput, request.data);
    const operation = operationRef(
      actor,
      "addBranchRequestComment",
      input.idempotencyKey,
    );
    const requestCorrelationId = correlationId();
    await db.runTransaction(async (transaction) => {
      const reference = requestRef(input.requestId);
      const [record, existingOperation] = await transaction.getAll(
        reference,
        operation,
      );
      if (!record || !existingOperation)
        throw new HttpsError(
          "internal",
          "Request transaction reads were incomplete.",
        );
      if (existingOperation.exists) return;
      if (!record.exists)
        throw new HttpsError("not-found", "Request not found.");
      assertReadScope(actor, record);
      if (
        input.visibility === "internal" &&
        !hasServerPermission(actor, "requests.review")
      )
        throw new HttpsError(
          "permission-denied",
          "Internal notes require reviewer access.",
        );
      const comment = db.collection("branchRequestComments").doc();
      transaction.create(comment, {
        organizationId: actor.organizationId,
        requestId: input.requestId,
        branchId: record.get("branchId"),
        comment: input.comment,
        visibility: input.visibility,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actor.userId,
      });
      createEvent(
        transaction,
        actor,
        input.requestId,
        String(record.get("branchId")),
        "comment_added",
        String(record.get("status")),
        String(record.get("status")),
        Number(record.get("version")),
        requestCorrelationId,
        input.visibility === "branch"
          ? input.comment
          : "Internal reviewer note added",
      );
      createOperation(
        transaction,
        operation,
        actor,
        "addBranchRequestComment",
        comment.id,
      );
      writeAuditLog(transaction, actor, {
        action: "branch_request.comment_created",
        entityType: "branchRequestComment",
        entityId: comment.id,
        correlationId: requestCorrelationId,
        sourceFunction: "addBranchRequestComment",
        after: { requestId: input.requestId, visibility: input.visibility },
      });
    });
    return { requestId: input.requestId, created: true };
  },
);

export const getBranchRequest = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request);
  const input = parseInput(requestQueryInput, request.data);
  if (!input.requestId)
    throw new HttpsError("invalid-argument", "Request ID is required.");
  const record = await requestRef(input.requestId).get();
  if (!record.exists) throw new HttpsError("not-found", "Request not found.");
  assertReadScope(actor, record);
  const [items, versions] = await Promise.all([
    db
      .collection("branchRequestItems")
      .where("requestId", "==", input.requestId)
      .get(),
    db
      .collection("branchRequestVersions")
      .where("requestId", "==", input.requestId)
      .orderBy("version", "desc")
      .limit(20)
      .get(),
  ]);
  return {
    request: serialize(record),
    items: items.docs.map(serialize),
    versions: versions.docs.map(serialize),
    futureFulfilment: {
      transferCount: 0,
      message: "No warehouse transfers have been created for this request.",
    },
  };
});

function scopedRequests(
  actor: AccessProfile,
  input: ReturnType<typeof requestQueryInput.parse>,
) {
  let query: Query = db
    .collection("branchRequests")
    .where("organizationId", "==", actor.organizationId);
  if (!hasServerPermission(actor, "requests.read.all")) {
    requirePermission(actor, "requests.read.own_branch");
    if (input.branchId) requireBranchScope(actor, input.branchId);
    const branches = input.branchId ? [input.branchId] : [...actor.branchIds];
    if (branches.length === 0 || branches.length > 30)
      throw new HttpsError(
        "permission-denied",
        "A valid assigned branch is required.",
      );
    query = query.where("branchId", "in", branches);
  } else if (input.branchId)
    query = query.where("branchId", "==", input.branchId);
  if (input.status) query = query.where("status", "==", input.status);
  if (input.priority) query = query.where("priority", "==", input.priority);
  if (input.requestType)
    query = query.where("requestType", "==", input.requestType);
  if (input.startAt)
    query = query.where(
      "createdAt",
      ">=",
      Timestamp.fromDate(new Date(input.startAt)),
    );
  if (input.endAt)
    query = query.where(
      "createdAt",
      "<=",
      Timestamp.fromDate(new Date(input.endAt)),
    );
  return query
    .orderBy("createdAt", "desc")
    .orderBy(FieldPath.documentId(), "desc");
}
export const listBranchRequests = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    const input = parseInput(requestQueryInput, request.data);
    let query = scopedRequests(actor, input);
    if (input.cursor) {
      const cursor = await requestRef(input.cursor).get();
      if (cursor.exists) {
        assertReadScope(actor, cursor);
        query = query.startAfter(cursor);
      }
    }
    const result = await query.limit(input.limit).get();
    return {
      rows: result.docs.map(serialize),
      nextCursor:
        result.size === input.limit ? (result.docs.at(-1)?.id ?? null) : null,
    };
  },
);

export const getBranchRequestTimeline = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    const input = parseInput(requestQueryInput, request.data);
    if (!input.requestId)
      throw new HttpsError("invalid-argument", "Request ID is required.");
    const record = await requestRef(input.requestId).get();
    if (!record.exists) throw new HttpsError("not-found", "Request not found.");
    assertReadScope(actor, record);
    const [events, approvals, comments] = await Promise.all([
      db
        .collection("branchRequestEvents")
        .where("requestId", "==", input.requestId)
        .orderBy("createdAt", "asc")
        .limit(input.limit)
        .get(),
      db
        .collection("branchRequestApprovals")
        .where("requestId", "==", input.requestId)
        .orderBy("createdAt", "asc")
        .limit(input.limit)
        .get(),
      db
        .collection("branchRequestComments")
        .where("requestId", "==", input.requestId)
        .orderBy("createdAt", "asc")
        .limit(input.limit)
        .get(),
    ]);
    const canSeeInternal =
      hasServerPermission(actor, "requests.review") ||
      hasServerPermission(actor, "requests.read.all");
    return {
      events: events.docs.map(serialize),
      approvals: approvals.docs.map(serialize),
      comments: comments.docs
        .filter(
          (comment) => canSeeInternal || comment.get("visibility") === "branch",
        )
        .map(serialize),
    };
  },
);

export const getBranchRequestAvailability = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "requests.review");
    const input = parseInput(requestQueryInput, request.data);
    if (!input.requestId)
      throw new HttpsError("invalid-argument", "Request ID is required.");
    const record = await requestRef(input.requestId).get();
    if (!record.exists) throw new HttpsError("not-found", "Request not found.");
    assertReadScope(actor, record);
    const items = await db
      .collection("branchRequestItems")
      .where("requestId", "==", input.requestId)
      .get();
    const includeCosts =
      input.includeCosts && hasServerPermission(actor, "requests.cost.read");
    const rows = await Promise.all(
      items.docs.map(async (item) => {
        const balances = await db
          .collection("inventoryBalances")
          .where("organizationId", "==", actor.organizationId)
          .where("productId", "==", item.get("productId"))
          .get();
        let onHand = 0,
          reserved = 0,
          available = 0,
          damaged = 0,
          quarantined = 0,
          inTransit = 0,
          value = 0;
        let lastMovementAt: Timestamp | undefined;
        balances.docs.forEach((balance) => {
          const quantity = Number(balance.get("onHandQuantity") ?? 0);
          const type = String(balance.get("locationType") ?? "");
          if (type === "warehouse") {
            onHand += quantity;
            reserved += Number(balance.get("reservedQuantity") ?? 0);
            available += Number(balance.get("availableQuantity") ?? 0);
            value += Number(balance.get("totalValueMinor") ?? 0);
          } else if (type === "damaged") damaged += quantity;
          else if (type === "quarantined") quarantined += quantity;
          else if (type === "goods_in_transit") inTransit += quantity;
          const movement = balance.get("lastMovementAt") as
            Timestamp | undefined;
          if (
            movement &&
            (!lastMovementAt || movement.toMillis() > lastMovementAt.toMillis())
          )
            lastMovementAt = movement;
        });
        return clean({
          requestItemId: item.id,
          productId: item.get("productId"),
          sku: item.get("sku"),
          productName: item.get("productName"),
          trackingType: item.get("trackingType"),
          requestedQuantity: item.get("requestedQuantity"),
          warehouseOnHandQuantity: onHand,
          reservedQuantity: reserved,
          availableQuantity: available,
          damagedQuantity: damaged,
          quarantinedQuantity: quarantined,
          goodsInTransitQuantity: inTransit,
          lastMovementAt: lastMovementAt?.toDate().toISOString(),
          lowStockWarning: available < Number(item.get("requestedQuantity")),
          estimatedValueMinor:
            includeCosts && onHand > 0
              ? Math.round(value / onHand) *
                Number(item.get("requestedQuantity"))
              : undefined,
        });
      }),
    );
    return {
      rows,
      includeCosts,
      informationalOnly: true,
      warning:
        "Availability may change before fulfilment. No stock has been reserved.",
    };
  },
);

export const generateBranchRequestReport = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "reports.requests.read");
    const input = parseInput(requestQueryInput, request.data);
    if (input.reportType === "items" || input.reportType === "product_demand") {
      let itemQuery: Query = db
        .collection("branchRequestItems")
        .where("organizationId", "==", actor.organizationId);
      if (!hasServerPermission(actor, "requests.read.all")) {
        if (actor.branchIds.length === 0 || actor.branchIds.length > 30)
          throw new HttpsError(
            "permission-denied",
            "A valid assigned branch is required.",
          );
        itemQuery = itemQuery.where("branchId", "in", actor.branchIds);
      } else if (input.branchId)
        itemQuery = itemQuery.where("branchId", "==", input.branchId);
      if (input.productId)
        itemQuery = itemQuery.where("productId", "==", input.productId);
      const result = await itemQuery
        .orderBy(FieldPath.documentId())
        .limit(input.limit)
        .get();
      if (input.reportType === "items")
        return { rows: result.docs.map(serialize), nextCursor: null };
      const grouped = new Map<string, RequestRecord>();
      result.docs.forEach((item) => {
        const key = String(item.get("productId"));
        const current = grouped.get(key) ?? {
          productId: key,
          productName: item.get("productName"),
          sku: item.get("sku"),
          quantityRequested: 0,
          quantityApproved: 0,
          quantityRejected: 0,
          branches: new Set<string>(),
          requests: new Set<string>(),
        };
        current.quantityRequested =
          Number(current.quantityRequested) +
          Number(item.get("requestedQuantity"));
        current.quantityApproved =
          Number(current.quantityApproved) +
          Number(item.get("approvedQuantity"));
        current.quantityRejected =
          Number(current.quantityRejected) +
          Number(item.get("rejectedQuantity"));
        (current.branches as Set<string>).add(String(item.get("branchId")));
        (current.requests as Set<string>).add(String(item.get("requestId")));
        grouped.set(key, current);
      });
      return {
        rows: [...grouped.values()].map((row) =>
          clean({
            ...row,
            branchCount: (row.branches as Set<string>).size,
            requestCount: (row.requests as Set<string>).size,
            branches: undefined,
            requests: undefined,
          }),
        ),
        nextCursor: null,
      };
    }
    let queryInput = input;
    if (input.reportType === "pending" && !input.status)
      queryInput = { ...input, status: "submitted" };
    if (input.reportType === "approved_unfulfilled" && !input.status)
      queryInput = { ...input, status: "approved" };
    const result = await scopedRequests(actor, queryInput)
      .limit(input.limit)
      .get();
    const now = Date.now();
    const rows = result.docs.map((document) => {
      const row = serialize(document);
      const created = document.get("submittedAt") as Timestamp | undefined;
      const reviewed = document.get("reviewedAt") as Timestamp | undefined;
      return clean({
        ...row,
        ageDays: created
          ? Math.floor((now - created.toMillis()) / 86_400_000)
          : undefined,
        reviewDurationHours:
          input.reportType === "approval_performance" && created && reviewed
            ? Math.round((reviewed.toMillis() - created.toMillis()) / 3_600_000)
            : undefined,
      });
    });
    return {
      rows,
      nextCursor:
        result.size === input.limit ? (result.docs.at(-1)?.id ?? null) : null,
    };
  },
);
