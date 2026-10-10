import {
  FieldValue,
  Timestamp,
  type DocumentSnapshot,
  type Transaction,
} from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { createHash } from "node:crypto";
import { db } from "../admin.js";
import {
  hasRole,
  requireBranchScope,
  requireWarehouseScope,
  type AccessProfile,
} from "../auth/authorize.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import {
  balanceDocumentId,
  issueCost,
  normalizeInventoryIdentifier,
  parseSerialNumbers,
  receiptCost,
  uniquenessDocumentId,
} from "./calculations.js";

export type PostingType =
  | "opening_balance"
  | "inventory_receipt"
  | "location_transfer"
  | "stock_adjustment"
  | "stock_count_correction"
  | "transfer_dispatch"
  | "transfer_receipt"
  | "discrepancy_resolution"
  | "branch_sale"
  | "sale_return"
  | "supplier_return"
  | "reversal";
export interface PostingRequest {
  readonly transactionType: PostingType;
  readonly productId: string;
  readonly quantity: number;
  readonly sourceLocationId?: string;
  readonly destinationLocationId?: string;
  readonly externalAccount?: string;
  readonly unitCostMinor?: number;
  readonly serialNumbers: readonly string[];
  readonly lotId?: string;
  readonly lot?: {
    lotNumber: string;
    manufacturingDate?: string;
    expiryDate?: string;
    supplierReference?: string;
  };
  readonly effectiveAt: string;
  readonly reason: string;
  readonly notes?: string;
  readonly referenceType?: string;
  readonly referenceId?: string;
  readonly referenceNumber?: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly sourceFunction: string;
  /** Trusted callers with stable instructions may opt into exact financial retries. */
  readonly requestFingerprint?: string;
  /** Trusted internal capability. Callable schemas never expose this field. */
  readonly transferContext?: {
    readonly transferId: string;
    readonly consumeReservedQuantity?: number;
  };
}
interface LocationRecord {
  id: string;
  type: string;
  warehouseId?: string;
  branchId?: string;
  organizationId: string;
  status: string;
}
interface BalanceState {
  quantity: number;
  reserved: number;
  totalValueMinor: number;
  averageUnitCostMinor: number;
  version: number;
  exists: boolean;
  createdAt?: unknown;
}

/** Calculated by the ledger, never accepted from a callable payload. */
export interface InventoryPostingContext {
  readonly transactionId: string;
  readonly transactionNumber: string;
  readonly productId: string;
  readonly quantity: number;
  readonly movementValueMinor: number;
  readonly movementUnitCostMinor: number;
  readonly sourceLocationId?: string;
  readonly destinationLocationId?: string;
  readonly sourceBranchId?: string;
  readonly sourceWarehouseId?: string;
  readonly destinationBranchId?: string;
  readonly destinationWarehouseId?: string;
  readonly effectiveAt: Timestamp;
}

/**
 * Trusted server-only integration for linked financial postings. The caller must
 * enforce its own business permission, original-document and period controls.
 * prepare runs after stock validation and before any writes, on every retry.
 * apply is synchronous, cannot read, and commits in the SAME Firestore transaction.
 * Neither callback runs when an already committed operation is replayed.
 * One invocation still covers one product/lot, not an atomic multi-line document.
 */
export interface InventoryPostingExtension<State> {
  prepare(reader: Pick<Transaction, "get" | "getAll">, context: InventoryPostingContext): Promise<State>;
  apply(writer: Pick<Transaction, "create" | "set" | "update">, state: State, context: InventoryPostingContext): undefined;
}

export interface InventoryGroupExtension<State> {
  prepare(reader: Pick<Transaction, "get" | "getAll">, movements: readonly InventoryPostingContext[]): Promise<State>;
  apply(writer: Pick<Transaction, "create" | "set" | "update">, state: State, movements: readonly InventoryPostingContext[]): undefined;
}

/** Stable semantic fingerprint; optional undefined fields are equivalent to absent fields. */
function postingFingerprint(value: unknown): string {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical)
    : item !== null && typeof item === "object" ? Object.fromEntries(Object.entries(item)
      .filter(([, field]) => field !== undefined).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, field]) => [key, canonical(field)])) : item;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

/**
 * Trusted server-only multi-product posting, sharing the existing stock engine.
 * All stock validation and linked financial reads finish before any writes reach
 * Firestore. Distinct products avoid stale read/modify/write balance projections.
 * Business callables must authorize scope on every request, including retries.
 */
