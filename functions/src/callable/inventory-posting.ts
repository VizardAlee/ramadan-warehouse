import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import { requireAccess, requirePermission } from "../auth/authorize.js";
import { enforceAppCheck } from "../config.js";
import {
  normalizeInventoryIdentifier,
  uniquenessDocumentId,
} from "../inventory/calculations.js";
import { postInventoryTransaction } from "../inventory/post-inventory-transaction.js";
import { correlationId, parseInput } from "../utils/callable.js";
import {
  adjustmentInput,
  externalStockInput,
  internalMovementInput,
} from "../validation/inventory.js";

export const postOpeningStock = onCall(
  { enforceAppCheck, timeoutSeconds: 60 },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "inventory.opening_stock");
    const input = parseInput(externalStockInput, request.data);
    const requestId = correlationId();
    const organization = await db
      .collection("organizations")
      .doc(actor.organizationId)
      .get();
    if (organization.get("openingStockEnabled") === false)
      throw new HttpsError(
        "failed-precondition",
        "Opening-stock posting has been disabled for this organization.",
      );
    if (input.externalAccount !== "migration")
      throw new HttpsError(
        "invalid-argument",
        "Opening stock must use the migration external account.",
      );
    const result = await postInventoryTransaction(actor, {
      ...input,
      transactionType: "opening_balance",
      correlationId: requestId,
      sourceFunction: "postOpeningStock",
    });
    logger.info("Opening stock posted", {
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      transactionId: result.transactionId,
      correlationId: requestId,
    });
    return result;
  },
);

export const postInventoryReceipt = onCall(
  { enforceAppCheck, timeoutSeconds: 60 },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "inventory.receive");
    const input = parseInput(externalStockInput, request.data);
    const requestId = correlationId();
    if (input.externalAccount === "migration")
      throw new HttpsError(
        "invalid-argument",
        "Use the dedicated opening-stock workflow for migration balances.",
      );
    const result = await postInventoryTransaction(actor, {
      ...input,
      transactionType: "inventory_receipt",
      correlationId: requestId,
      sourceFunction: "postInventoryReceipt",
    });
    logger.info("Inventory receipt posted", {
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      transactionId: result.transactionId,
      correlationId: requestId,
    });
    return result;
  },
);

export const moveInventoryBetweenLocations = onCall(
  { enforceAppCheck, timeoutSeconds: 60 },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "inventory.move_internal");
    const input = parseInput(internalMovementInput, request.data);
    const requestId = correlationId();
    const lotId =
      input.lotId ??
      (input.lotNumber
        ? uniquenessDocumentId(
            actor.organizationId,
            input.productId,
            normalizeInventoryIdentifier(input.lotNumber),
          )
        : undefined);
    const result = await postInventoryTransaction(actor, {
      ...input,
      lotId,
      transactionType: "location_transfer",
      correlationId: requestId,
      sourceFunction: "moveInventoryBetweenLocations",
    });
    logger.info("Internal inventory moved", {
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      transactionId: result.transactionId,
      correlationId: requestId,
    });
    return result;
  },
);

export const postStockAdjustment = onCall(
  { enforceAppCheck, timeoutSeconds: 60 },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "inventory.adjust");
    const input = parseInput(adjustmentInput, request.data);
    const requestId = correlationId();
    const common = {
      productId: input.productId,
      quantity: input.quantity,
      unitCostMinor: input.unitCostMinor,
      serialNumbers: input.serialNumbers,
      lot: input.lot,
      lotId: input.lotId,
      effectiveAt: input.effectiveAt,
      reason: input.reason,
      notes: input.notes,
      referenceType: input.referenceType ?? "stock_adjustment",
      referenceId: input.referenceId,
      referenceNumber: input.referenceNumber,
      idempotencyKey: input.idempotencyKey,
      transactionType: "stock_adjustment" as const,
      correlationId: requestId,
      sourceFunction: "postStockAdjustment",
      externalAccount: `adjustment_${input.adjustmentType}`,
    };
    const result = await postInventoryTransaction(
      actor,
      input.direction === "increase"
        ? { ...common, destinationLocationId: input.locationId }
        : { ...common, sourceLocationId: input.locationId },
    );
    logger.info("Stock adjustment posted", {
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      transactionId: result.transactionId,
      adjustmentType: input.adjustmentType,
      correlationId: requestId,
    });
    return result;
  },
);
