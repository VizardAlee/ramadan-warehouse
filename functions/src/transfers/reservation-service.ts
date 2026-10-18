import { FieldValue, type DocumentSnapshot, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import type { AccessProfile } from "../auth/authorize.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { balanceDocumentId } from "../inventory/calculations.js";
import { addLots, exactLots, remainingLots } from "./reservation-ownership.js";
import { assertNoStockExecution, stockReview } from "./stock-execution.js";

export interface ReservationLine {
  transferItemId: string;
  productId: string;
  quantity: number;
  serialItemIds: readonly string[];
  lotAllocations: readonly { lotId: string; quantity: number }[];
}
const number = (snapshot: DocumentSnapshot, field: string) =>
  Number(snapshot.get(field) ?? 0);

export async function reserveTransferStockService(
  actor: AccessProfile,
  transferId: string,
  lines: readonly ReservationLine[],
  idempotencyKey: string,
  correlationId: string,
) {
  const operation = db.doc(
    `idempotencyKeys/${actor.organizationId}_reserveTransfer_${idempotencyKey}`,
  );
  const transferRef = db.doc(`transfers/${transferId}`);
  return db.runTransaction(async (transaction) => {
    const transfer = await transaction.get(transferRef);
    if (
      !transfer.exists ||
      transfer.get("organizationId") !== actor.organizationId
    )
      throw new HttpsError("not-found", "Transfer not found.");
    if (
      !["approved", "partially_reserved"].includes(
        String(transfer.get("status")),
      )
    )
      throw new HttpsError(
        "failed-precondition",
        "Only approved transfers can reserve stock.",
      );
    assertNoStockExecution(transfer);
    if (new Set(lines.map(line => line.transferItemId)).size !== lines.length || new Set(lines.flatMap(line => line.serialItemIds)).size !== lines.flatMap(line => line.serialItemIds).length)
      stockReview("Reservation item and serial identities must be distinct.");
    for (const line of lines) exactLots(line.lotAllocations);
    const itemRefs = lines.map((line) =>
      db.doc(`transferItems/${line.transferItemId}`),
    );
    const balanceGroups = lines.map((line) =>
      line.lotAllocations.length
        ? line.lotAllocations.map((allocation) => ({
            quantity: allocation.quantity,
            ref: db.doc(
              `inventoryBalances/${balanceDocumentId(actor.organizationId, line.productId, String(transfer.get("originLocationId")), allocation.lotId)}`,
            ),
          }))
        : [{
            quantity: line.quantity,
            ref: db.doc(
              `inventoryBalances/${balanceDocumentId(actor.organizationId, line.productId, String(transfer.get("originLocationId")))}`,
            ),
          }],
    );
    const balanceRefs = balanceGroups.flatMap((group) =>
      group.map(({ ref }) => ref),
    );
    const reservationRefs = lines.map((line) =>
      db.doc(`stockReservations/${transferId}__${line.transferItemId}`),
    );
    const serialRefs = lines.flatMap((line) =>
      line.serialItemIds.map((serialId) =>
        db.doc(`serializedItems/${serialId}`),
      ),
    );
    const snapshots = await transaction.getAll(
      operation,
      ...itemRefs,
      ...balanceRefs,
      ...reservationRefs,
      ...serialRefs,
    );
    let cursor = 0;
    if (snapshots[cursor++]!.exists) return { transferId, reserved: false };
    const items = snapshots.slice(cursor, (cursor += itemRefs.length));
    const balances = snapshots.slice(cursor, (cursor += balanceRefs.length));
    const reservations = snapshots.slice(
      cursor,
      (cursor += reservationRefs.length),
    );
    const serials = snapshots.slice(cursor);
    let serialCursor = 0;
    let balanceCursor = 0;
    let added = 0;
    const now = FieldValue.serverTimestamp();
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]!;
      const item = items[index]!;
      const lineBalances = balances.slice(
        balanceCursor,
        (balanceCursor += balanceGroups[index]!.length),
      );
      const existing = reservations[index]!;
      if (
        !item.exists ||
        item.get("transferId") !== transferId ||
        item.get("organizationId") !== actor.organizationId ||
        item.get("productId") !== line.productId
      )
        throw new HttpsError(
          "failed-precondition",
          "Transfer item is invalid.",
        );
      if (
        !Number.isSafeInteger(line.quantity) ||
        line.quantity <= 0 ||
        number(item, "reservedQuantity") + line.quantity >
          number(item, "approvedQuantity")
      )
        throw new HttpsError(
          "failed-precondition",
          "Reservation exceeds approved outstanding quantity.",
        );
      for (let balanceIndex = 0; balanceIndex < lineBalances.length; balanceIndex++) {
        const balance = lineBalances[balanceIndex]!;
        const requested = balanceGroups[index]![balanceIndex]!.quantity;
        if (
          !balance.exists ||
          balance.get("organizationId") !== actor.organizationId ||
          balance.get("locationId") !== transfer.get("originLocationId") ||
          !["onHandQuantity", "reservedQuantity"].every(field => Number.isSafeInteger(number(balance, field)) && number(balance, field) >= 0) ||
          number(balance, "reservedQuantity") > number(balance, "onHandQuantity")
        )
          throw new HttpsError(
            "failed-precondition",
            "Source inventory balance is unavailable.",
          );
        if (number(balance, "onHandQuantity") - number(balance, "reservedQuantity") < requested)
          throw new HttpsError(
            "failed-precondition",
            "Insufficient available stock for the selected lot.",
          );
      }
      const trackingType = String(item.get("trackingType"));
      if (trackingType !== "batch" && line.lotAllocations.length)
        stockReview("Only batch-tracked stock can use lot reservations.");
      if (trackingType !== "serial" && line.serialItemIds.length)
        stockReview("Only serial-tracked stock can use serial reservations.");
      if (
        trackingType === "serial" &&
        line.serialItemIds.length !== line.quantity
      )
        throw new HttpsError(
          "invalid-argument",
          "Every serialized unit requires an exact serial allocation.",
        );
      if (
        trackingType === "batch" &&
        line.lotAllocations.reduce((sum, lot) => sum + lot.quantity, 0) !==
          line.quantity
      )
        throw new HttpsError(
          "invalid-argument",
          "Lot allocations must equal the reservation quantity.",
        );
      for (const serialId of line.serialItemIds) {
        const serial = serials[serialCursor++]!;
        if (
          !serial.exists ||
          serial.id !== serialId ||
          serial.get("organizationId") !== actor.organizationId ||
          serial.get("productId") !== line.productId ||
          serial.get("currentLocationId") !==
            transfer.get("originLocationId") ||
          serial.get("status") !== "available" ||
          serial.get("reservedTransferId")
        )
          throw new HttpsError(
            "failed-precondition",
            "A serialized item is not available for this reservation.",
          );
        transaction.update(serial.ref, {
          status: "reserved",
          reservedTransferId: transferId,
          reservationId: reservationRefs[index]!.id,
          updatedAt: now,
          updatedBy: actor.userId,
        });
      }
      const previousQuantity = existing.exists
        ? number(existing, "quantity")
        : 0;
      transaction.set(
        reservationRefs[index]!,
        {
          organizationId: actor.organizationId,
          transferId,
          transferItemId: line.transferItemId,
          productId: line.productId,
          sku: item.get("sku"),
          sourceLocationId: transfer.get("originLocationId"),
          quantity: previousQuantity + line.quantity,
          releasedQuantity: existing.exists
            ? number(existing, "releasedQuantity")
            : 0,
          consumedQuantity: existing.exists
            ? number(existing, "consumedQuantity")
            : 0,
          remainingQuantity:
            (existing.exists ? number(existing, "remainingQuantity") : 0) +
            line.quantity,
          serialItemIds: line.serialItemIds.length
            ? FieldValue.arrayUnion(...line.serialItemIds)
            : existing.exists
              ? ((existing.get("serialItemIds") as string[] | undefined) ?? [])
              : [],
          lotAllocations: addLots((existing.get("lotAllocations") ?? []) as { lotId: string; quantity: number }[], line.lotAllocations),
          remainingLotAllocations: addLots(existing.exists ? remainingLots(existing) : [], line.lotAllocations),
          allocationVersion: 2,
          status: "active",
          createdAt: existing.exists ? existing.get("createdAt") : now,
          createdBy: existing.exists ? existing.get("createdBy") : actor.userId,
          updatedAt: now,
        },
        { merge: true },
      );
      for (let balanceIndex = 0; balanceIndex < lineBalances.length; balanceIndex++) {
        const balance = lineBalances[balanceIndex]!;
        const requested = balanceGroups[index]![balanceIndex]!.quantity;
        const reserved = number(balance, "reservedQuantity") + requested;
        transaction.update(balance.ref, {
          reservedQuantity: reserved,
          availableQuantity: number(balance, "onHandQuantity") - reserved,
          version: number(balance, "version") + 1,
          updatedAt: now,
        });
      }
      transaction.update(item.ref, {
        reservedQuantity: number(item, "reservedQuantity") + line.quantity,
        itemStatus:
          number(item, "reservedQuantity") + line.quantity ===
          number(item, "approvedQuantity")
            ? "reserved"
            : "partially_reserved",
        updatedAt: now,
      });
      added += line.quantity;
    }
    const nextReserved = number(transfer, "totalReservedQuantity") + added;
    transaction.update(transferRef, {
      totalReservedQuantity: nextReserved,
      status:
        nextReserved === number(transfer, "totalApprovedQuantity")
          ? "reserved"
          : "partially_reserved",
      updatedAt: now,
      updatedBy: actor.userId,
    });
    const event = db.collection("transferEvents").doc();
    transaction.create(event, {
      organizationId: actor.organizationId,
      transferId,
      originWarehouseId: transfer.get("originWarehouseId"),
      destinationBranchId: transfer.get("destinationBranchId"),
      eventType: "reserved",
      actorUserId: actor.userId,
      actorRoleId: actor.roleId,
      quantity: added,
      correlationId,
      createdAt: now,
    });
    transaction.create(operation, {
      organizationId: actor.organizationId,
      action: "reserveTransfer",
      entityId: transferId,
      result: { transferId, reserved: true, quantity: added },
      status: "completed",
      createdAt: now,
      createdBy: actor.userId,
    });
    writeAuditLog(transaction, actor, {
      action: "transfer.reserved",
      entityType: "transfer",
      entityId: transferId,
      correlationId,
      sourceFunction: "reserveTransferStock",
      after: { quantity: added },
    });
    return { transferId, reserved: true, quantity: added };
  });
}

