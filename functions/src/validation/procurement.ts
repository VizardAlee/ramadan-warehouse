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
  view: z.enum(["workspace", "supplier_account"]).default("workspace"),
  supplierId: id.optional(),
  from: z.string().date().optional(),
  through: z.string().date().optional(),
  cursor: id.optional(),
  warehouseId: id.optional(),
  branchId: id.optional(),
  limit: z.number().int().min(1).max(200).default(100),
}).superRefine((value, context) => {
  if (value.branchId && value.warehouseId)
    context.addIssue({ code: "custom", path: ["branchId"], message: "Choose one operating location." });
  if (value.view === "supplier_account" && !value.supplierId)
    context.addIssue({ code: "custom", path: ["supplierId"], message: "Select a supplier." });
  if (value.from && value.through && value.from > value.through)
    context.addIssue({ code: "custom", path: ["through"], message: "The end date must not precede the start date." });
});

export const createPurchaseOrderInput = z.object({
  supplierId: id,
  warehouseId: id.optional(),
  branchId: id.optional(),
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
}).superRefine((value, context) => {
  if (Boolean(value.branchId) === Boolean(value.warehouseId))
    context.addIssue({ code: "custom", path: ["branchId"], message: "Choose exactly one receiving operating location." });
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
  purpose: z.enum(["payment", "advance"]).default("payment"),
  source: z.enum(["disbursement", "advance_balance"]).default("disbursement"),
  amountMinor: positiveMoney.optional(),
  branchId: id.optional(),
  warehouseId: id.optional(),
  method: z.enum(["cash", "card", "bank_transfer"]),
  bankAccountId: id.optional(),
  reference: optionalText(160),
  allocations: z.array(z.object({
    supplierInvoiceId: id,
    amountMinor: positiveMoney,
  })).max(100).default([]),
  paidAt: z.string().datetime(),
  notes: optionalText(500),
  idempotencyKey: z.string().uuid(),
}).superRefine((value, context) => {
  if (value.source === "disbursement" && value.method !== "cash" && !value.bankAccountId)
    context.addIssue({ code: "custom", path: ["bankAccountId"], message: "Select the company bank account funding this payment." });
  if (value.source === "disbursement" && value.method !== "cash" && !value.reference)
    context.addIssue({ code: "custom", path: ["reference"], message: "Record the external payment reference." });
  const invoiceIds = value.allocations.map((allocation) => allocation.supplierInvoiceId);
  if (new Set(invoiceIds).size !== invoiceIds.length)
    context.addIssue({ code: "custom", path: ["allocations"], message: "Each invoice may appear only once." });
  if (value.branchId && value.warehouseId)
    context.addIssue({ code: "custom", path: ["branchId"], message: "Choose one payment location." });
  if (value.purpose === "advance" && (!value.amountMinor || value.allocations.length || value.source !== "disbursement" || (!value.branchId && !value.warehouseId)))
    context.addIssue({ code: "custom", path: ["amountMinor"], message: "An advance requires an amount, a payment location, a new disbursement and no invoice allocations." });
  if (value.purpose === "payment" && (!value.allocations.length || value.amountMinor !== undefined))
    context.addIssue({ code: "custom", path: ["allocations"], message: "Allocate the payment to its invoices." });
  if (value.source === "advance_balance" && value.bankAccountId)
    context.addIssue({ code: "custom", path: ["bankAccountId"], message: "Applying an advance does not make another bank payment." });
  const total = value.purpose === "advance" ? value.amountMinor ?? 0 : value.allocations.reduce((sum, allocation) => sum + allocation.amountMinor, 0);
  if (!Number.isSafeInteger(total) || total <= 0 || total > Number.MAX_SAFE_INTEGER)
    context.addIssue({ code: "custom", path: ["allocations"], message: "Payment allocation total is invalid." });
});