export async function postInventoryTransactionGroup<State>(
  actor: AccessProfile,
  document: { idempotencyKey: string; requestFingerprint: string },
  inputs: readonly PostingRequest[],
  extension: InventoryGroupExtension<State>,
) {
  const groupKey = document.idempotencyKey;
  const serials = inputs.flatMap(input => input.serialNumbers.map(normalizeInventoryIdentifier));
  if (!groupKey || groupKey.includes("/") || groupKey.length > 128 || inputs.length < 1 || inputs.length > 10
    || !/^[a-f0-9]{64}$/.test(document.requestFingerprint)
    || new Set(inputs.map(input => input.productId)).size !== inputs.length
    || new Set(inputs.map(input => input.idempotencyKey)).size !== inputs.length
    || serials.length > 50 || new Set(serials).size !== serials.length)
    throw new HttpsError("invalid-argument", "Use 1–10 distinct products, distinct retry references and at most 50 serials per document.");
  const operation = db.doc(`idempotencyKeys/${actor.organizationId}_inventoryPostGroup_${groupKey}`);
  // Includes the caller's complete commercial payload, not just stock fields.
  const fingerprint = postingFingerprint({ inputs, requestFingerprint: document.requestFingerprint });
  return db.runTransaction(async transaction => {
    const previous = await transaction.get(operation);
    if (previous.exists) {
      if (previous.get("fingerprint") !== fingerprint)
        throw new HttpsError("already-exists", "This document retry reference belongs to different stock instructions.");
      const movements = previous.get("movements") as Array<{ transactionId: string; transactionNumber: string }>;
      return { posted: false, movements };
    }
    const writes: Array<() => unknown> = [];
    const deferred = new Proxy(transaction, {
      get(target, key) {
        if (["create", "set", "update", "delete"].includes(String(key)))
          return (...args: unknown[]) => {
            writes.push(() => Reflect.apply(Reflect.get(target, key), target, args));
            return deferred;
          };
        const member = Reflect.get(target, key);
        return typeof member === "function" ? member.bind(target) : member;
      },
    });
    const contexts: InventoryPostingContext[] = [];
    const movements: Array<{ transactionId: string; transactionNumber: string }> = [];
    for (const [index, input] of inputs.entries()) {
      const result = await executeInventoryPosting(actor, input, {
        async prepare(_reader, context) { contexts.push(context); return undefined; },
        apply() { return undefined; },
      }, { transaction: deferred, sequenceOffset: index });
      if (!result.posted)
        throw new HttpsError("failed-precondition", "A document line was previously posted separately. Reconcile its original reference before continuing.");
      movements.push({ transactionId: result.transactionId, transactionNumber: result.transactionNumber });
    }
    const state = await extension.prepare({ get: transaction.get.bind(transaction), getAll: transaction.getAll.bind(transaction) }, contexts);
    extension.apply({ create: deferred.create.bind(deferred), set: deferred.set.bind(deferred), update: deferred.update.bind(deferred) }, state, contexts);
    deferred.create(operation, { organizationId: actor.organizationId, action: "inventoryPostGroup", fingerprint,
      movements, status: "completed", createdAt: FieldValue.serverTimestamp(), createdBy: actor.userId });
    for (const write of writes) write();
    return { posted: true, movements };
  });
}

