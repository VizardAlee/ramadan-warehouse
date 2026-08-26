import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import { db } from "../admin.js";
import { requireAccess, requirePermission, type AccessProfile } from "../auth/authorize.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { enforceAppCheck } from "../config.js";
import { previewCsvImport as preview, type CsvImportKind, type CsvValidationContext } from "../imports/csv-import.js";
import { generateCategoryCode, normalizeInventoryIdentifier, uniquenessDocumentId } from "../inventory/calculations.js";
import { postInventoryTransaction } from "../inventory/post-inventory-transaction.js";
import { enforceRateLimit } from "../security/rate-limit.js";
import { correlationId, parseInput } from "../utils/callable.js";

const previewInput = z.object({ kind: z.enum(["products", "opening_stock", "serial_numbers"]), csv: z.string().min(1).max(1_000_000) });
const confirmInput = previewInput.extend({ idempotencyKey: z.string().uuid() });

async function contextFor(actor: AccessProfile, kind: CsvImportKind): Promise<CsvValidationContext> {
  if (kind === "products") {
    const skus = await db.collection("organizationSkus").where("organizationId", "==", actor.organizationId).limit(1000).get();
    return { existingSkus: new Set(skus.docs.map((item) => String(item.get("normalizedSku")))) };
  }
  const [products, locations, serials] = await Promise.all([
    db.collection("products").where("organizationId", "==", actor.organizationId).limit(1000).get(),
    db.collection("inventoryLocations").where("organizationId", "==", actor.organizationId).limit(1000).get(),
    kind === "serial_numbers" ? db.collection("serializedItems").where("organizationId", "==", actor.organizationId).limit(1000).get() : Promise.resolve(undefined),
  ]);
  return {
    productTracking: new Map(products.docs.map((item) => [item.id, item.get("trackingType") as "quantity" | "batch" | "serial"])),
    locationIds: new Set(locations.docs.map((item) => item.id)),
    existingSerials: serials ? new Set(serials.docs.map((item) => normalizeInventoryIdentifier(String(item.get("serialNumber"))))) : undefined,
  };
}

function requireImportPermission(actor: AccessProfile, kind: CsvImportKind) {
  requirePermission(actor, kind === "products" ? "products.create" : "inventory.opening_stock");
}

function optionalText(row: Record<string, string>, field: string) {
  const value = row[field]?.trim();
  return value || undefined;
}

function nairaToMinor(value: string | undefined) {
  if (!value) return undefined;
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

function importedBoolean(value: string | undefined) {
  if (!value) return true;
  return ["true", "yes", "1", "active"].includes(value.toLowerCase());
}

function hasImportedBasePrice(rows: readonly Record<string, string>[]) {
  return rows.some((row) => Boolean(optionalText(row, "baseSellingPriceNaira")));
}

export const previewCsvImport = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request);
  const input = parseInput(previewInput, request.data);
  requireImportPermission(actor, input.kind);
  await enforceRateLimit({ organizationId: actor.organizationId, userId: actor.userId, operation: "csv-import-preview", limit: 20, windowSeconds: 60 });
  const result = preview(input.kind, input.csv, await contextFor(actor, input.kind));
  if (input.kind === "products" && hasImportedBasePrice(result.validRows))
    requirePermission(actor, "sales.price.base.manage");
  return result;
});

