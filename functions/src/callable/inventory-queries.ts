import {
  AggregateField,
  FieldPath,
  FieldValue,
  Timestamp,
  type Query,
} from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import {
  HttpsError,
  onCall,
  type CallableRequest,
} from "firebase-functions/v2/https";
import { db } from "../admin.js";
import {
  hasRole,
  hasServerPermission,
  requireAccess,
  requirePermission,
  type AccessProfile,
} from "../auth/authorize.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { enforceAppCheck } from "../config.js";
import { correlationId, parseInput } from "../utils/callable.js";
import { pageInput, reconciliationInput, stockPositionInput } from "../validation/inventory.js";
import { uniquenessDocumentId } from "../inventory/calculations.js";

function organizationWide(actor: AccessProfile) {
  return [
    "system_administrator",
    "operations_administrator",
    "finance_officer",
    "auditor",
  ].some((roleId) => hasRole(actor, roleId as Parameters<typeof hasRole>[1]));
}

function scopedQuery(query: Query, actor: AccessProfile, readOnly = false): Query {
  if (organizationWide(actor)) return query;
  // requireAccess has already validated and narrowed the selected context.
  // A branch manager keeps that existing branch authority when also assigned a
  // warehouse role. Write/audit callers retain the legacy precedence unchanged.
  const selectedBranchRead = readOnly && hasRole(actor, "branch_manager") &&
    actor.branchIds.length > 0 && actor.warehouseIds.length === 0;
  if (!selectedBranchRead && (hasRole(actor, "warehouse_manager") || hasRole(actor, "warehouse_officer"))) {
    if (actor.warehouseIds.length === 0)
      throw new HttpsError("permission-denied", "No warehouse is assigned.");
    if (actor.warehouseIds.length > 30)
      throw new HttpsError(
        "resource-exhausted",
        "Inventory queries support at most 30 warehouse assignments per page.",
      );
    return query.where("warehouseId", "in", actor.warehouseIds);
  }
  if (hasRole(actor, "branch_manager")) {
    if (actor.branchIds.length === 0)
      throw new HttpsError("permission-denied", "No branch is assigned.");
    if (actor.branchIds.length > 30)
      throw new HttpsError(
        "resource-exhausted",
        "Inventory queries support at most 30 branch assignments per page.",
      );
    return query.where("branchId", "in", actor.branchIds);
  }
  throw new HttpsError("permission-denied", "Inventory scope is unavailable.");
}

function recordInScope(
  actor: AccessProfile,
  snapshot: FirebaseFirestore.DocumentSnapshot,
  readOnly = false,
) {
  if (organizationWide(actor)) return true;
  const selectedBranchRead = readOnly && hasRole(actor, "branch_manager") &&
    actor.branchIds.length > 0 && actor.warehouseIds.length === 0;
  if (!selectedBranchRead && (hasRole(actor, "warehouse_manager") || hasRole(actor, "warehouse_officer")))
    return actor.warehouseIds.includes(String(snapshot.get("warehouseId")));
  if (hasRole(actor, "branch_manager"))
    return actor.branchIds.includes(String(snapshot.get("branchId")));
  return false;
}

function serialize(
  snapshot: FirebaseFirestore.DocumentSnapshot,
  includeCosts: boolean,
) {
  const data = { id: snapshot.id, ...snapshot.data() } as Record<
    string,
    unknown
  >;
  for (const [key, value] of Object.entries(data))
    if (value instanceof Timestamp) data[key] = value.toDate().toISOString();
  if (!includeCosts)
    for (const key of [
      "unitCostMinor",
      "valueDeltaMinor",
      "averageUnitCostMinor",
      "totalValueMinor",
      "acquisitionUnitCostMinor",
      "currentUnitCostMinor",
      "defaultUnitCostMinor",
    ])
      delete data[key];
  return data;
}
function applyEntryFilters(
  query: Query,
  input: ReturnType<typeof pageInput.parse>,
  organizationId: string,
): Query {
  let result = query.where("organizationId", "==", organizationId);
  if (input.productId)
    result = result.where("productId", "==", input.productId);
  if (input.locationId)
    result = result.where("locationId", "==", input.locationId);
  if (input.transactionType)
    result = result.where("transactionType", "==", input.transactionType);
  if (input.serialNumber)
    result = result.where("serialNumber", "==", input.serialNumber);
  if (input.startAt)
    result = result.where(
      "effectiveAt",
      ">=",
      Timestamp.fromDate(new Date(input.startAt)),
    );
  if (input.endAt)
    result = result.where(
      "effectiveAt",
      "<=",
      Timestamp.fromDate(new Date(input.endAt)),
    );
  return result
    .orderBy("effectiveAt", "desc")
    .orderBy(FieldPath.documentId(), "desc");
}

