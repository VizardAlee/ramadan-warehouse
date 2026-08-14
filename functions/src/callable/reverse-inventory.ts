import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import {
  hasRole,
  requireAccess,
  requireBranchScope,
  requirePermission,
  requireWarehouseScope,
} from "../auth/authorize.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { enforceAppCheck } from "../config.js";
import { balanceDocumentId } from "../inventory/calculations.js";
import { correlationId, parseInput } from "../utils/callable.js";
import { reversalInput } from "../validation/inventory.js";

function clean(values: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  );
}
function statusForLocation(type: string) {
  return type === "branch"
    ? "at_branch"
    : type === "goods_in_transit"
      ? "in_transit"
      : type === "damaged"
        ? "damaged"
        : type === "quarantined"
          ? "quarantined"
          : type === "returned"
            ? "returned"
            : "available";
}

export const reverseInventoryTransaction = onCall(
  { enforceAppCheck, timeoutSeconds: 60 },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "inventory.reverse");
    const input = parseInput(reversalInput, request.data);
    const requestId = correlationId();
    const operation = db
      .collection("idempotencyKeys")
      .doc(`${actor.organizationId}_inventoryReverse_${input.idempotencyKey}`);
    const prior = await operation.get();
    if (prior.exists)
      return {
        transactionId: prior.get("transactionId") as string,
        transactionNumber: prior.get("transactionNumber") as string,
        reversed: false,
      };
    const originalReference = db
      .collection("inventoryTransactions")
      .doc(input.transactionId);
    const entryQuery = db
      .collection("inventoryEntries")
      .where("transactionId", "==", input.transactionId);
    const entrySnapshot = await entryQuery.get();
    if (entrySnapshot.empty)
      throw new HttpsError(
        "not-found",
        "Inventory transaction entries were not found.",
      );
    const reversalReference = db.collection("inventoryTransactions").doc();
    const reversalLock = db
      .collection("inventoryReversals")
      .doc(input.transactionId);
    const counterReference = db
      .collection("inventoryCounters")
      .doc(`${actor.organizationId}_transactions`);
    const locationEntries = entrySnapshot.docs.filter(
      (entry) => typeof entry.get("locationId") === "string",
    );
    const balanceReferences = [
      ...new Map(
        locationEntries.map((entry) => {
          const id = balanceDocumentId(
            actor.organizationId,
            String(entry.get("productId")),
            String(entry.get("locationId")),
            typeof entry.get("lotId") === "string"
              ? String(entry.get("lotId"))
              : undefined,
          );
          return [id, db.collection("inventoryBalances").doc(id)];
        }),
      ).values(),
    ];
    const serialReferences = [
      ...new Map(
        entrySnapshot.docs
          .filter((entry) => typeof entry.get("serializedItemId") === "string")
          .map((entry) => {
            const id = String(entry.get("serializedItemId"));
            return [id, db.collection("serializedItems").doc(id)];
          }),
      ).values(),
    ];
    const lotReferences = [
      ...new Map(
        entrySnapshot.docs
          .filter((entry) => typeof entry.get("lotId") === "string")
          .map((entry) => {
            const id = String(entry.get("lotId"));
            return [id, db.collection("inventoryLots").doc(id)];
          }),
      ).values(),
    ];
    const locationReferences = [
      ...new Map(
        locationEntries.map((entry) => {
          const id = String(entry.get("locationId"));
          return [id, db.collection("inventoryLocations").doc(id)];
        }),
      ).values(),
    ];
    let transactionNumber = "";
    await db.runTransaction(async (transaction) => {
      const [original, lock, previousOperation, counter, ...dependent] =
        await transaction.getAll(
          originalReference,
          reversalLock,
          operation,
          counterReference,
          ...balanceReferences,
          ...serialReferences,
          ...lotReferences,
          ...locationReferences,
        );
      if (previousOperation?.exists) {
        transactionNumber = String(previousOperation.get("transactionNumber"));
        return;
      }
      if (
        !original?.exists ||
        original.get("organizationId") !== actor.organizationId
      )
        throw new HttpsError(
          "not-found",
          "Inventory transaction was not found.",
        );
      const scopedIds = [
        ["sourceWarehouseId", requireWarehouseScope] as const,
        ["destinationWarehouseId", requireWarehouseScope] as const,
        ["sourceBranchId", requireBranchScope] as const,
        ["destinationBranchId", requireBranchScope] as const,
      ];
      let hasOwnedLocation = false;
      for (const [field, scope] of scopedIds) {
        const id = original.get(field);
        if (typeof id === "string") {
          hasOwnedLocation = true;
          scope(actor, id);
        }
      }
      if (!hasOwnedLocation && !hasRole(actor, "system_administrator"))
        throw new HttpsError(
          "permission-denied",
          "Organization-wide transaction reversal requires system-administrator authority.",
        );
      if (original.get("transactionType") === "reversal")
        throw new HttpsError(
          "failed-precondition",
          "A reversal transaction cannot be reversed directly.",
        );
      if (lock?.exists)
        throw new HttpsError(
          "already-exists",
          "This inventory transaction has already been reversed.",
        );
      let cursor = 0;
      const balances = dependent.slice(
        cursor,
        (cursor += balanceReferences.length),
      );
      const serials = dependent.slice(
        cursor,
        (cursor += serialReferences.length),
      );
      const lots = dependent.slice(cursor, (cursor += lotReferences.length));
      const locations = dependent.slice(
        cursor,
        cursor + locationReferences.length,
      );
      const balanceById = new Map(
        balances.map((snapshot) => [snapshot.id, snapshot]),
      );
      const locationById = new Map(
        locations.map((snapshot) => [snapshot.id, snapshot]),
      );
      for (const balance of balances)
        if (
          !balance.exists ||
          balance.get("lastTransactionId") !== input.transactionId
        )
          throw new HttpsError(
            "failed-precondition",
            "The transaction has dependent later movements and cannot be safely reversed.",
          );
      for (const serial of serials)
        if (
          !serial.exists ||
          serial.get("lastTransactionId") !== input.transactionId
        )
          throw new HttpsError(
            "failed-precondition",
            "A serialized item has moved since this transaction.",
          );
      const nextSequence = Number(counter?.get("value") ?? 0) + 1;
      const effectiveAt = FieldValue.serverTimestamp();
      transactionNumber = `INV-${new Date().getUTCFullYear()}-${String(nextSequence).padStart(6, "0")}`;
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
        reversalReference,
        clean({
          organizationId: actor.organizationId,
          transactionNumber,
          transactionType: "reversal",
          status: "posted",
          effectiveAt,
          postedAt: now,
          postedBy: actor.userId,
          reason: input.reason,
          sourceLocationId: original.get("destinationLocationId"),
          destinationLocationId: original.get("sourceLocationId"),
          sourceWarehouseId: original.get("destinationWarehouseId"),
          destinationWarehouseId: original.get("sourceWarehouseId"),
          sourceBranchId: original.get("destinationBranchId"),
          destinationBranchId: original.get("sourceBranchId"),
          reversalOfTransactionId: input.transactionId,
          idempotencyKey: input.idempotencyKey,
          correlationId: requestId,
          createdAt: now,
          createdBy: actor.userId,
        }),
      );
      for (const entry of entrySnapshot.docs) {
        const locationId =
          typeof entry.get("locationId") === "string"
            ? String(entry.get("locationId"))
            : undefined;
        let before = 0;
        let after = 0;
        if (locationId) {
          const balanceId = balanceDocumentId(
            actor.organizationId,
            String(entry.get("productId")),
            locationId,
            typeof entry.get("lotId") === "string"
              ? String(entry.get("lotId"))
              : undefined,
          );
          const balance = balanceById.get(balanceId)!;
          before = Number(balance.get("onHandQuantity"));
          after = before - Number(entry.get("quantityDelta"));
          const totalValue =
            Number(balance.get("totalValueMinor")) -
            Number(entry.get("valueDeltaMinor"));
          if (after < 0 || totalValue < 0)
            throw new HttpsError(
              "failed-precondition",
              "Reversal would create an invalid balance.",
            );
          const reserved = Number(balance.get("reservedQuantity") ?? 0);
          transaction.update(balance.ref, {
            onHandQuantity: after,
            availableQuantity: after - reserved,
            totalValueMinor: after === 0 ? 0 : totalValue,
            averageUnitCostMinor:
              after === 0 ? 0 : Math.round(totalValue / after),
            lastTransactionId: reversalReference.id,
            lastMovementAt: now,
            version: Number(balance.get("version") ?? 0) + 1,
            updatedAt: now,
          });
          balanceById.set(balanceId, {
            ...balance,
            get: (field: string) =>
              field === "onHandQuantity"
                ? after
                : field === "totalValueMinor"
                  ? after === 0
                    ? 0
                    : totalValue
                  : balance.get(field),
          } as typeof balance);
        }
        transaction.create(
          db.collection("inventoryEntries").doc(),
          clean({
            organizationId: actor.organizationId,
            transactionId: reversalReference.id,
            transactionNumber,
            transactionType: "reversal",
            productId: entry.get("productId"),
            sku: entry.get("sku"),
            productName: entry.get("productName"),
            trackingType: entry.get("trackingType"),
            locationId,
            warehouseId: entry.get("warehouseId"),
            branchId: entry.get("branchId"),
            counterpartyLocationId: entry.get("counterpartyLocationId"),
            externalAccount: entry.get("externalAccount"),
            quantityDelta: -Number(entry.get("quantityDelta")),
            unitCostMinor: Number(entry.get("unitCostMinor")),
            valueDeltaMinor: -Number(entry.get("valueDeltaMinor")),
            currency: "NGN",
            lotId: entry.get("lotId"),
            serializedItemId: entry.get("serializedItemId"),
            serialNumber: entry.get("serialNumber"),
            balanceBefore: before,
            balanceAfter: after,
            effectiveAt: now,
            postedBy: actor.userId,
            reason: input.reason,
            createdAt: now,
          }),
        );
      }
      for (const serial of serials) {
        const matching = locationEntries.filter(
          (entry) => entry.get("serializedItemId") === serial.id,
        );
        const currentLocation = String(serial.get("currentLocationId"));
        const currentEntry =
          matching.find(
            (entry) =>
              entry.get("locationId") === currentLocation &&
              Number(entry.get("quantityDelta")) > 0,
          ) ?? matching.find((entry) => Number(entry.get("quantityDelta")) < 0);
        if (!currentEntry)
          throw new HttpsError(
            "failed-precondition",
            "Serialized reversal history is incomplete.",
          );
        const restoreLocationId =
          Number(currentEntry.get("quantityDelta")) > 0
            ? currentEntry.get("counterpartyLocationId")
            : currentEntry.get("locationId");
        if (typeof restoreLocationId !== "string")
          transaction.update(serial.ref, {
            status: "written_off",
            active: false,
            lastTransactionId: reversalReference.id,
            lastMovementAt: now,
            updatedAt: now,
            updatedBy: actor.userId,
          });
        else {
          const restoredLocation = locationById.get(restoreLocationId);
          if (!restoredLocation?.exists)
            throw new HttpsError(
              "failed-precondition",
              "The original serialized-item location no longer exists.",
            );
          transaction.update(
            serial.ref,
            clean({
              currentLocationId: restoreLocationId,
              warehouseId: restoredLocation.get("warehouseId"),
              branchId: restoredLocation.get("branchId"),
              status: statusForLocation(String(restoredLocation.get("type"))),
              active: true,
              lastTransactionId: reversalReference.id,
              lastMovementAt: now,
              updatedAt: now,
              updatedBy: actor.userId,
            }),
          );
        }
      }
      for (const lot of lots) {
        const quantities = {
          ...(lot.get("locationQuantities") as Record<string, number>),
        };
        for (const entry of locationEntries.filter(
          (item) => item.get("lotId") === lot.id,
        ))
          quantities[String(entry.get("locationId"))] =
            Number(quantities[String(entry.get("locationId"))] ?? 0) -
            Number(entry.get("quantityDelta"));
        if (Object.values(quantities).some((quantity) => quantity < 0))
          throw new HttpsError(
            "failed-precondition",
            "Lot reversal would create a negative balance.",
          );
        transaction.update(lot.ref, {
          locationQuantities: quantities,
          remainingQuantity: Object.values(quantities).reduce(
            (sum, quantity) => sum + quantity,
            0,
          ),
          lastTransactionId: reversalReference.id,
          updatedAt: now,
          updatedBy: actor.userId,
        });
      }
      transaction.create(reversalLock, {
        organizationId: actor.organizationId,
        originalTransactionId: input.transactionId,
        reversalTransactionId: reversalReference.id,
        createdAt: now,
        createdBy: actor.userId,
      });
      transaction.create(operation, {
        organizationId: actor.organizationId,
        action: "inventoryReverse",
        transactionId: reversalReference.id,
        transactionNumber,
        status: "completed",
        createdAt: now,
        createdBy: actor.userId,
      });
      writeAuditLog(transaction, actor, {
        action: "inventory.transaction_reversed",
        entityType: "inventoryTransaction",
        entityId: reversalReference.id,
        correlationId: requestId,
        sourceFunction: "reverseInventoryTransaction",
        reason: input.reason,
        after: {
          originalTransactionId: input.transactionId,
          transactionNumber,
        },
      });
    });
    logger.info("Inventory transaction reversed", {
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      originalTransactionId: input.transactionId,
      transactionId: reversalReference.id,
      correlationId: requestId,
    });
    return {
      transactionId: reversalReference.id,
      transactionNumber,
      reversed: true,
    };
  },
);
