import {
  FieldValue,
  Timestamp,
  type DocumentSnapshot,
  type Transaction,
} from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
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

export async function postInventoryTransaction(
  actor: AccessProfile,
  input: PostingRequest,
): Promise<{
  transactionId: string;
  transactionNumber: string;
  posted: boolean;
}> {
  const operation = db
    .collection("idempotencyKeys")
    .doc(`${actor.organizationId}_inventoryPost_${input.idempotencyKey}`);
  const previous = await operation.get();
  if (previous.exists)
    return {
      transactionId: previous.get("transactionId") as string,
      transactionNumber: previous.get("transactionNumber") as string,
      posted: false,
    };
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
  let transactionNumber = "";
  await db.runTransaction(async (transaction) => {
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
      transactionNumber = String(operationSnapshot.get("transactionNumber"));
      return;
    }
    if (
      !product?.exists ||
      product.get("organizationId") !== actor.organizationId ||
      product.get("active") !== true
    )
      throw new HttpsError("failed-precondition", "Product is unavailable.");
    const trackingType = String(product.get("trackingType"));
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
          item.status === "written_off" ||
          (item.status === "reserved" &&
            item.snapshot.get("reservedTransferId") !==
              input.transferContext?.transferId)
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
    const nextSequence = Number(counter?.get("value") ?? 0) + 1;
    transactionNumber = `INV-${effectiveAt.toDate().getUTCFullYear()}-${String(nextSequence).padStart(6, "0")}`;
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
                : "written_off",
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
    transaction.create(operation, {
      organizationId: actor.organizationId,
      action: "inventoryPost",
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
  });
  return {
    transactionId: transactionReference.id,
    transactionNumber,
    posted: true,
  };
}
