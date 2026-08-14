import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import { requireAccess, requirePermission } from "../auth/authorize.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { enforceAppCheck } from "../config.js";
import {
  generateCategoryCode,
  normalizeInventoryIdentifier,
  uniquenessDocumentId,
} from "../inventory/calculations.js";
import { correlationId, parseInput } from "../utils/callable.js";
import { categoryInput, productInput } from "../validation/inventory.js";

function clean(values: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(values).filter(
      ([, value]) => value !== undefined && value !== "",
    ),
  );
}

export const saveProductCategory = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(
      actor,
      request.data?.id ? "products.update" : "products.create",
    );
    const input = parseInput(categoryInput, request.data);
    const operation = db
      .collection("idempotencyKeys")
      .doc(`${actor.organizationId}_saveCategory_${input.idempotencyKey}`);
    const prior = await operation.get();
    if (prior.exists)
      return { categoryId: prior.get("entityId") as string, saved: false };
    const categoryId = input.id ?? db.collection("productCategories").doc().id;
    const reference = db.collection("productCategories").doc(categoryId);
    const requestId = correlationId();
    await db.runTransaction(async (transaction) => {
      const [current, existingOperation] = await transaction.getAll(
        reference,
        operation,
      );
      const currentCategory = current!;
      const currentOperation = existingOperation!;
      if (currentOperation.exists) return;
      const normalizedCode = normalizeInventoryIdentifier(
        input.code?.trim() ||
          (currentCategory.exists
            ? String(currentCategory.get("code"))
            : generateCategoryCode(input.name)),
      );
      const lock = db
        .collection("organizationCodes")
        .doc(
          uniquenessDocumentId(
            actor.organizationId,
            "productCategory",
            normalizedCode,
          ),
        );
      const owner = await transaction.get(lock);
      if (
        currentCategory.exists &&
        currentCategory.get("organizationId") !== actor.organizationId
      )
        throw new HttpsError(
          "permission-denied",
          "Cross-organization updates are not permitted.",
        );
      if (owner.exists && owner.get("entityId") !== categoryId)
        throw new HttpsError(
          "already-exists",
          "Category code is already in use.",
        );
      const now = FieldValue.serverTimestamp();
      const data = clean({
        ...input,
        code: normalizedCode,
        organizationId: actor.organizationId,
        updatedAt: now,
        updatedBy: actor.userId,
      });
      delete data.id;
      delete data.idempotencyKey;
      if (currentCategory.exists) transaction.update(reference, data);
      else
        transaction.create(reference, {
          ...data,
          createdAt: now,
          createdBy: actor.userId,
        });
      if (
        currentCategory.exists &&
        currentCategory.get("code") !== normalizedCode
      )
        transaction.delete(
          db
            .collection("organizationCodes")
            .doc(
              uniquenessDocumentId(
                actor.organizationId,
                "productCategory",
                String(currentCategory.get("code")),
              ),
            ),
        );
      transaction.set(lock, {
        organizationId: actor.organizationId,
        kind: "productCategory",
        code: normalizedCode,
        entityId: categoryId,
        updatedAt: now,
      });
      transaction.create(operation, {
        organizationId: actor.organizationId,
        action: "saveCategory",
        entityId: categoryId,
        status: "completed",
        createdAt: now,
        createdBy: actor.userId,
      });
      writeAuditLog(transaction, actor, {
        action: `product_category.${currentCategory.exists ? "updated" : "created"}`,
        entityType: "productCategory",
        entityId: categoryId,
        correlationId: requestId,
        sourceFunction: "saveProductCategory",
        before: currentCategory.exists
          ? {
              code: currentCategory.get("code"),
              active: currentCategory.get("active"),
            }
          : undefined,
        after: { code: normalizedCode, active: input.active },
      });
    });
    logger.info("Product category saved", {
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      categoryId,
      correlationId: requestId,
    });
    return { categoryId, saved: true };
  },
);

