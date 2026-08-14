import { z } from "zod";

const id = z.string().trim().min(1).max(160);
const optionalText = (max: number) => z.string().trim().max(max).optional();
const code = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[A-Za-z0-9 _.-]+$/);
const idempotencyKey = z.string().uuid();
const quantity = z.number().int().positive().max(1_000_000_000);
const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const categoryInput = z.object({
  id: id.optional(),
  name: z.string().trim().min(2).max(120),
  code,
  description: optionalText(500),
  active: z.boolean().default(true),
  idempotencyKey,
});
export const productInput = z.object({
  id: id.optional(),
  name: z.string().trim().min(2).max(180),
  sku: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    code.optional(),
  ),
  categoryId: id.optional(),
  brand: optionalText(120),
  model: optionalText(120),
  description: optionalText(2000),
  unitOfMeasure: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z0-9 .²³/-]+$/),
  trackingType: z.enum(["quantity", "batch", "serial"]),
  minimumStockLevel: z.number().int().nonnegative().optional(),
  reorderLevel: z.number().int().nonnegative().optional(),
  defaultUnitCostMinor: money.optional(),
  active: z.boolean().default(true),
  idempotencyKey,
});
const effectiveAt = z.string().datetime();
const reference = z.object({
  referenceType: optionalText(60),
  referenceId: optionalText(160),
  referenceNumber: optionalText(120),
  notes: optionalText(1000),
});
const lot = z.object({
  lotNumber: z.string().trim().min(1).max(120),
  manufacturingDate: z.string().date().optional(),
  expiryDate: z.string().date().optional(),
  supplierReference: optionalText(160),
});
export const externalStockInput = reference.extend({
  productId: id,
  destinationLocationId: id,
  quantity,
  unitCostMinor: money,
  serialNumbers: z
    .array(z.string().trim().min(1).max(160))
    .max(500)
    .default([]),
  lot: lot.optional(),
  effectiveAt,
  reason: z.string().trim().min(3).max(500),
  externalAccount: z.enum([
    "supplier",
    "migration",
    "donation",
    "external_return",
    "other",
  ]),
  idempotencyKey,
});
export const internalMovementInput = reference.extend({
  productId: id,
  sourceLocationId: id,
  destinationLocationId: id,
  quantity,
  serialNumbers: z
    .array(z.string().trim().min(1).max(160))
    .max(500)
    .default([]),
  lotId: id.optional(),
  lotNumber: z.string().trim().min(1).max(120).optional(),
  effectiveAt,
  reason: z.string().trim().min(3).max(500),
  idempotencyKey,
});
export const adjustmentInput = reference.extend({
  productId: id,
  locationId: id,
  direction: z.enum(["increase", "decrease"]),
  adjustmentType: z.enum([
    "increase",
    "decrease",
    "damage",
    "loss",
    "found_stock",
    "data_correction",
  ]),
  quantity,
  unitCostMinor: money.optional(),
  serialNumbers: z
    .array(z.string().trim().min(1).max(160))
    .max(500)
    .default([]),
  lot: lot.optional(),
  lotId: id.optional(),
  effectiveAt,
  reason: z.string().trim().min(5).max(500),
  idempotencyKey,
});
export const reversalInput = z.object({
  transactionId: id,
  reason: z.string().trim().min(5).max(500),
  idempotencyKey,
});
export const pageInput = z.object({
  productId: id.optional(),
  locationId: id.optional(),
  transactionType: z.string().max(60).optional(),
  serialNumber: z.string().max(160).optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  cursor: z.string().max(160).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  includeCosts: z.boolean().default(false),
});
export const reconciliationInput = z.object({
  productId: id.optional(),
  locationId: id.optional(),
  limit: z.number().int().min(1).max(500).default(200),
});
export const stockCountCreateInput = z.object({
  locationId: id,
  assignedUserIds: z.array(id).min(1).max(20),
  blindCount: z.boolean().default(true),
  countDate: z.string().date(),
  notes: optionalText(1000),
  idempotencyKey,
});
export const stockCountActionInput = z.object({
  stockCountId: id,
  reason: z.string().trim().min(3).max(500),
  idempotencyKey,
});
export const stockCountSubmitInput = stockCountActionInput.extend({
  items: z
    .array(
      z.object({
        itemId: id,
        countedQuantity: z.number().int().nonnegative(),
        serialNumbers: z
          .array(z.string().trim().min(1).max(160))
          .max(500)
          .default([]),
        notes: optionalText(500),
      }),
    )
    .min(1)
    .max(200),
});