function clean(values: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  );
}
function location(snapshot: DocumentSnapshot): LocationRecord {
  return {
    id: snapshot.id,
    ...(snapshot.data() as Omit<LocationRecord, "id">),
  };
}
function readBalance(snapshot: DocumentSnapshot): BalanceState {
  return snapshot.exists
    ? {
        quantity: Number(snapshot.get("onHandQuantity")),
        reserved: Number(snapshot.get("reservedQuantity") ?? 0),
        totalValueMinor: Number(snapshot.get("totalValueMinor") ?? 0),
        averageUnitCostMinor: Number(snapshot.get("averageUnitCostMinor") ?? 0),
        version: Number(snapshot.get("version") ?? 0),
        exists: true,
        createdAt: snapshot.get("createdAt"),
      }
    : {
        quantity: 0,
        reserved: 0,
        totalValueMinor: 0,
        averageUnitCostMinor: 0,
        version: 0,
        exists: false,
      };
}
function validateLocation(
  actor: AccessProfile,
  record: LocationRecord,
  trustedTransfer = false,
) {
  if (
    record.organizationId !== actor.organizationId ||
    record.status !== "active"
  )
    throw new HttpsError(
      "failed-precondition",
      "Inventory location is unavailable.",
    );
  if (!trustedTransfer && record.warehouseId)
    requireWarehouseScope(actor, record.warehouseId);
  if (!trustedTransfer && record.branchId)
    requireBranchScope(actor, record.branchId);
  if (
    !record.warehouseId &&
    !record.branchId &&
    !trustedTransfer &&
    !hasRole(actor, "system_administrator")
  )
    throw new HttpsError(
      "permission-denied",
      "Organization-wide virtual locations require system-administrator authority.",
    );
}
function serialStatus(record: LocationRecord): string {
  if (record.type === "branch") return "at_branch";
  if (record.type === "goods_in_transit") return "in_transit";
  if (record.type === "damaged") return "damaged";
  if (record.type === "quarantined") return "quarantined";
  if (record.type === "returned") return "returned";
  return "available";
}
function writeBalance(
  transaction: Transaction,
  reference: FirebaseFirestore.DocumentReference,
  state: BalanceState,
  product: DocumentSnapshot,
  inventoryLocation: LocationRecord,
  transactionId: string,
  effectiveAt: Timestamp,
  lotId?: string,
) {
  const now = FieldValue.serverTimestamp();
  transaction.set(
    reference,
    clean({
      organizationId: product.get("organizationId"),
      productId: product.id,
      sku: product.get("sku"),
      productName: product.get("name"),
      categoryId: product.get("categoryId"),
      brand: product.get("brand"),
      trackingType: product.get("trackingType"),
      locationId: inventoryLocation.id,
      warehouseId: inventoryLocation.warehouseId,
      branchId: inventoryLocation.branchId,
      lotId,
      onHandQuantity: state.quantity,
      reservedQuantity: state.reserved,
      availableQuantity: state.quantity - state.reserved,
      averageUnitCostMinor: state.averageUnitCostMinor,
      totalValueMinor: state.totalValueMinor,
      currency: "NGN",
      lastTransactionId: transactionId,
      lastMovementAt: effectiveAt,
      version: state.version + 1,
      createdAt: state.exists ? state.createdAt : now,
      updatedAt: now,
    }),
  );
}
function assertInternalBoundary(
  source: LocationRecord,
  destination: LocationRecord,
  trustedTransfer = false,
) {
  if (source.id === destination.id)
    throw new HttpsError(
      "invalid-argument",
      "Source and destination must differ.",
    );
  if (
    !trustedTransfer &&
    (source.branchId || destination.branchId) &&
    source.branchId !== destination.branchId
  )
    throw new HttpsError(
      "failed-precondition",
      "Warehouse-to-branch and cross-branch transfers belong to a later controlled transfer workflow.",
    );
  if (
    !trustedTransfer &&
    source.warehouseId &&
    destination.warehouseId &&
    source.warehouseId !== destination.warehouseId
  )
    throw new HttpsError(
      "failed-precondition",
      "Cross-warehouse transfers belong to a later controlled transfer workflow.",
    );
}

export async function postInventoryTransaction<State = undefined>(
  actor: AccessProfile,
  input: PostingRequest,
  extension?: InventoryPostingExtension<State>,
): Promise<{
  transactionId: string;
  transactionNumber: string;
  posted: boolean;
}> {
  return executeInventoryPosting(actor, input, extension);
}