export const getSkuMovementHistory = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "inventory.read");
    const input = parseInput(pageInput, request.data);
    const includeCosts =
      input.includeCosts && hasServerPermission(actor, "inventory.cost.read");
    let query = applyEntryFilters(
      scopedQuery(db.collection("inventoryEntries"), actor, true),
      input,
      actor.organizationId,
    );
    if (input.cursor) {
      const cursor = await db
        .collection("inventoryEntries")
        .doc(input.cursor)
        .get();
      if (
        cursor.exists &&
        cursor.get("organizationId") === actor.organizationId
      )
        query = query.startAfter(cursor);
    }
    const result = await query.limit(input.limit).get();
    return {
      rows: result.docs.map((document) => serialize(document, includeCosts)),
      nextCursor:
        result.size === input.limit ? (result.docs.at(-1)?.id ?? null) : null,
      includeCosts,
    };
  },
);

export const getSerialItemHistory = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "inventory.read");
    const input = parseInput(pageInput, request.data);
    if (!input.serialNumber)
      throw new HttpsError("invalid-argument", "Serial number is required.");
    const serializedItemId = uniquenessDocumentId(
      actor.organizationId,
      input.serialNumber,
    );
    const item = await db
      .collection("serializedItems")
      .doc(serializedItemId)
      .get();
    if (
      !item.exists ||
      item.get("organizationId") !== actor.organizationId ||
      !recordInScope(actor, item, true)
    )
      throw new HttpsError("not-found", "Serialized item not found.");
    const includeCosts =
      input.includeCosts && hasServerPermission(actor, "inventory.cost.read");
    let query: Query = db
      .collection("inventoryEntries")
      .where("organizationId", "==", actor.organizationId)
      .where("serializedItemId", "==", serializedItemId)
      .orderBy("effectiveAt", "desc")
      .orderBy(FieldPath.documentId(), "desc");
    if (input.cursor) {
      const cursor = await db
        .collection("inventoryEntries")
        .doc(input.cursor)
        .get();
      if (
        cursor.exists &&
        cursor.get("organizationId") === actor.organizationId
      )
        query = query.startAfter(cursor);
    }
    const snapshot = await query.limit(input.limit).get();
    return {
      item: serialize(item, includeCosts),
      rows: snapshot.docs.map((document) => serialize(document, includeCosts)),
      nextCursor:
        snapshot.size === input.limit
          ? (snapshot.docs.at(-1)?.id ?? null)
          : null,
      includeCosts,
    };
  },
);

export const getProductStockSummary = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "inventory.read");
    const input = parseInput(pageInput, request.data);
    if (!input.productId)
      throw new HttpsError("invalid-argument", "Product is required.");
    const includeCosts =
      input.includeCosts && hasServerPermission(actor, "inventory.cost.read");
    const [product, productCost, balances, serials, lots] = await Promise.all([
      db.collection("products").doc(input.productId).get(),
      db.collection("productCosts").doc(input.productId).get(),
      scopedQuery(
        db
          .collection("inventoryBalances")
          .where("organizationId", "==", actor.organizationId)
          .where("productId", "==", input.productId),
        actor, true,
      )
        .limit(200)
        .get(),
      scopedQuery(
        db
          .collection("serializedItems")
          .where("organizationId", "==", actor.organizationId)
          .where("productId", "==", input.productId),
        actor, true,
      )
        .limit(100)
        .get(),
      db
        .collection("inventoryLots")
        .where("organizationId", "==", actor.organizationId)
        .where("productId", "==", input.productId)
        .limit(100)
        .get(),
    ]);
    if (
      !product.exists ||
      product.get("organizationId") !== actor.organizationId
    )
      throw new HttpsError("not-found", "Product not found.");
    const total = balances.docs.reduce(
      (summary, balance) => ({
        onHand: summary.onHand + Number(balance.get("onHandQuantity")),
        reserved: summary.reserved + Number(balance.get("reservedQuantity")),
        available: summary.available + Number(balance.get("availableQuantity")),
        valueMinor:
          summary.valueMinor +
          (includeCosts ? Number(balance.get("totalValueMinor")) : 0),
      }),
      { onHand: 0, reserved: 0, available: 0, valueMinor: 0 },
    );
    return {
      product: {
        ...serialize(product, includeCosts),
        ...(includeCosts && productCost.exists
          ? { defaultUnitCostMinor: productCost.get("defaultUnitCostMinor") }
          : {}),
      },
      totals: total,
      balances: balances.docs.map((document) =>
        serialize(document, includeCosts),
      ),
      serializedItems: serials.docs.map((document) =>
        serialize(document, includeCosts),
      ),
      lots: organizationWide(actor)
        ? lots.docs.map((document) => serialize(document, includeCosts))
        : [],
      includeCosts,
    };
  },
);

