import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import {
  hasRole,
  requireBranchScope,
  requireAccess,
  requirePermission,
  requireWarehouseScope,
  type AccessProfile,
} from "../auth/authorize.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { enforceAppCheck } from "../config.js";
import { parseSerialNumbers } from "../inventory/calculations.js";
import { postInventoryTransaction } from "../inventory/post-inventory-transaction.js";
import { correlationId, parseInput } from "../utils/callable.js";
import {
  stockCountActionInput,
  stockCountCreateInput,
  stockCountSubmitInput,
} from "../validation/inventory.js";

function requireCountScope(
  actor: AccessProfile,
  count: { get(field: string): unknown },
) {
  const warehouseId = count.get("warehouseId");
  const branchId = count.get("branchId");
  if (typeof warehouseId === "string")
    requireWarehouseScope(actor, warehouseId);
  if (typeof branchId === "string") requireBranchScope(actor, branchId);
  if (
    typeof warehouseId !== "string" &&
    typeof branchId !== "string" &&
    !hasRole(actor, "system_administrator")
  )
    throw new HttpsError(
      "permission-denied",
      "Organization-wide count locations require system-administrator authority.",
    );
}

export const getStockCountWorkspace = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "inventory.count");
    const input = parseInput(stockCountActionInput, request.data);
    const count = await db
      .collection("stockCounts")
      .doc(input.stockCountId)
      .get();
    if (!count.exists || count.get("organizationId") !== actor.organizationId)
      throw new HttpsError("not-found", "Stock count not found.");
    requireCountScope(actor, count);
    const assigned = (count.get("assignedUserIds") as string[]).includes(
      actor.userId,
    );
    const canReview =
      hasRole(actor, "system_administrator") ||
      hasRole(actor, "warehouse_manager");
    if (!assigned && !canReview)
      throw new HttpsError(
        "permission-denied",
        "You cannot access this stock count.",
      );
    const items = await db
      .collection("stockCountItems")
      .where("stockCountId", "==", count.id)
      .limit(200)
      .get();
    const hideExpected =
      count.get("blindCount") === true &&
      count.get("status") === "in_progress" &&
      !canReview;
    return {
      count: { id: count.id, ...count.data() },
      items: items.docs.map((item) => {
        const data = { id: item.id, ...item.data() } as Record<string, unknown>;
        if (hideExpected) {
          delete data.expectedQuantity;
          delete data.expectedSerialNumbers;
          delete data.variance;
        }
        return data;
      }),
    };
  },
);

export const createStockCount = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request);
  requirePermission(actor, "inventory.count");
  const input = parseInput(stockCountCreateInput, request.data);
  const operation = db
    .collection("idempotencyKeys")
    .doc(`${actor.organizationId}_createStockCount_${input.idempotencyKey}`);
  const prior = await operation.get();
  if (prior.exists)
    return { stockCountId: prior.get("entityId") as string, created: false };
  const location = await db
    .collection("inventoryLocations")
    .doc(input.locationId)
    .get();
  if (
    !location.exists ||
    location.get("organizationId") !== actor.organizationId ||
    location.get("status") !== "active"
  )
    throw new HttpsError(
      "failed-precondition",
      "Count location is unavailable.",
    );
  requireCountScope(actor, location);
  const users = await db.getAll(
    ...input.assignedUserIds.map((id) => db.collection("users").doc(id)),
  );
  if (
    users.some(
      (user) =>
        !user.exists ||
        user.get("organizationId") !== actor.organizationId ||
        user.get("status") !== "active" ||
        (typeof location.get("warehouseId") === "string" &&
          !(user.get("warehouseIds") as string[] | undefined)?.includes(
            String(location.get("warehouseId")),
          )) ||
        (typeof location.get("branchId") === "string" &&
          !(user.get("branchIds") as string[] | undefined)?.includes(
            String(location.get("branchId")),
          )),
    )
  )
    throw new HttpsError(
      "failed-precondition",
      "All counters must be active users in this organization.",
    );
  const countReference = db.collection("stockCounts").doc();
  const counterReference = db
    .collection("inventoryCounters")
    .doc(`${actor.organizationId}_stockCounts`);
  const requestId = correlationId();
  await db.runTransaction(async (transaction) => {
    const [existingOperation, counter] = await Promise.all([
      transaction.get(operation),
      transaction.get(counterReference),
    ]);
    if (existingOperation.exists) return;
    const sequence = Number(counter.get("value") ?? 0) + 1;
    const countNumber = `CNT-${new Date(input.countDate).getUTCFullYear()}-${String(sequence).padStart(5, "0")}`;
    const now = FieldValue.serverTimestamp();
    transaction.set(
      counterReference,
      {
        organizationId: actor.organizationId,
        kind: "stockCount",
        value: sequence,
        updatedAt: now,
      },
      { merge: true },
    );
    transaction.create(countReference, {
      organizationId: actor.organizationId,
      countNumber,
      locationId: input.locationId,
      warehouseId: location.get("warehouseId") ?? null,
      branchId: location.get("branchId") ?? null,
      status: "draft",
      blindCount: input.blindCount,
      assignedUserIds: input.assignedUserIds,
      countDate: input.countDate,
      notes: input.notes ?? null,
      createdAt: now,
      createdBy: actor.userId,
      updatedAt: now,
      updatedBy: actor.userId,
    });
    transaction.create(operation, {
      organizationId: actor.organizationId,
      action: "createStockCount",
      entityId: countReference.id,
      status: "completed",
      createdAt: now,
      createdBy: actor.userId,
    });
    writeAuditLog(transaction, actor, {
      action: "stock_count.created",
      entityType: "stockCount",
      entityId: countReference.id,
      correlationId: requestId,
      sourceFunction: "createStockCount",
      after: {
        countNumber,
        locationId: input.locationId,
        blindCount: input.blindCount,
      },
    });
  });
  return { stockCountId: countReference.id, created: true };
});