async function executeInventoryPosting<State = undefined>(
  actor: AccessProfile,
  input: PostingRequest,
  extension?: InventoryPostingExtension<State>,
  group?: { transaction: Transaction; sequenceOffset: number },
): Promise<{ transactionId: string; transactionNumber: string; posted: boolean }> {
  const operation = db
    .collection("idempotencyKeys")
    .doc(`${actor.organizationId}_inventoryPost_${input.idempotencyKey}`);
  const previous = group ? undefined : await operation.get();
  const replay = async (prior: DocumentSnapshot) => {
    if (input.requestFingerprint) {
      if (prior.get("requestFingerprint") && prior.get("requestFingerprint") !== input.requestFingerprint)
        throw new HttpsError("already-exists", "This stock retry reference belongs to different instructions.");
      const original = group ? await group.transaction.get(db.doc(`inventoryTransactions/${prior.get("transactionId")}`)) : await db.doc(`inventoryTransactions/${prior.get("transactionId")}`).get();
      if (!original.exists || original.get("organizationId") !== actor.organizationId)
        throw new HttpsError("not-found", "Original stock posting not found.");
      for (const field of ["sourceBranchId", "destinationBranchId"]) if (original.get(field)) requireBranchScope(actor, String(original.get(field)));
      for (const field of ["sourceWarehouseId", "destinationWarehouseId"]) if (original.get(field)) requireWarehouseScope(actor, String(original.get(field)));
      if (!["sourceBranchId", "destinationBranchId", "sourceWarehouseId", "destinationWarehouseId"].some(field => original.get(field)) && !hasRole(actor, "system_administrator"))
        throw new HttpsError("permission-denied", "Organization-wide stock posting requires administrator authority.");
    }
    return {
      transactionId: String(prior.get("transactionId")),
      transactionNumber: String(prior.get("transactionNumber")),
      posted: false,
    };
  };
  if (previous?.exists) return replay(previous);
  const serials = parseSerialNumbers(input.serialNumbers);
  if (serials.duplicates.length)
    throw new HttpsError(
      "invalid-argument",
      "Duplicate serial numbers were supplied.",
      { duplicates: serials.duplicates },
    );
  const transactionReference = db.collection("inventoryTransactions").doc();
  const counterReference = db
    .collection("inventoryCounters")
    .doc(`${actor.organizationId}_transactions`);
  const productReference = db.collection("products").doc(input.productId);
  const productCostReference = db
    .collection("productCosts")
    .doc(input.productId);
  const sourceLocationReference = input.sourceLocationId
    ? db.collection("inventoryLocations").doc(input.sourceLocationId)
    : undefined;
  const destinationLocationReference = input.destinationLocationId
    ? db.collection("inventoryLocations").doc(input.destinationLocationId)
    : undefined;
  const normalizedLot = input.lot
    ? normalizeInventoryIdentifier(input.lot.lotNumber)
    : undefined;
  const lotId =
    input.lotId ??
    (normalizedLot
      ? uniquenessDocumentId(
          actor.organizationId,
          input.productId,
          normalizedLot,
        )
      : undefined);
  const lotReference = lotId
    ? db.collection("inventoryLots").doc(lotId)
    : undefined;
  const sourceBalanceReference = input.sourceLocationId
    ? db
        .collection("inventoryBalances")
        .doc(
          balanceDocumentId(
            actor.organizationId,
            input.productId,
            input.sourceLocationId,
            lotId,
          ),
        )
    : undefined;
  const destinationBalanceReference = input.destinationLocationId
    ? db
        .collection("inventoryBalances")
        .doc(
          balanceDocumentId(
            actor.organizationId,
            input.productId,
            input.destinationLocationId,
            lotId,
          ),
        )
    : undefined;
  const serialReferences = serials.normalized.map((serial) =>
    db
      .collection("serializedItems")
      .doc(uniquenessDocumentId(actor.organizationId, serial)),
  );
  const effectiveAt = Timestamp.fromDate(new Date(input.effectiveAt));
  const execute = async (transaction: Transaction) => {
    const baseReferences = [
      operation,
      productReference,
      productCostReference,
      counterReference,
      ...(sourceLocationReference ? [sourceLocationReference] : []),
      ...(destinationLocationReference ? [destinationLocationReference] : []),
      ...(sourceBalanceReference ? [sourceBalanceReference] : []),
      ...(destinationBalanceReference ? [destinationBalanceReference] : []),
      ...(lotReference ? [lotReference] : []),
      ...serialReferences,
    ];
    const snapshots = await transaction.getAll(...baseReferences);
    let cursor = 0;
    const operationSnapshot = snapshots[cursor++];
    const product = snapshots[cursor++];
    const productCost = snapshots[cursor++];
    const counter = snapshots[cursor++];
    const sourceLocationSnapshot = sourceLocationReference
      ? snapshots[cursor++]
      : undefined;
    const destinationLocationSnapshot = destinationLocationReference
      ? snapshots[cursor++]
      : undefined;
    const sourceBalanceSnapshot = sourceBalanceReference
      ? snapshots[cursor++]
      : undefined;
    const destinationBalanceSnapshot = destinationBalanceReference
      ? snapshots[cursor++]
      : undefined;
    const lotSnapshot = lotReference ? snapshots[cursor++] : undefined;
    const serialSnapshots = snapshots.slice(cursor);
    if (operationSnapshot?.exists) {
      return replay(operationSnapshot);
    }
    if (
      !product?.exists ||
      product.get("organizationId") !== actor.organizationId ||
      product.get("active") !== true
    )
      throw new HttpsError("failed-precondition", "Product is unavailable.");
    const trackingType = String(product.get("trackingType"));
    if (product.get("itemKind") === "service")
      throw new HttpsError("failed-precondition", "Services cannot be received, counted or moved as physical stock.");
    if (
      trackingType === "serial" &&
      serials.normalized.length !== input.quantity
    )
      throw new HttpsError(
        "invalid-argument",
        "Serialized movement quantity must equal the number of unique serial numbers.",
      );
    if (trackingType !== "serial" && serials.normalized.length)
      throw new HttpsError(
        "invalid-argument",
        "Serial numbers are only valid for serial-tracked products.",
      );
    if (trackingType === "batch" && !lotReference)
      throw new HttpsError(
        "invalid-argument",
        "A lot is required for batch-tracked stock.",
      );
    if (trackingType !== "batch" && lotReference)
      throw new HttpsError(
        "invalid-argument",
        "Lots are only valid for batch-tracked products.",
      );
    const sourceLocation = sourceLocationSnapshot?.exists
      ? location(sourceLocationSnapshot)
      : undefined;
    const destinationLocation = destinationLocationSnapshot?.exists
      ? location(destinationLocationSnapshot)
      : undefined;
    const trustedTransfer =
      Boolean(input.transferContext?.transferId) &&
      [
        "transfer_dispatch",
        "transfer_receipt",
        "discrepancy_resolution",
      ].includes(input.transactionType);
    if (sourceLocation)
      validateLocation(actor, sourceLocation, trustedTransfer);
    if (destinationLocation)
      validateLocation(actor, destinationLocation, trustedTransfer);
    if (sourceLocation && destinationLocation)
      assertInternalBoundary(
        sourceLocation,
        destinationLocation,
        trustedTransfer,
      );
    const source = sourceBalanceSnapshot
      ? readBalance(sourceBalanceSnapshot)
      : undefined;
    const destination = destinationBalanceSnapshot
      ? readBalance(destinationBalanceSnapshot)
      : undefined;
    const serialValues = serialSnapshots.map((snapshot) =>
      snapshot?.exists
        ? {
            snapshot,
            cost: Number(snapshot.get("currentUnitCostMinor")),
            locationId: String(snapshot.get("currentLocationId")),
            status: String(snapshot.get("status")),
            lastTransactionId: String(snapshot.get("lastTransactionId")),
          }
        : undefined,
    );
    const reservedConsumption =
      input.transferContext?.consumeReservedQuantity ?? 0;
    if (sourceLocation) {
      if (
        reservedConsumption < 0 ||
        reservedConsumption > input.quantity ||
        reservedConsumption > (source?.reserved ?? 0)
      )
        throw new HttpsError(
          "failed-precondition",
          "Reserved transfer quantity is inconsistent.",
        );
      if (
        !source ||
        source.quantity - source.reserved + reservedConsumption < input.quantity
      )
        throw new HttpsError(
          "failed-precondition",
          "Insufficient available stock.",
        );
      for (const item of serialValues)
        if (
          !item ||
          item.snapshot.get("organizationId") !== actor.organizationId ||
          item.snapshot.get("productId") !== product.id ||
          item.locationId !== sourceLocation.id ||
          item.snapshot.get("active") === false ||
          Boolean(item.snapshot.get("reservedSaleId")) ||
          item.status === "sold" || item.status === "returned_held" ||
          item.status === "written_off" ||
          item.status === "returned_to_supplier" ||
          (item.status === "reserved" &&
            (!trustedTransfer || item.snapshot.get("reservedTransferId") !==
              input.transferContext?.transferId))
        )
          throw new HttpsError(
            "failed-precondition",
            "A serialized item is unavailable at the source location.",
          );
    } else
      for (const item of serialValues)
        if (item)
          throw new HttpsError(
            "already-exists",
            "A serial number already exists in this organization.",
          );
    if (
      lotSnapshot?.exists &&
      (lotSnapshot.get("organizationId") !== actor.organizationId ||
        lotSnapshot.get("productId") !== product.id)
    )
      throw new HttpsError(
        "failed-precondition",
        "Lot identity conflicts with another product or organization.",
      );
    const nextSequence = Number(counter?.get("value") ?? 0) + 1 + (group?.sequenceOffset ?? 0);
    const transactionNumber = `INV-${effectiveAt.toDate().getUTCFullYear()}-${String(nextSequence).padStart(6, "0")}`;
    let movementValue = 0;
    let movementUnitCost =
      input.unitCostMinor ??
      Number(productCost?.get("defaultUnitCostMinor") ?? 0);
    let nextSource = source;
    let nextDestination = destination;
    if (source) {
      const serialValue =
        trackingType === "serial"
          ? serialValues.reduce((sum, item) => sum + (item?.cost ?? 0), 0)
          : undefined;
      try {
        const issued = issueCost(source, input.quantity, serialValue);
        nextSource = {
          ...source,
          quantity: issued.balance.quantity,
          reserved: source.reserved - reservedConsumption,
          totalValueMinor: issued.balance.totalValueMinor,
          averageUnitCostMinor: issued.balance.averageUnitCostMinor,
        };
        movementValue = issued.movementValueMinor;
        movementUnitCost = issued.unitCostMinor;
      } catch {
        throw new HttpsError(
          "failed-precondition",
          "The movement would create negative stock or value.",
        );
      }
    } else {
      if (movementUnitCost < 0 || !Number.isSafeInteger(movementUnitCost))
        throw new HttpsError(
          "invalid-argument",
          "Unit cost must be a non-negative integer number of minor units.",
        );
      movementValue = input.quantity * movementUnitCost;
    }
    if (destination) {
      const received = receiptCost(
        destination,
        input.quantity,
        movementUnitCost,
      );
      nextDestination = {
        ...destination,
        quantity: received.quantity,
        totalValueMinor: destination.totalValueMinor + movementValue,
        averageUnitCostMinor: Math.round(
          (destination.totalValueMinor + movementValue) / received.quantity,
        ),
      };
    }
    const postingContext: InventoryPostingContext = {
      transactionId: transactionReference.id,
      transactionNumber,
      productId: product.id,
      quantity: input.quantity,
      movementValueMinor: movementValue,
      movementUnitCostMinor: movementUnitCost,
      sourceLocationId: sourceLocation?.id,
      destinationLocationId: destinationLocation?.id,
      sourceBranchId: sourceLocation?.branchId,
      sourceWarehouseId: sourceLocation?.warehouseId,
      destinationBranchId: destinationLocation?.branchId,
      destinationWarehouseId: destinationLocation?.warehouseId,
      effectiveAt,
    };
    const extensionState = extension ? await extension.prepare({
      get: transaction.get.bind(transaction),
      getAll: transaction.getAll.bind(transaction),
    }, postingContext) : undefined;
    const now = FieldValue.serverTimestamp();
    transaction.set(
      counterReference,
      {
        organizationId: actor.organizationId,
        kind: "inventoryTransaction",
        value: nextSequence,
        updatedAt: now,
      },
      { merge: true },
    );
    transaction.create(
      transactionReference,
      clean({
        organizationId: actor.organizationId,
        transactionNumber,
        transactionType: input.transactionType,
        status: "posted",
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        referenceNumber: input.referenceNumber,
        transferId: input.transferContext?.transferId,
        sourceLocationId: sourceLocation?.id,
        destinationLocationId: destinationLocation?.id,
        sourceWarehouseId: sourceLocation?.warehouseId,
        destinationWarehouseId: destinationLocation?.warehouseId,
        sourceBranchId: sourceLocation?.branchId,
        destinationBranchId: destinationLocation?.branchId,
        effectiveAt,
        postedAt: now,
        postedBy: actor.userId,
        reason: input.reason,
        notes: input.notes,
        idempotencyKey: input.idempotencyKey,
        correlationId: input.correlationId,
        createdAt: now,
        createdBy: actor.userId,
      }),
    );
    if (sourceBalanceReference && nextSource)
      writeBalance(
        transaction,
        sourceBalanceReference,
        nextSource,
        product,
        sourceLocation!,
        transactionReference.id,
        effectiveAt,
        lotId,
      );
    if (destinationBalanceReference && nextDestination)
      writeBalance(
        transaction,
        destinationBalanceReference,
        nextDestination,
        product,
        destinationLocation!,
        transactionReference.id,
        effectiveAt,
        lotId,
      );
    const entryBase = {
      organizationId: actor.organizationId,
      transactionId: transactionReference.id,
      transactionNumber,
      transactionType: input.transactionType,
      productId: product.id,
      sku: product.get("sku"),
      productName: product.get("name"),
      categoryId: product.get("categoryId"),
      brand: product.get("brand"),
      trackingType: product.get("trackingType"),
      unitCostMinor: movementUnitCost,
      currency: "NGN",
      lotId,
      effectiveAt,
      postedBy: actor.userId,
      reason: input.reason,
      referenceNumber: input.referenceNumber,
      transferId: input.transferContext?.transferId,
      createdAt: now,
    };
    const createEntry = (values: Record<string, unknown>) => {
      const locationId =
        typeof values.locationId === "string" ? values.locationId : undefined;
      const inventoryLocation =
        locationId === sourceLocation?.id
          ? sourceLocation
          : locationId === destinationLocation?.id
            ? destinationLocation
            : undefined;
      transaction.create(
        db.collection("inventoryEntries").doc(),
        clean({
          ...entryBase,
          ...values,
          warehouseId: inventoryLocation?.warehouseId,
          branchId: inventoryLocation?.branchId,
        }),
      );
    };
    if (trackingType === "serial")
      serialValues.forEach((item, index) => {
        const serial = serials.normalized[index]!;
        const serialReference = serialReferences[index]!;
        const cost = source ? item!.cost : movementUnitCost;
        if (source)
          createEntry({
            locationId: sourceLocation!.id,
            counterpartyLocationId: destinationLocation?.id,
            quantityDelta: -1,
            valueDeltaMinor: -cost,
            serializedItemId: serialReference.id,
            serialNumber: item!.snapshot.get("serialNumber"),
            balanceBefore: source.quantity - index,
            balanceAfter: source.quantity - index - 1,
          });
        else
          createEntry({
            externalAccount: input.externalAccount,
            counterpartyLocationId: destinationLocation!.id,
            quantityDelta: -1,
            valueDeltaMinor: -cost,
            serializedItemId: serialReference.id,
            serialNumber: input.serialNumbers[index],
            balanceBefore: 0,
            balanceAfter: 0,
          });
        if (destination)
          createEntry({
            locationId: destinationLocation!.id,
            counterpartyLocationId: sourceLocation?.id,
            quantityDelta: 1,
            valueDeltaMinor: cost,
            serializedItemId: serialReference.id,
            serialNumber: source
              ? item!.snapshot.get("serialNumber")
              : input.serialNumbers[index],
            balanceBefore: destination.quantity + index,
            balanceAfter: destination.quantity + index + 1,
          });
        else
          createEntry({
            externalAccount: input.externalAccount,
            counterpartyLocationId: sourceLocation!.id,
            quantityDelta: 1,
            valueDeltaMinor: cost,
            serializedItemId: serialReference.id,
            serialNumber: item!.snapshot.get("serialNumber"),
            balanceBefore: 0,
            balanceAfter: 0,
          });
        if (source)
          transaction.update(
            serialReference,
            clean({
              currentLocationId: destinationLocation?.id ?? sourceLocation!.id,
              warehouseId: destinationLocation?.warehouseId,
              branchId: destinationLocation?.branchId,
              status: destinationLocation
                ? serialStatus(destinationLocation)
                : input.transactionType === "supplier_return" ? "returned_to_supplier" : "written_off",
              active: Boolean(destinationLocation),
              currentUnitCostMinor: cost,
              lastTransactionId: transactionReference.id,
              lastMovementAt: effectiveAt,
              updatedAt: now,
              updatedBy: actor.userId,
              reservedTransferId: input.transferContext
                ? FieldValue.delete()
                : undefined,
              reservationId: input.transferContext
                ? FieldValue.delete()
                : undefined,
            }),
          );
        else
          transaction.create(
            serialReference,
            clean({
              organizationId: actor.organizationId,
              productId: product.id,
              sku: product.get("sku"),
              productName: product.get("name"),
              serialNumber: input.serialNumbers[index],
              normalizedSerialNumber: serial,
              currentLocationId: destinationLocation!.id,
              warehouseId: destinationLocation!.warehouseId,
              branchId: destinationLocation!.branchId,
              status: serialStatus(destinationLocation!),
              acquisitionUnitCostMinor: cost,
              currentUnitCostMinor: cost,
              currency: "NGN",
              lastTransactionId: transactionReference.id,
              lastMovementAt: effectiveAt,
              active: true,
              createdAt: now,
              createdBy: actor.userId,
              updatedAt: now,
              updatedBy: actor.userId,
            }),
          );
      });
    else {
      if (source)
        createEntry({
          locationId: sourceLocation!.id,
          counterpartyLocationId: destinationLocation?.id,
          quantityDelta: -input.quantity,
          valueDeltaMinor: -movementValue,
          balanceBefore: source.quantity,
          balanceAfter: nextSource!.quantity,
        });
      else
        createEntry({
          externalAccount: input.externalAccount,
          counterpartyLocationId: destinationLocation!.id,
          quantityDelta: -input.quantity,
          valueDeltaMinor: -movementValue,
          balanceBefore: 0,
          balanceAfter: 0,
        });
      if (destination)
        createEntry({
          locationId: destinationLocation!.id,
          counterpartyLocationId: sourceLocation?.id,
          quantityDelta: input.quantity,
          valueDeltaMinor: movementValue,
          balanceBefore: destination.quantity,
          balanceAfter: nextDestination!.quantity,
        });
      else
        createEntry({
          externalAccount: input.externalAccount,
          counterpartyLocationId: sourceLocation!.id,
          quantityDelta: input.quantity,
          valueDeltaMinor: movementValue,
          balanceBefore: 0,
          balanceAfter: 0,
        });
    }
    if (lotReference) {
      const locations = {
        ...(lotSnapshot?.get("locationQuantities") as
          Record<string, number> | undefined),
      };
      if (sourceLocation)
        locations[sourceLocation.id] =
          Number(locations[sourceLocation.id] ?? 0) - input.quantity;
      if (destinationLocation)
        locations[destinationLocation.id] =
          Number(locations[destinationLocation.id] ?? 0) + input.quantity;
      if (Object.values(locations).some((value) => value < 0))
        throw new HttpsError(
          "failed-precondition",
          "Lot quantity cannot become negative.",
        );
      const remaining = Object.values(locations).reduce(
        (sum, value) => sum + value,
        0,
      );
      const received =
        Number(lotSnapshot?.get("quantityReceived") ?? 0) +
        (sourceLocation ? 0 : input.quantity);
      transaction.set(
        lotReference,
        clean({
          organizationId: actor.organizationId,
          productId: product.id,
          sku: product.get("sku"),
          lotNumber: input.lot?.lotNumber ?? lotSnapshot?.get("lotNumber"),
          normalizedLotNumber:
            normalizedLot ?? lotSnapshot?.get("normalizedLotNumber"),
          quantityReceived: received,
          remainingQuantity: remaining,
          locationQuantities: locations,
          unitCostMinor: movementUnitCost,
          receiptDate: input.effectiveAt.slice(0, 10),
          manufacturingDate:
            input.lot?.manufacturingDate ??
            lotSnapshot?.get("manufacturingDate"),
          expiryDate: input.lot?.expiryDate ?? lotSnapshot?.get("expiryDate"),
          supplierReference:
            input.lot?.supplierReference ??
            lotSnapshot?.get("supplierReference"),
          status: "active",
          lastTransactionId: transactionReference.id,
          createdAt: lotSnapshot?.exists ? lotSnapshot.get("createdAt") : now,
          createdBy: lotSnapshot?.exists
            ? lotSnapshot.get("createdBy")
            : actor.userId,
          updatedAt: now,
          updatedBy: actor.userId,
        }),
      );
    }
    transaction.update(productReference, {
      hasLedgerActivity: true,
      updatedAt: now,
      updatedBy: actor.userId,
    });
    if (extension) extension.apply({
      create: transaction.create.bind(transaction),
      set: transaction.set.bind(transaction),
      update: transaction.update.bind(transaction),
    }, extensionState as State, postingContext);
    transaction.create(operation, {
      organizationId: actor.organizationId,
      action: "inventoryPost",
      ...(input.requestFingerprint ? { requestFingerprint: input.requestFingerprint } : {}),
      transactionId: transactionReference.id,
      transactionNumber,
      status: "completed",
      createdAt: now,
      createdBy: actor.userId,
    });
    writeAuditLog(transaction, actor, {
      action: `inventory.${input.transactionType}`,
      entityType: "inventoryTransaction",
      entityId: transactionReference.id,
      correlationId: input.correlationId,
      sourceFunction: input.sourceFunction,
      reason: input.reason,
      after: {
        transactionNumber,
        productId: product.id,
        sourceLocationId: input.sourceLocationId ?? null,
        destinationLocationId: input.destinationLocationId ?? null,
        quantity: input.quantity,
      },
    });
    return {
      transactionId: transactionReference.id,
      transactionNumber,
      posted: true,
    };
  };
  return group ? execute(group.transaction) : db.runTransaction(execute);
}
