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

export const saveCustomerInput = z
  .object({
    customerId: id.optional(),
    name: z.string().trim().min(2).max(160),
    phone: z.string().trim().regex(/^0\d{10}$/, "Use an 11-digit Nigerian number beginning with 0.").optional(),
    email: z.string().trim().email().max(254).optional(),
    address: z.string().trim().max(500).optional(),
    taxId: z.string().trim().max(80).optional(),
    active: z.boolean().default(true),
    idempotencyKey: z.string().uuid(),
  })
  .superRefine((value, context) => {
    if (!value.phone && !value.email)
      context.addIssue({
        code: "custom",
        path: ["phone"],
        message: "Provide a phone number or email address.",
      });
  });

export const decideCustomerCreditInput = z.object({
  customerId: id,
  decision: z.enum(["approve", "suspend", "reject"]),
  creditLimitMinor: money.default(0),
  reason: z.string().trim().min(3).max(500),
  idempotencyKey: z.string().uuid(),
});

export const customerPaymentInput = z.object({
  customerId: id,
  branchId: id,
  method: z.enum(["cash", "card", "bank_transfer"]),
  amountMinor: positiveMoney,
  reference: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().uuid(),
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
    .min(0)
    .max(5),
  customerId: id.optional(),
  creditAmountMinor: money.default(0),
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().uuid(),
}).superRefine((value, context) => {
  if (value.creditAmountMinor > 0 && !value.customerId)
    context.addIssue({
      code: "custom",
      path: ["customerId"],
      message: "Select an approved customer for credit.",
    });
  if (value.creditAmountMinor > 0 && value.offline)
    context.addIssue({
      code: "custom",
      path: ["offline"],
      message: "Credit sales require a live online authorization check.",
    });
  if (value.creditAmountMinor === 0 && value.payments.length === 0)
    context.addIssue({
      code: "custom",
      path: ["payments"],
      message: "A paid sale requires at least one payment.",
    });
});