export const startStockCount = onCall(
  { enforceAppCheck, timeoutSeconds: 60 },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "inventory.count");
    const input = parseInput(stockCountActionInput, request.data);
    const countReference = db.collection("stockCounts").doc(input.stockCountId);
    const count = await countReference.get();
    if (!count.exists || count.get("organizationId") !== actor.organizationId)
      throw new HttpsError("not-found", "Stock count not found.");
    requireCountScope(actor, count);
    if (count.get("status") !== "draft")
      throw new HttpsError(
        "failed-precondition",
        "Only draft counts can be started.",
      );
    const balances = await db
      .collection("inventoryBalances")
      .where("organizationId", "==", actor.organizationId)
      .where("locationId", "==", count.get("locationId"))
      .limit(200)
      .get();
    const serials = await db
      .collection("serializedItems")
      .where("organizationId", "==", actor.organizationId)
      .where("currentLocationId", "==", count.get("locationId"))
      .where("active", "==", true)
      .limit(1000)
      .get();
    const serialsByProduct = new Map<string, string[]>();
    serials.docs.forEach((item) => {
      const values = serialsByProduct.get(String(item.get("productId"))) ?? [];
      values.push(String(item.get("normalizedSerialNumber")));
      serialsByProduct.set(String(item.get("productId")), values);
    });
    const requestId = correlationId();
    await db.runTransaction(async (transaction) => {
      const fresh = await transaction.get(countReference);
      if (fresh.get("status") !== "draft")
        throw new HttpsError(
          "failed-precondition",
          "Stock count state changed.",
        );
      const currentBalances = await transaction.getAll(
        ...balances.docs.map((balance) => balance.ref),
      );
      for (let index = 0; index < balances.size; index++)
        if (
          currentBalances[index]?.get("version") !==
          balances.docs[index]?.get("version")
        )
          throw new HttpsError(
            "aborted",
            "Inventory moved while the count snapshot was being created. Retry.",
          );
      const now = FieldValue.serverTimestamp();
      for (const balance of balances.docs) {
        const item = db
          .collection("stockCountItems")
          .doc(`${countReference.id}__${balance.id}`);
        transaction.create(item, {
          organizationId: actor.organizationId,
          stockCountId: countReference.id,
          productId: balance.get("productId"),
          sku: balance.get("sku"),
          trackingType: balance.get("trackingType") ?? "quantity",
          locationId: count.get("locationId"),
          warehouseId: count.get("warehouseId") ?? null,
          branchId: count.get("branchId") ?? null,
          lotId: balance.get("lotId") ?? null,
          expectedQuantity: balance.get("onHandQuantity"),
          expectedSerialNumbers:
            serialsByProduct.get(String(balance.get("productId"))) ?? [],
          countedQuantity: null,
          countedSerialNumbers: [],
          variance: null,
          createdAt: now,
          updatedAt: now,
        });
      }
      transaction.update(countReference, {
        status: "in_progress",
        snapshotAt: now,
        startedAt: now,
        startedBy: actor.userId,
        updatedAt: now,
        updatedBy: actor.userId,
      });
      writeAuditLog(transaction, actor, {
        action: "stock_count.started",
        entityType: "stockCount",
        entityId: countReference.id,
        correlationId: requestId,
        sourceFunction: "startStockCount",
        reason: input.reason,
        after: { itemCount: balances.size },
      });
    });
    return {
      stockCountId: countReference.id,
      itemCount: balances.size,
      started: true,
    };
  },
);