/** Read-only, bounded pages. Inventory locations retain their own identities;
 * a Store/Warehouse mapping is supplied as location IDs, never merged entity IDs.
 * Multiple 30-ID query groups are merged by the same document-ID order. */
async function stockPositionReport(request: CallableRequest<unknown>) {
  const actor = await requireAccess(request);
  requirePermission(actor, "inventory.read");
  const input = parseInput(stockPositionInput, request.data);
  const membership = input.view === "membership";
  const includeCosts = !membership && input.includeCosts &&
    hasServerPermission(actor, "inventory.cost.read");
  const ids = input.locationIds ? [...new Set(input.locationIds)] : null;
  const groups: (string[] | null)[] = ids
    ? Array.from({ length: Math.ceil(ids.length / 30) }, (_, index) => ids.slice(index * 30, index * 30 + 30))
    : [null];
  const pages: { documents: FirebaseFirestore.QueryDocumentSnapshot[]; summary: Record<string, number> | null }[] = [];
  // Bound concurrent reads even for unusually many physical inventory areas.
  for (let start = 0; start < groups.length; start += 3) {
    const batch = await Promise.all(groups.slice(start, start + 3).map(async (locationIds) => {
      let query = scopedQuery(db.collection("inventoryBalances")
        .where("organizationId", "==", actor.organizationId), actor, true);
      if (input.productId) query = query.where("productId", "==", input.productId);
      if (input.locationId) query = query.where("locationId", "==", input.locationId);
      if (locationIds) query = query.where("locationId", "in", locationIds);
      const summaryQuery = !membership && input.withSummary ? query.aggregate({
        count: AggregateField.count(),
        onHandQuantity: AggregateField.sum("onHandQuantity"),
        reservedQuantity: AggregateField.sum("reservedQuantity"),
        availableQuantity: AggregateField.sum("availableQuantity"),
        valueMinor: AggregateField.sum("totalValueMinor"),
      }) : null;
      query = query.orderBy(FieldPath.documentId());
      if (input.cursor) query = query.startAfter(input.cursor);
      if (membership) query = query.select("productId");
      const [snapshot, aggregate] = await Promise.all([query.limit(input.limit + 1).get(), summaryQuery?.get()]);
      return {
        documents: snapshot.docs,
        summary: aggregate ? Object.fromEntries(Object.entries(aggregate.data()).filter(([key]) => includeCosts || key !== "valueMinor").map(([key, value]) => [key, Number(value ?? 0)])) : null,
      };
    }));
    pages.push(...batch);
  }
  const documents = pages.flatMap((page) => page.documents)
    .sort((left, right) => Buffer.compare(Buffer.from(left.id), Buffer.from(right.id)));
  const visible = documents.slice(0, input.limit);
  const summary = pages.some((page) => page.summary) ? pages.reduce<Record<string, number>>((total, page) => {
    for (const [key, value] of Object.entries(page.summary ?? {})) total[key] = (total[key] ?? 0) + value;
    return total;
  }, {}) : null;
  return {
    reportType: "stock",
    summary,
    rows: membership
      ? visible.map((document) => ({ id: document.id, productId: document.get("productId") }))
      : visible.map((document) => serialize(document, includeCosts)),
    nextCursor: documents.length > input.limit ? visible.at(-1)?.id ?? null : null,
    includeCosts,
  };
}