export const confirmCsvImport = onCall({ enforceAppCheck, timeoutSeconds: 120 }, async (request) => {
  const actor = await requireAccess(request);
  const input = parseInput(confirmInput, request.data);
  requireImportPermission(actor, input.kind);
  await enforceRateLimit({ organizationId: actor.organizationId, userId: actor.userId, operation: "csv-import-confirm", limit: 3, windowSeconds: 300 });
  const operation = db.doc(`importOperations/${actor.organizationId}__${input.idempotencyKey}`);
  const existing = await operation.get();
  if (existing.exists) return { importId: operation.id, imported: false, summary: existing.get("summary") };
  const result = preview(input.kind, input.csv, await contextFor(actor, input.kind));
  if (!result.valid) throw new HttpsError("failed-precondition", "CSV import contains validation errors.", { errors: result.errors });
  if (input.kind === "products" && hasImportedBasePrice(result.validRows))
    requirePermission(actor, "sales.price.base.manage");
  if (input.kind !== "products") {
    const organization = await db.doc(`organizations/${actor.organizationId}`).get();
    if (organization.get("openingStockEnabled") === false) throw new HttpsError("failed-precondition", "Opening-stock imports are disabled for this organization.");
  }
  await operation.create({ organizationId: actor.organizationId, kind: input.kind, sourceHash: createHash("sha256").update(input.csv).digest("hex"), status: "processing", createdAt: FieldValue.serverTimestamp(), createdBy: actor.userId });
  let imported = 0;
  try {
    for (let index = 0; index < result.validRows.length; index++) {
      const row = result.validRows[index]!;
      if (input.kind === "products") {
        const productId = db.collection("products").doc().id;
        const effectiveSku = optionalText(row, "sku") ?? `SKU-${productId.toUpperCase()}`;
        const normalizedSku = normalizeInventoryIdentifier(effectiveSku);
        const categoryName = optionalText(row, "categoryName");
        const categoryIdInput = optionalText(row, "categoryId");
        const categoryCode = categoryName
          ? generateCategoryCode(categoryName)
          : undefined;
        await db.runTransaction(async (transaction) => {
          const lock = db.doc(`organizationSkus/${uniquenessDocumentId(actor.organizationId, normalizedSku)}`);
          const categoryLock = categoryCode
            ? db.doc(
                `organizationCodes/${uniquenessDocumentId(
                  actor.organizationId,
                  "productCategory",
                  categoryCode,
                )}`,
              )
            : undefined;
          const [owner, categoryOwner] = await transaction.getAll(
            lock,
            ...(categoryLock ? [categoryLock] : []),
          );
          if (owner!.exists) throw new HttpsError("already-exists", `SKU ${effectiveSku} already exists.`);
          const effectiveCategoryId = categoryIdInput
            ? categoryIdInput
            : categoryOwner?.exists
              ? String(categoryOwner.get("entityId"))
              : categoryName
                ? db.collection("productCategories").doc().id
                : undefined;
          const categoryReference = effectiveCategoryId
            ? db.doc(`productCategories/${effectiveCategoryId}`)
            : undefined;
          const category = categoryReference
            ? await transaction.get(categoryReference)
            : undefined;
          if (
            category?.exists &&
            (category.get("organizationId") !== actor.organizationId ||
              category.get("active") !== true)
          )
            throw new HttpsError(
              "failed-precondition",
              "Imported categories must be active in this organization.",
            );
          if (categoryIdInput && !category?.exists)
            throw new HttpsError("failed-precondition", "Imported category was not found.");
          const now = FieldValue.serverTimestamp();
          const createCategory = Boolean(
            categoryName &&
              categoryCode &&
              categoryLock &&
              categoryReference &&
              !categoryOwner?.exists,
          );
          if (createCategory && categoryName && categoryCode && categoryLock && categoryReference) {
            transaction.create(categoryReference, {
              organizationId: actor.organizationId,
              name: categoryName,
              code: categoryCode,
              active: true,
              createdAt: now,
              createdBy: actor.userId,
              updatedAt: now,
              updatedBy: actor.userId,
            });
            transaction.set(categoryLock, {
              organizationId: actor.organizationId,
              kind: "productCategory",
              code: categoryCode,
              entityId: categoryReference.id,
              updatedAt: now,
            });
            writeAuditLog(transaction, actor, {
              action: "product_category.created",
              entityType: "productCategory",
              entityId: categoryReference.id,
              correlationId: correlationId(),
              sourceFunction: "confirmCsvImport",
              after: { code: categoryCode, active: true },
            });
          }
          const effectiveCategoryName = createCategory
            ? categoryName
            : category?.exists
              ? String(category.get("name"))
              : undefined;
          transaction.create(db.doc(`products/${productId}`), {
            organizationId: actor.organizationId,
            sku: effectiveSku,
            normalizedSku,
            name: row.name,
            unitOfMeasure: row.unitOfMeasure,
            trackingType: row.trackingType,
            categoryId: categoryReference?.id ?? null,
            categoryName: effectiveCategoryName ?? null,
            brand: optionalText(row, "brand") ?? null,
            model: optionalText(row, "model") ?? null,
            description: optionalText(row, "description") ?? null,
            minimumStockLevel: optionalText(row, "minimumStockLevel")
              ? Number(row.minimumStockLevel)
              : null,
            reorderLevel: optionalText(row, "reorderLevel")
              ? Number(row.reorderLevel)
              : null,
            active: importedBoolean(row.active),
            hasLedgerActivity: false,
            currency: "NGN",
            createdAt: now,
            createdBy: actor.userId,
            updatedAt: now,
            updatedBy: actor.userId,
          });
          transaction.create(lock, { organizationId: actor.organizationId, normalizedSku, productId, updatedAt: now });
          const defaultUnitCostMinor = optionalText(row, "defaultUnitCostMinor")
            ? Number(row.defaultUnitCostMinor)
            : nairaToMinor(optionalText(row, "defaultUnitCostNaira"));
          if (defaultUnitCostMinor !== undefined)
            transaction.set(db.doc(`productCosts/${productId}`), {
              organizationId: actor.organizationId,
              productId,
              defaultUnitCostMinor,
              currency: "NGN",
              updatedAt: now,
              updatedBy: actor.userId,
            });
          const basePriceMinor = nairaToMinor(
            optionalText(row, "baseSellingPriceNaira"),
          );
          if (basePriceMinor !== undefined)
            transaction.set(db.doc(`productSalesPrices/${productId}`), {
              organizationId: actor.organizationId,
              productId,
              sku: effectiveSku,
              productName: row.name,
              basePriceMinor,
              vatRateBasisPoints: Math.round(
                Number(optionalText(row, "vatPercent") ?? "0") * 100,
              ),
              currency: "NGN",
              active: true,
              version: 1,
              createdAt: now,
              createdBy: actor.userId,
              updatedAt: now,
              updatedBy: actor.userId,
            });
          const auditCorrelationId = correlationId();
          writeAuditLog(transaction, actor, { action: "product.imported", entityType: "product", entityId: productId, correlationId: auditCorrelationId, sourceFunction: "confirmCsvImport", after: { sku: effectiveSku, categoryId: categoryReference?.id } });
          if (basePriceMinor !== undefined)
            writeAuditLog(transaction, actor, {
              action: "sales_price.created",
              entityType: "productSalesPrice",
              entityId: productId,
              correlationId: auditCorrelationId,
              sourceFunction: "confirmCsvImport",
              after: {
                basePriceMinor,
                vatRateBasisPoints: Math.round(
                  Number(optionalText(row, "vatPercent") ?? "0") * 100,
                ),
                active: true,
                version: 1,
              },
            });
        });
      } else {
        const serialNumbers = input.kind === "serial_numbers" ? [row.serialNumber!] : (row.serialNumbers ?? "").split("|").map((serial) => serial.trim()).filter(Boolean);
        await postInventoryTransaction(actor, {
          transactionType: "opening_balance",
          productId: row.productId!,
          quantity: input.kind === "serial_numbers" ? 1 : Number(row.quantity),
          destinationLocationId: row.locationId!,
          unitCostMinor: Number(row.unitCostMinor),
          serialNumbers,
          lot: row.lotNumber ? { lotNumber: row.lotNumber } : undefined,
          effectiveAt: new Date().toISOString(),
          reason: "Confirmed CSV opening balance import",
          referenceType: "csv_import",
          referenceId: operation.id,
          referenceNumber: operation.id,
          externalAccount: "migration",
          idempotencyKey: `${input.idempotencyKey}:${index}`,
          correlationId: correlationId(),
          sourceFunction: "confirmCsvImport",
        });
      }
      imported++;
    }
    const summary = { totalRows: result.totalRows, imported, failed: 0 };
    await operation.update({ status: "completed", summary, completedAt: FieldValue.serverTimestamp() });
    return { importId: operation.id, imported: true, summary, failedRows: [] };
  } catch (error) {
    await operation.update({ status: "failed", summary: { totalRows: result.totalRows, imported, failed: result.totalRows - imported }, errorCode: error instanceof HttpsError ? error.code : "internal", failedAt: FieldValue.serverTimestamp() });
    throw error;
  }
});
