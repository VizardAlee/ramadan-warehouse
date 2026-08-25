import { z } from "zod";

const id = z.string().trim().min(1).max(128);
const positiveMoney = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const optionalText = (max: number) => z.string().trim().max(max).optional();

export const saveSupplierInput = z.object({
  supplierId: id.optional(),
  name: z.string().trim().min(2).max(160),
  phone: z.string().trim().regex(/^0\d{10}$/, "Use an 11-digit Nigerian number beginning with 0.").optional(),
  email: z.string().trim().email().max(254).optional(),
  address: optionalText(500),
  taxId: optionalText(80),
  paymentTermsDays: z.number().int().min(0).max(365).default(0),
  active: z.boolean().default(true),
  idempotencyKey: z.string().uuid(),
}).superRefine((value, context) => {
  if (!value.phone && !value.email)
    context.addIssue({ code: "custom", path: ["phone"], message: "Provide a phone number or email address." });
});

export const procurementWorkspaceInput = z.object({
  warehouseId: id.optional(),
  limit: z.number().int().min(1).max(200).default(100),
});

export const createPurchaseOrderInput = z.object({
  supplierId: id,
  warehouseId: id,
  receivingLocationId: id,
  expectedAt: z.string().datetime().optional(),
  notes: optionalText(500),
  lines: z.array(z.object({
    productId: id,
    quantity: z.number().int().positive().max(100_000),
    unitCostMinor: positiveMoney,
    vatRateBasisPoints: z.number().int().min(0).max(10_000).default(0),
  })).min(1).max(100).superRefine((lines, context) => {
    const productIds = lines.map((line) => line.productId);
    if (new Set(productIds).size !== productIds.length)
      context.addIssue({ code: "custom", message: "Each product may appear only once." });
  }),
  idempotencyKey: z.string().uuid(),
});

export const purchaseOrderActionInput = z.object({
  purchaseOrderId: id,
  notes: optionalText(500),
  idempotencyKey: z.string().uuid(),
});

export const receivePurchaseOrderItemInput = z.object({
  purchaseOrderId: id,
  purchaseOrderItemId: id,
  quantity: z.number().int().positive().max(100_000),
  receivedAt: z.string().datetime(),
  supplierReference: optionalText(160),
  serialNumbers: z.array(z.string().trim().min(1).max(160)).max(5_000).default([]),
  lot: z.object({
    lotNumber: z.string().trim().min(1).max(160),
    manufacturingDate: z.string().date().optional(),
    expiryDate: z.string().date().optional(),
  }).optional(),
  notes: optionalText(500),
  idempotencyKey: z.string().uuid(),
});

export const submitSupplierInvoiceInput = z.object({
  purchaseOrderId: id,
  supplierInvoiceNumber: z.string().trim().min(2).max(160),
  invoiceDate: z.string().date(),
  dueDate: z.string().date().optional(),
  lines: z.array(z.object({
    purchaseOrderItemId: id,
    quantity: z.number().int().positive().max(100_000),
  })).min(1).max(100),
  notes: optionalText(500),
  idempotencyKey: z.string().uuid(),
});

export const supplierInvoiceActionInput = z.object({
  supplierInvoiceId: id,
  notes: optionalText(500),
  idempotencyKey: z.string().uuid(),
});

export const recordSupplierPaymentInput = z.object({
  supplierId: id,
  method: z.enum(["cash", "card", "bank_transfer"]),
  reference: optionalText(160),
  allocations: z.array(z.object({
    supplierInvoiceId: id,
    amountMinor: positiveMoney,
  })).min(1).max(100),
  paidAt: z.string().datetime(),
  notes: optionalText(500),
  idempotencyKey: z.string().uuid(),
}).superRefine((value, context) => {
  if (value.method !== "cash" && !value.reference)
    context.addIssue({ code: "custom", path: ["reference"], message: "Record the external payment reference." });
  const invoiceIds = value.allocations.map((allocation) => allocation.supplierInvoiceId);
  if (new Set(invoiceIds).size !== invoiceIds.length)
    context.addIssue({ code: "custom", path: ["allocations"], message: "Each invoice may appear only once." });
  const total = value.allocations.reduce((sum, allocation) => sum + allocation.amountMinor, 0);
  if (!Number.isSafeInteger(total) || total <= 0 || total > Number.MAX_SAFE_INTEGER)
    context.addIssue({ code: "custom", path: ["allocations"], message: "Payment allocation total is invalid." });
});