async function report(
  request: CallableRequest<unknown>,
  kind: "movement" | "valuation" | "serial",
) {
  const actor = await requireAccess(request);
  requirePermission(
    actor,
    "reports.inventory.read",
  );
  const input = parseInput(pageInput, request.data);
  const includeCosts =
    input.includeCosts && hasServerPermission(actor, "inventory.cost.read");
  const collectionName =
    kind === "movement"
      ? "inventoryEntries"
      : kind === "serial"
        ? "serializedItems"
        : "inventoryBalances";
  let query: Query;
  if (kind === "movement") {
    query = applyEntryFilters(
      scopedQuery(db.collection(collectionName), actor, true),
      input,
      actor.organizationId,
    );
  } else {
    query = scopedQuery(
      db
        .collection(collectionName)
        .where("organizationId", "==", actor.organizationId),
      actor, true,
    );
    if (input.productId)
      query = query.where("productId", "==", input.productId);
    if (input.locationId)
      query = query.where(
        kind === "serial" ? "currentLocationId" : "locationId",
        "==",
        input.locationId,
      );
  }
  const summaryQuery = kind === "valuation" ? query.aggregate({
    count: AggregateField.count(),
    onHandQuantity: AggregateField.sum("onHandQuantity"),
    reservedQuantity: AggregateField.sum("reservedQuantity"),
    availableQuantity: AggregateField.sum("availableQuantity"),
    valueMinor: AggregateField.sum("totalValueMinor"),
  }) : null;
  if (kind !== "movement") query = query.orderBy(FieldPath.documentId());
  if (input.cursor) {
    const cursor = await db.collection(collectionName).doc(input.cursor).get();
    if (cursor.exists && cursor.get("organizationId") === actor.organizationId)
      query = query.startAfter(cursor);
  }
  query = query.limit(input.limit);
  const [snapshot, summarySnapshot] = await Promise.all([query.get(), summaryQuery?.get()]);
  return {
    reportType: kind,
    summary: summarySnapshot ? Object.fromEntries(Object.entries(summarySnapshot.data())
      .filter(([key]) => includeCosts || key !== "valueMinor")
      .map(([key, value]) => [key, Number(value ?? 0)])) : null,
    rows: snapshot.docs.map((document) => serialize(document, includeCosts)),
    nextCursor:
      snapshot.size === input.limit ? (snapshot.docs.at(-1)?.id ?? null) : null,
    includeCosts,
  };
}
export const generateStockPositionReport = onCall(
  { enforceAppCheck },
  (request) => stockPositionReport(request),
);
export const generateSkuMovementReport = onCall(
  { enforceAppCheck },
  (request) => report(request, "movement"),
);
export const generateInventoryValuationReport = onCall(
  { enforceAppCheck },
  (request) => report(request, "valuation"),
);
export const generateSerialNumberReport = onCall(
  { enforceAppCheck },
  (request) => report(request, "serial"),
);

export const generateStockAdjustmentReport = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "reports.inventory.read");
    const input = parseInput(pageInput, request.data);
    const includeCosts =
      input.includeCosts && hasServerPermission(actor, "inventory.cost.read");
    let query: Query = scopedQuery(
      db
        .collection("inventoryEntries")
        .where("organizationId", "==", actor.organizationId),
      actor, true,
    )
      .where("transactionType", "==", "stock_adjustment")
      .orderBy(FieldPath.documentId());
    if (input.productId)
      query = query.where("productId", "==", input.productId);
    if (input.locationId)
      query = query.where("locationId", "==", input.locationId);
    query = query.limit(input.limit);
    if (input.cursor) query = query.startAfter(input.cursor);
    const snapshot = await query.get();
    return {
      reportType: "adjustment",
      rows: snapshot.docs.map((document) => serialize(document, includeCosts)),
      nextCursor:
        snapshot.size === input.limit
          ? (snapshot.docs.at(-1)?.id ?? null)
          : null,
      includeCosts,
    };
  },
);

export const generateStockCountVarianceReport = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "reports.inventory.read");
    const input = parseInput(pageInput, request.data);
    let query: Query = scopedQuery(
      db
        .collection("stockCountItems")
        .where("organizationId", "==", actor.organizationId),
      actor, true,
    )
      .where("variance", "!=", 0)
      .orderBy("variance")
      .orderBy(FieldPath.documentId());
    if (input.productId)
      query = query.where("productId", "==", input.productId);
    if (input.locationId)
      query = query.where("locationId", "==", input.locationId);
    query = query.limit(input.limit);
    if (input.cursor) {
      const cursor = await db
        .collection("stockCountItems")
        .doc(input.cursor)
        .get();
      if (
        cursor.exists &&
        cursor.get("organizationId") === actor.organizationId
      )
        query = query.startAfter(cursor);
    }
    const snapshot = await query.get();
    return {
      reportType: "stock_count_variance",
      rows: snapshot.docs.map((document) => serialize(document, false)),
      nextCursor:
        snapshot.size === input.limit
          ? (snapshot.docs.at(-1)?.id ?? null)
          : null,
      includeCosts: false,
    };
  },
);