export async function prepareTransferReservationRelease(
  transaction: Transaction,
  actor: AccessProfile,
  transfer: DocumentSnapshot,
  reservationIds: readonly string[] | undefined,
  correlationId: string,
) {
    const transferId = transfer.id;
    const transferRef = transfer.ref;
    assertNoStockExecution(transfer);
    const query = db
      .collection("stockReservations")
      .where("transferId", "==", transferId);
    const found = await transaction.get(query);
    const selected = found.docs.filter(
      (doc) => !reservationIds || reservationIds.includes(doc.id),
    );
    if (!selected.length) return { released: 0, apply: () => {} };
    if (selected.some(doc => doc.get("organizationId") !== actor.organizationId || doc.get("sourceLocationId") !== transfer.get("originLocationId")
      || !Number.isSafeInteger(number(doc, "remainingQuantity")) || number(doc, "remainingQuantity") < 0))
      stockReview("Reservation ownership or remaining quantity is inconsistent.");
    const itemRefs = selected.map((doc) =>
      db.doc(`transferItems/${String(doc.get("transferItemId"))}`),
    );
    const balanceGroups = selected.map((doc) => {
      const allocations = remainingLots(doc);
      return allocations.length
        ? allocations
            .map((allocation) => {
              const quantity = allocation.quantity;
              return {
                quantity,
                ref: db.doc(
                  `inventoryBalances/${balanceDocumentId(actor.organizationId, String(doc.get("productId")), String(doc.get("sourceLocationId")), allocation.lotId)}`,
                ),
              };
            })
            .filter(({ quantity }) => quantity > 0)
        : [{
            quantity: number(doc, "remainingQuantity"),
            ref: db.doc(
              `inventoryBalances/${balanceDocumentId(actor.organizationId, String(doc.get("productId")), String(doc.get("sourceLocationId")))}`,
            ),
          }];
    });
    const balanceRefs = balanceGroups.flatMap((group) =>
      group.map(({ ref }) => ref),
    );
    const serialRefs = selected.flatMap((doc) =>
      ((doc.get("serialItemIds") as string[] | undefined) ?? []).map((id) =>
        db.doc(`serializedItems/${id}`),
      ),
    );
    const snapshots = await transaction.getAll(
      ...itemRefs,
      ...balanceRefs,
      ...serialRefs,
    );
    let cursor = 0;
    const items = snapshots.slice(cursor, (cursor += itemRefs.length));
    const balances = snapshots.slice(cursor, (cursor += balanceRefs.length));
    const serials = snapshots.slice(cursor);
    let serialCursor = 0;
    let balanceCursor = 0;
    let released = 0;
    const writes: Array<() => unknown> = [];
    const writer = new Proxy(transaction, { get(target, key) {
      if (["update", "create"].includes(String(key))) return (...args: unknown[]) => { writes.push(() => Reflect.apply(Reflect.get(target, key), target, args)); return writer; };
      const member = Reflect.get(target, key); return typeof member === "function" ? member.bind(target) : member;
    } });
    const now = FieldValue.serverTimestamp();
    for (let index = 0; index < selected.length; index++) {
      const reservation = selected[index]!;
      const quantity = number(reservation, "remainingQuantity");
      const item = items[index]!;
      if (!item.exists || item.get("organizationId") !== actor.organizationId || item.get("transferId") !== transferId || item.get("productId") !== reservation.get("productId"))
        stockReview("Reservation item ownership is inconsistent.");
      const lineBalances = balances.slice(
        balanceCursor,
        (balanceCursor += balanceGroups[index]!.length),
      );
      if (quantity <= 0) { serialCursor += ((reservation.get("serialItemIds") as string[] | undefined) ?? []).length; continue; }
      for (let balanceIndex = 0; balanceIndex < lineBalances.length; balanceIndex++) {
        const balance = lineBalances[balanceIndex]!;
        const reservedForBalance = balanceGroups[index]![balanceIndex]!.quantity;
        if (!balance.exists || balance.get("organizationId") !== actor.organizationId || balance.get("productId") !== reservation.get("productId") || balance.get("locationId") !== reservation.get("sourceLocationId")
          || !["onHandQuantity", "reservedQuantity"].every(field => Number.isSafeInteger(number(balance, field)) && number(balance, field) >= 0)
          || number(balance, "reservedQuantity") > number(balance, "onHandQuantity") || number(balance, "reservedQuantity") < reservedForBalance)
          throw new HttpsError(
            "failed-precondition",
            "Reservation projection is inconsistent.",
          );
      }
      for (const serialId of (reservation.get("serialItemIds") as
        string[] | undefined) ?? []) {
        const serial = serials[serialCursor++]!;
        if (serial.id !== serialId)
          throw new HttpsError(
            "failed-precondition",
            "Reserved serial projection is inconsistent.",
          );
        if (serial.exists && serial.get("reservationId") === reservation.id)
          writer.update(serial.ref, {
            status: "available",
            reservedTransferId: FieldValue.delete(),
            reservationId: FieldValue.delete(),
            updatedAt: now,
            updatedBy: actor.userId,
          });
      }
      for (let balanceIndex = 0; balanceIndex < lineBalances.length; balanceIndex++) {
        const balance = lineBalances[balanceIndex]!;
        const reservedForBalance = balanceGroups[index]![balanceIndex]!.quantity;
        const nextReserved = number(balance, "reservedQuantity") - reservedForBalance;
        writer.update(balance.ref, {
          reservedQuantity: nextReserved,
          availableQuantity: number(balance, "onHandQuantity") - nextReserved,
          version: number(balance, "version") + 1,
          updatedAt: now,
        });
      }
      writer.update(item.ref, {
        reservedQuantity: Math.max(
          0,
          number(item, "reservedQuantity") - quantity,
        ),
        itemStatus: "approved",
        updatedAt: now,
      });
      writer.update(reservation.ref, {
        releasedQuantity: number(reservation, "releasedQuantity") + quantity,
        remainingQuantity: 0,
        status: "released",
        remainingLotAllocations: [],
        allocationVersion: 2,
        updatedAt: now,
      });
      released += quantity;
    }
    if (!released) return { released: 0, apply: () => {} };
    writer.update(transferRef, {
      totalReservedQuantity: Math.max(
        0,
        number(transfer, "totalReservedQuantity") - released,
      ),
      status: number(transfer, "totalDispatchedQuantity") > 0 ? transfer.get("status") : "approved",
      updatedAt: now,
      updatedBy: actor.userId,
    });
    writer.create(db.collection("transferEvents").doc(), {
      organizationId: actor.organizationId,
      transferId,
      originWarehouseId: transfer.get("originWarehouseId"),
      destinationBranchId: transfer.get("destinationBranchId"),
      eventType: "reservation_released",
      quantity: released,
      actorUserId: actor.userId,
      actorRoleId: actor.roleId,
      correlationId,
      createdAt: now,
    });
    writeAuditLog(writer, actor, {
      action: "transfer.reservation_released",
      entityType: "transfer",
      entityId: transferId,
      correlationId,
      sourceFunction: "releaseTransferReservation",
      after: { quantity: released },
    });
    return { released, apply: () => { for (const write of writes) write(); } };
}

export async function releaseTransferReservationService(
  actor: AccessProfile, transferId: string, reservationIds: readonly string[] | undefined,
  idempotencyKey: string, correlationId: string, expectedVersion?: number,
) {
  const operation = db.doc(`idempotencyKeys/${actor.organizationId}_releaseTransfer_${idempotencyKey}`);
  const transferRef = db.doc(`transfers/${transferId}`);
  return db.runTransaction(async transaction => {
    const [op, transfer] = await transaction.getAll(operation, transferRef);
    if (op!.exists) return { transferId, released: false };
    if (!transfer!.exists || transfer!.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Transfer not found.");
    if (expectedVersion !== undefined && Number(transfer!.get("version")) !== expectedVersion) throw new HttpsError("aborted", "The transfer version changed.");
    const release = await prepareTransferReservationRelease(transaction, actor, transfer!, reservationIds, correlationId);
    release.apply();
    transaction.create(operation, { organizationId: actor.organizationId, action: "releaseTransferReservation", entityId: transferId, result: { transferId, released: true, quantity: release.released }, status: "completed", createdAt: FieldValue.serverTimestamp(), createdBy: actor.userId });
    return { transferId, released: true, quantity: release.released };
  });
}