export const saveProduct = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request);
  requirePermission(
    actor,
    request.data?.id ? "products.update" : "products.create",
  );
  const input = parseInput(productInput, request.data);
  const operation = db
    .collection("idempotencyKeys")
    .doc(`${actor.organizationId}_saveProduct_${input.idempotencyKey}`);
  const prior = await operation.get();
  if (prior.exists)
    return { productId: prior.get("entityId") as string, saved: false };
  const productId = input.id ?? db.collection("products").doc().id;
  const reference = db.collection("products").doc(productId);
  const inlineCategoryName = input.categoryId
    ? undefined
    : input.categoryName?.trim();
  const inlineCategoryCode = inlineCategoryName
    ? generateCategoryCode(inlineCategoryName)
    : undefined;
  const inlineCategoryId = inlineCategoryName
    ? db.collection("productCategories").doc().id
    : undefined;
  const inlineCategoryLock = inlineCategoryCode
    ? db
        .collection("organizationCodes")
        .doc(
          uniquenessDocumentId(
            actor.organizationId,
            "productCategory",
            inlineCategoryCode,
          ),
        )
    : undefined;
  const requestId = correlationId();
  await db.runTransaction(async (transaction) => {
    const snapshots = await transaction.getAll(reference, operation);
    const current = snapshots[0]!;
    const existingOperation = snapshots[1]!;
    const effectiveSku =
      input.sku?.trim() ||
      (current.exists ? String(current.get("sku")) : `SKU-${productId.toUpperCase()}`);
    const normalizedSku = normalizeInventoryIdentifier(effectiveSku);
    const skuLock = db
      .collection("organizationSkus")
      .doc(uniquenessDocumentId(actor.organizationId, normalizedSku));
    const owner = await transaction.get(skuLock);
    const inlineCategoryOwner = inlineCategoryLock
      ? await transaction.get(inlineCategoryLock)
      : undefined;
    const currentCategoryMatchesInput = Boolean(
      current.exists &&
        inlineCategoryName &&
        current.get("categoryId") &&
        normalizeInventoryIdentifier(String(current.get("categoryName"))) ===
          normalizeInventoryIdentifier(inlineCategoryName),
    );
    const effectiveCategoryId = input.categoryId
      ? input.categoryId
      : currentCategoryMatchesInput
        ? String(current.get("categoryId"))
      : inlineCategoryOwner?.exists
        ? String(inlineCategoryOwner.get("entityId"))
        : inlineCategoryId;
    const categoryReference = effectiveCategoryId
      ? db.collection("productCategories").doc(effectiveCategoryId)
      : undefined;
    const category = categoryReference
      ? await transaction.get(categoryReference)
      : undefined;
    if (existingOperation.exists) return;
    if (
      current.exists &&
      current.get("organizationId") !== actor.organizationId
    )
      throw new HttpsError(
        "permission-denied",
        "Cross-organization updates are not permitted.",
      );
    if (owner.exists && owner.get("productId") !== productId)
      throw new HttpsError("already-exists", "SKU is already in use.");
    if (
      categoryReference &&
      (inlineCategoryOwner?.exists || input.categoryId) &&
      (!category?.exists ||
        category.get("organizationId") !== actor.organizationId ||
        category.get("active") !== true)
    )
      throw new HttpsError(
        "failed-precondition",
        "Select an active category in this organization.",
      );
    if (
      current.exists &&
      current.get("hasLedgerActivity") === true &&
      current.get("trackingType") !== input.trackingType
    )
      throw new HttpsError(
        "failed-precondition",
        "Tracking type cannot change after inventory has been posted.",
      );
    const now = FieldValue.serverTimestamp();
    const categoryCreated = Boolean(
      inlineCategoryName &&
        inlineCategoryCode &&
        inlineCategoryLock &&
        categoryReference &&
        !currentCategoryMatchesInput &&
        !inlineCategoryOwner?.exists,
    );
    if (
      categoryCreated &&
      inlineCategoryName &&
      inlineCategoryCode &&
      inlineCategoryLock &&
      categoryReference
    ) {
      transaction.create(categoryReference, {
        organizationId: actor.organizationId,
        name: inlineCategoryName,
        code: inlineCategoryCode,
        active: true,
        createdAt: now,
        createdBy: actor.userId,
        updatedAt: now,
        updatedBy: actor.userId,
      });
      transaction.set(inlineCategoryLock, {
        organizationId: actor.organizationId,
        kind: "productCategory",
        code: inlineCategoryCode,
        entityId: categoryReference.id,
        updatedAt: now,
      });
      writeAuditLog(transaction, actor, {
        action: "product_category.created",
        entityType: "productCategory",
        entityId: categoryReference.id,
        correlationId: requestId,
        sourceFunction: "saveProduct",
        after: { code: inlineCategoryCode, active: true },
      });
    }
    const effectiveCategoryName = categoryCreated
      ? inlineCategoryName
      : category?.exists
        ? String(category.get("name"))
        : undefined;
    const data = clean({
      ...input,
      sku: effectiveSku,
      normalizedSku,
      categoryId: categoryReference?.id,
      categoryName: effectiveCategoryName,
      organizationId: actor.organizationId,
      currency: "NGN",
      updatedAt: now,
      updatedBy: actor.userId,
    });
    delete data.id;
    delete data.idempotencyKey;
    delete data.defaultUnitCostMinor;
    if (current.exists) transaction.update(reference, data);
    else
      transaction.create(reference, {
        ...data,
        hasLedgerActivity: false,
        createdAt: now,
        createdBy: actor.userId,
      });
    if (current.exists && current.get("normalizedSku") !== normalizedSku)
      transaction.delete(
        db
          .collection("organizationSkus")
          .doc(
            uniquenessDocumentId(
              actor.organizationId,
              String(current.get("normalizedSku")),
            ),
          ),
      );
    transaction.set(skuLock, {
      organizationId: actor.organizationId,
      normalizedSku,
      productId,
      updatedAt: now,
    });
    transaction.create(operation, {
      organizationId: actor.organizationId,
      action: "saveProduct",
      entityId: productId,
      status: "completed",
      createdAt: now,
      createdBy: actor.userId,
    });
    if (input.defaultUnitCostMinor !== undefined)
      transaction.set(
        db.collection("productCosts").doc(productId),
        { organizationId: actor.organizationId, productId, defaultUnitCostMinor: input.defaultUnitCostMinor, currency: "NGN", updatedAt: now, updatedBy: actor.userId },
        { merge: true },
      );
    const activeChanged =
      current.exists && current.get("active") !== input.active;
    writeAuditLog(transaction, actor, {
      action: activeChanged
        ? `product.${input.active ? "activated" : "deactivated"}`
        : `product.${current.exists ? "updated" : "created"}`,
      entityType: "product",
      entityId: productId,
      correlationId: requestId,
      sourceFunction: "saveProduct",
      before: current.exists
        ? {
            sku: current.get("sku"),
            trackingType: current.get("trackingType"),
            active: current.get("active"),
          }
        : undefined,
      after: {
        sku: effectiveSku,
        trackingType: input.trackingType,
        active: input.active,
      },
    });
  });
  logger.info("Product saved", {
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    productId,
    correlationId: requestId,
  });
  return { productId, saved: true };
});