export const reconcileInventoryBalances = onCall(
  { enforceAppCheck, timeoutSeconds: 120 },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "inventory.reconcile");
    const input = parseInput(reconciliationInput, request.data);
    let query: Query = db
      .collection("inventoryBalances")
      .where("organizationId", "==", actor.organizationId);
    if (input.productId)
      query = query.where("productId", "==", input.productId);
    if (input.locationId)
      query = query.where("locationId", "==", input.locationId);
    query = scopedQuery(query, actor);
    const balances = await query.limit(input.limit).get();
    const includeCosts = hasServerPermission(actor, "inventory.cost.read");
    const discrepancies: Record<string, unknown>[] = [];
    for (const balance of balances.docs) {
      const entries = await db
        .collection("inventoryEntries")
        .where("organizationId", "==", actor.organizationId)
        .where("productId", "==", balance.get("productId"))
        .where("locationId", "==", balance.get("locationId"))
        .limit(2000)
        .get();
      const relevant = entries.docs.filter(
        (entry) =>
          (entry.get("lotId") ?? null) === (balance.get("lotId") ?? null),
      );
      const ledgerQuantity = relevant.reduce(
        (sum, entry) => sum + Number(entry.get("quantityDelta")),
        0,
      );
      const ledgerValueMinor = relevant.reduce(
        (sum, entry) => sum + Number(entry.get("valueDeltaMinor")),
        0,
      );
      const serialCount = (
        await db
          .collection("serializedItems")
          .where("organizationId", "==", actor.organizationId)
          .where("productId", "==", balance.get("productId"))
          .where("currentLocationId", "==", balance.get("locationId"))
          .where("active", "==", true)
          .get()
      ).size;
      const product = await db
        .collection("products")
        .doc(String(balance.get("productId")))
        .get();
      const lotId =
        typeof balance.get("lotId") === "string"
          ? String(balance.get("lotId"))
          : undefined;
      const lot = lotId
        ? await db.collection("inventoryLots").doc(lotId).get()
        : undefined;
      const lotLocations =
        (lot?.get("locationQuantities") as
          | Record<string, number>
          | undefined) ?? {};
      const lotLocationQuantity = lotId
        ? Number(lotLocations[String(balance.get("locationId"))] ?? 0)
        : undefined;
      const lotComputedRemaining = lotId
        ? Object.values(lotLocations).reduce((sum, value) => sum + value, 0)
        : undefined;
      const mismatch =
        ledgerQuantity !== Number(balance.get("onHandQuantity")) ||
        ledgerValueMinor !== Number(balance.get("totalValueMinor")) ||
        (product.get("trackingType") === "serial" &&
          serialCount !== Number(balance.get("onHandQuantity"))) ||
        (lotId !== undefined &&
          (!lot?.exists ||
            lotLocationQuantity !== Number(balance.get("onHandQuantity")) ||
            lotComputedRemaining !== Number(lot.get("remainingQuantity"))));
      if (mismatch)
        discrepancies.push({
          balanceId: balance.id,
          productId: balance.get("productId"),
          locationId: balance.get("locationId"),
          storedQuantity: balance.get("onHandQuantity"),
          ledgerQuantity,
          ...(includeCosts
            ? {
                storedValueMinor: balance.get("totalValueMinor"),
                ledgerValueMinor,
              }
            : {}),
          serializedItemCount: serialCount,
          ...(lotId
            ? {
                lotId,
                lotLocationQuantity,
                lotStoredRemaining: lot?.get("remainingQuantity") ?? null,
                lotComputedRemaining,
              }
            : {}),
        });
    }
    const runReference = db.collection("inventoryReconciliations").doc();
    const requestId = correlationId();
    await db.runTransaction(async (transaction) => {
      const now = FieldValue.serverTimestamp();
      transaction.create(runReference, {
        organizationId: actor.organizationId,
        filters: input,
        checkedBalances: balances.size,
        discrepancyCount: discrepancies.length,
        discrepancies: discrepancies.slice(0, 100),
        readOnly: true,
        createdAt: now,
        createdBy: actor.userId,
        correlationId: requestId,
      });
      writeAuditLog(transaction, actor, {
        action: "inventory.reconciliation_executed",
        entityType: "inventoryReconciliation",
        entityId: runReference.id,
        correlationId: requestId,
        sourceFunction: "reconcileInventoryBalances",
        after: {
          checkedBalances: balances.size,
          discrepancyCount: discrepancies.length,
        },
      });
    });
    logger.info("Inventory reconciliation completed", {
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      reconciliationId: runReference.id,
      checkedBalances: balances.size,
      discrepancyCount: discrepancies.length,
      correlationId: requestId,
    });
    return {
      reconciliationId: runReference.id,
      checkedBalances: balances.size,
      discrepancyCount: discrepancies.length,
      discrepancies,
    };
  },
);
