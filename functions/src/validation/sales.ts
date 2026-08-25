import { z } from "zod";

const id = z.string().trim().min(1).max(128);
const money = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positiveMoney = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const salesPriceInput = z.object({
  productId: id,
  basePriceMinor: positiveMoney,
  vatRateBasisPoints: z.number().int().min(0).max(10_000),
  active: z.boolean().default(true),
  idempotencyKey: z.string().uuid(),
});

export const branchSalesPriceInput = z.object({
  branchId: id,
  productId: id,
  sellingPriceMinor: positiveMoney,
  active: z.boolean().default(true),
  reason: z.string().trim().min(3).max(500).optional(),
  idempotencyKey: z.string().uuid(),
});

export const posWorkspaceInput = z.object({
  branchId: id,
  limit: z.number().int().min(1).max(500).default(200),
});

export const openPosShiftInput = z.object({
  branchId: id,
  deviceId: id,
  deviceName: z.string().trim().min(2).max(120),
  openingCashMinor: money,
  idempotencyKey: z.string().uuid(),
});

export const closePosShiftInput = z.object({
  shiftId: id,
  closingCashMinor: money,
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().uuid(),
});

export const salePaymentMethods = [
  "cash",
  "card",
  "bank_transfer",
] as const;

export const commitSaleInput = z.object({
  branchId: id,
  shiftId: id,
  deviceId: id,
  recordedAt: z.string().datetime(),
  offline: z.boolean().default(false),
  provisionalReceiptReference: z.string().trim().min(8).max(160).optional(),
  lines: z
    .array(
      z.object({
        productId: id,
        quantity: z.number().int().positive().max(100_000),
        priceVersion: z.number().int().positive().optional(),
        unitPriceMinor: money.optional(),
        vatRateBasisPoints: z.number().int().min(0).max(10_000).optional(),
      }),
    )
    .min(1)
    .max(50)
    .superRefine((lines, context) => {
      const ids = lines.map((line) => line.productId);
      if (new Set(ids).size !== ids.length)
        context.addIssue({
          code: "custom",
          message: "Each product may appear only once in a sale.",
        });
    }),
  payments: z
    .array(
      z.object({
        method: z.enum(salePaymentMethods),
        amountMinor: positiveMoney,
        reference: z.string().trim().max(120).optional(),
      }),
    )
    .min(1)
    .max(5),
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().uuid(),
});