export const submitStockCount = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request);
  requirePermission(actor, "inventory.count");
  const input = parseInput(stockCountSubmitInput, request.data);
  const countReference = db.collection("stockCounts").doc(input.stockCountId);
  const itemReferences = input.items.map((item) =>
    db.collection("stockCountItems").doc(item.itemId),
  );
  const requestId = correlationId();
  await db.runTransaction(async (transaction) => {
    const snapshots = await transaction.getAll(
      countReference,
      ...itemReferences,
    );
    const count = snapshots[0]!;
    const items = snapshots.slice(1);
    if (
      !count.exists ||
      count.get("organizationId") !== actor.organizationId ||
      count.get("status") !== "in_progress"
    )
      throw new HttpsError(
        "failed-precondition",
        "Stock count cannot be submitted.",
      );
    requireCountScope(actor, count);
    if (
      !(count.get("assignedUserIds") as string[]).includes(actor.userId) &&
      !hasRole(actor, "system_administrator")
    )
      throw new HttpsError(
        "permission-denied",
        "You are not assigned to this count.",
      );
    for (let index = 0; index < input.items.length; index++) {
      const submitted = input.items[index]!;
      const item = items[index]!;
      if (!item.exists || item.get("stockCountId") !== countReference.id)
        throw new HttpsError(
          "invalid-argument",
          "Stock count item does not belong to this count.",
        );
      const serials = parseSerialNumbers(submitted.serialNumbers);
      if (
        serials.duplicates.length ||
        (item.get("trackingType") === "serial" &&
          serials.normalized.length !== submitted.countedQuantity) ||
        (item.get("trackingType") !== "serial" && serials.normalized.length > 0)
      )
        throw new HttpsError(
          "invalid-argument",
          "Counted serial numbers must be unique and equal counted quantity.",
        );
      transaction.update(item.ref, {
        countedQuantity: submitted.countedQuantity,
        countedSerialNumbers: serials.normalized,
        variance:
          submitted.countedQuantity - Number(item.get("expectedQuantity")),
        notes: submitted.notes ?? null,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actor.userId,
      });
    }
    const now = FieldValue.serverTimestamp();
    transaction.update(countReference, {
      status: "submitted",
      submittedAt: now,
      submittedBy: actor.userId,
      updatedAt: now,
      updatedBy: actor.userId,
    });
    writeAuditLog(transaction, actor, {
      action: "stock_count.submitted",
      entityType: "stockCount",
      entityId: countReference.id,
      correlationId: requestId,
      sourceFunction: "submitStockCount",
      reason: input.reason,
      after: { submittedItems: input.items.length },
    });
  });
  return { stockCountId: input.stockCountId, submitted: true };
});

export const reviewStockCount = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request);
  requirePermission(actor, "inventory.count_review");
  const input = parseInput(stockCountActionInput, request.data);
  const reference = db.collection("stockCounts").doc(input.stockCountId);
  const requestId = correlationId();
  await db.runTransaction(async (transaction) => {
    const count = await transaction.get(reference);
    if (
      !count.exists ||
      count.get("organizationId") !== actor.organizationId ||
      count.get("status") !== "submitted"
    )
      throw new HttpsError(
        "failed-precondition",
        "Only submitted counts can be reviewed.",
      );
    requireCountScope(actor, count);
    if (
      count.get("submittedBy") === actor.userId ||
      count.get("createdBy") === actor.userId
    )
      throw new HttpsError(
        "permission-denied",
        "The count maker cannot review their own count.",
      );
    const now = FieldValue.serverTimestamp();
    transaction.update(reference, {
      status: "reviewed",
      reviewedAt: now,
      reviewedBy: actor.userId,
      reviewReason: input.reason,
      updatedAt: now,
      updatedBy: actor.userId,
    });
    writeAuditLog(transaction, actor, {
      action: "stock_count.reviewed",
      entityType: "stockCount",
      entityId: reference.id,
      correlationId: requestId,
      sourceFunction: "reviewStockCount",
      reason: input.reason,
    });
  });
  return { stockCountId: input.stockCountId, reviewed: true };
});

