import { FieldValue, type DocumentSnapshot, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import { normalizeInventoryIdentifier, uniquenessDocumentId } from "../inventory/calculations.js";

export interface SerialSelection {
  productId: string; trackingType: string; quantity: number; serialNumbers?: readonly string[];
  saleItemId?: string;
}
export type SerialAction = "reserve" | "sell" | "collect" | "cancel" | "return";

/** Read and validate every physical unit inside the caller's stock/accounting transaction. */
export async function readSaleSerials(tx: Transaction, scope: { organizationId: string; locationId: string; saleId: string }, lines: readonly SerialSelection[], action: SerialAction) {
  const normalized = lines.map(line => (line.serialNumbers ?? []).map(normalizeInventoryIdentifier));
  const all = normalized.flat();
  if (all.length > 50 || all.some(value => !value || value.length > 160) || new Set(all).size !== all.length)
    throw new HttpsError("invalid-argument", "Use each serial once, with at most 50 serialized units per submission.");
  lines.forEach((line, index) => {
    if (line.trackingType === "serial" ? normalized[index]!.length !== line.quantity : normalized[index]!.length !== 0)
      throw new HttpsError("invalid-argument", "Enter one unique serial number for each serialized unit, and none for quantity-tracked goods.");
  });
  const refs = all.map(serial => db.doc(`serializedItems/${uniquenessDocumentId(scope.organizationId, serial)}`));
  const snapshots = refs.length ? await tx.getAll(...refs) : [];
  let cursor = 0;
  return lines.map((line, index) => normalized[index]!.map(() => {
    const serial = snapshots[cursor++]!;
    const available = ["available", "at_branch"].includes(serial.get("status")) && serial.get("active") === true && !serial.get("reservedTransferId") && !serial.get("reservedSaleId");
    const reserved = serial.get("status") === "reserved" && serial.get("active") === true && serial.get("reservedSaleId") === scope.saleId && serial.get("reservedSaleItemId") === line.saleItemId && !serial.get("reservedTransferId");
    const sold = serial.get("status") === "sold" && serial.get("active") === false && serial.get("saleId") === scope.saleId && serial.get("saleItemId") === line.saleItemId;
    const cost = Number(serial.get("currentUnitCostMinor"));
    if (!serial.exists || serial.get("organizationId") !== scope.organizationId || serial.get("productId") !== line.productId || !Number.isSafeInteger(cost) || cost < 0 ||
      (action === "return" ? !sold : serial.get("currentLocationId") !== scope.locationId || (action === "collect" || action === "cancel" ? !reserved : !available)))
      throw new HttpsError("failed-precondition", "A serial is unavailable, belongs to another sale/location, or was already collected, cancelled or returned. Review the exact units.");
    return serial;
  }));
}

export const serialCost = (serials: readonly DocumentSnapshot[]) => serials.reduce((sum, serial) => sum + Number(serial.get("currentUnitCostMinor")), 0);

/** Never call outside the same transaction that posts the operational ledger and journal. */
export function changeSaleSerials(tx: Transaction, serials: readonly DocumentSnapshot[], action: SerialAction, context: {
  saleId: string; saleItemId: string; locationId: string; branchId: string; userId: string;
  movementId?: string; collectionId?: string; returnId?: string; resellable?: boolean;
}) {
  for (const serial of serials) {
    const reserve = action === "reserve", available = action === "cancel" || (action === "return" && context.resellable);
    tx.update(serial.ref, {
      status: reserve ? "reserved" : available ? "at_branch" : action === "return" ? "returned_held" : "sold",
      active: Boolean(reserve || available), currentLocationId: reserve || available ? context.locationId : null,
      branchId: context.branchId,
      reservedSaleId: reserve ? context.saleId : FieldValue.delete(),
      reservedSaleItemId: reserve ? context.saleItemId : FieldValue.delete(),
      saleId: available ? FieldValue.delete() : context.saleId,
      saleItemId: available ? FieldValue.delete() : context.saleItemId,
      ...(context.collectionId ? { lastCollectionId: context.collectionId } : {}),
      ...(context.returnId ? { lastSaleReturnId: context.returnId } : {}),
      ...(context.movementId ? { lastTransactionId: context.movementId } : {}), lastMovementAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(), updatedBy: context.userId,
    });
  }
}

export function writeSaleSerialEntries(tx: Transaction, serials: readonly DocumentSnapshot[], base: Record<string, unknown>, options: {
  locationId: string; branchId: string; balanceBefore: number; direction: -1 | 0 | 1;
  reservedDirection?: -1 | 1; externalAccount?: string;
}) {
  serials.forEach((serial, index) => {
    const value = Number(serial.get("currentUnitCostMinor")) * options.direction;
    const entry = { ...base, trackingType: "serial", serializedItemId: serial.id, serialNumber: serial.get("serialNumber"), unitCostMinor: Number(serial.get("currentUnitCostMinor")) };
    tx.create(db.collection("inventoryEntries").doc(), { ...entry, locationId: options.locationId, branchId: options.branchId,
      quantityDelta: options.direction, valueDeltaMinor: value,
      ...(options.reservedDirection ? { reservedQuantityDelta: options.reservedDirection } : {}),
      balanceBefore: options.balanceBefore + index * options.direction,
      balanceAfter: options.balanceBefore + (index + 1) * options.direction });
    if (options.externalAccount) tx.create(db.collection("inventoryEntries").doc(), { ...entry, externalAccount: options.externalAccount,
      counterpartyLocationId: options.locationId, quantityDelta: -options.direction, valueDeltaMinor: -value, balanceBefore: 0, balanceAfter: 0 });
  });
}