export const postStockCount = onCall(
  { enforceAppCheck, timeoutSeconds: 300 },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "inventory.count_review");
    const input = parseInput(stockCountActionInput, request.data);
    const countReference = db.collection("stockCounts").doc(input.stockCountId);
    const count = await countReference.get();
    if (
      !count.exists ||
      count.get("organizationId") !== actor.organizationId ||
      count.get("status") !== "reviewed"
    )
      throw new HttpsError(
        "failed-precondition",
        "Only reviewed counts can be posted.",
      );
    requireCountScope(actor, count);
    if (count.get("reviewedBy") === actor.userId)
      throw new HttpsError(
        "permission-denied",
        "The reviewer cannot also post the count.",
      );
    const items = await db
      .collection("stockCountItems")
      .where("stockCountId", "==", countReference.id)
      .where("variance", "!=", 0)
      .orderBy("variance")
      .limit(100)
      .get();
    const transactionIds: string[] = [];
    for (const item of items.docs) {
      const variance = Number(item.get("variance"));
      const expectedSerials = new Set(
        (item.get("expectedSerialNumbers") as string[] | undefined) ?? [],
      );
      const countedSerials = new Set(
        (item.get("countedSerialNumbers") as string[] | undefined) ?? [],
      );
      const serialNumbers =
        variance < 0
          ? [...expectedSerials].filter((serial) => !countedSerials.has(serial))
          : [...countedSerials].filter(
              (serial) => !expectedSerials.has(serial),
            );
      const balanceId = String(item.id).split("__").slice(1).join("__");
      const balance = await db
        .collection("inventoryBalances")
        .doc(balanceId)
        .get();
      const result = await postInventoryTransaction(actor, {
        transactionType: "stock_count_correction",
        productId: String(item.get("productId")),
        quantity: Math.abs(variance),
        sourceLocationId:
          variance < 0 ? String(count.get("locationId")) : undefined,
        destinationLocationId:
          variance > 0 ? String(count.get("locationId")) : undefined,
        externalAccount: "stock_count_variance",
        unitCostMinor: Number(balance.get("averageUnitCostMinor") ?? 0),
        serialNumbers,
        lotId:
          typeof item.get("lotId") === "string"
            ? String(item.get("lotId"))
            : undefined,
        effectiveAt: new Date().toISOString(),
        reason: input.reason,
        referenceType: "stock_count",
        referenceId: countReference.id,
        referenceNumber: String(count.get("countNumber")),
        idempotencyKey: `${countReference.id}-${item.id}`,
        correlationId: correlationId(),
        sourceFunction: "postStockCount",
      });
      transactionIds.push(result.transactionId);
    }
    const requestId = correlationId();
    await db.runTransaction(async (transaction) => {
      const fresh = await transaction.get(countReference);
      if (fresh.get("status") !== "reviewed")
        throw new HttpsError(
          "failed-precondition",
          "Stock count state changed.",
        );
      const now = FieldValue.serverTimestamp();
      transaction.update(countReference, {
        status: "posted",
        postedAt: now,
        postedBy: actor.userId,
        inventoryTransactionIds: transactionIds,
        updatedAt: now,
        updatedBy: actor.userId,
      });
      writeAuditLog(transaction, actor, {
        action: "stock_count.posted",
        entityType: "stockCount",
        entityId: countReference.id,
        correlationId: requestId,
        sourceFunction: "postStockCount",
        reason: input.reason,
        after: { transactionIds },
      });
    });
    logger.info("Stock count posted", {
      organizationId: actor.organizationId,
      stockCountId: countReference.id,
      transactionCount: transactionIds.length,
      correlationId: requestId,
    });
    return { stockCountId: countReference.id, transactionIds, posted: true };
  },
);
