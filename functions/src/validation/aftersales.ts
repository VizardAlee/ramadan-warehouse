import { z } from "zod";

const id = z.string().trim().min(1).max(128).refine(value => !value.includes("/") && value !== "." && value !== "..", "Invalid record identifier.");
const text = z.string().trim();
const operatingContext = z.object({ type: z.enum(["branch", "warehouse"]), id }).strict().optional();

export const aftersalesWorkspaceInput = z.object({
  action: z.literal("list_payments").optional(),
  caseId: id.refine(value => !value.includes("/"), "Invalid case reference.").optional(),
  paymentCursor: id.optional(),
  paymentLimit: z.union([z.literal(25), z.literal(50), z.literal(100)]).default(25),
  branchId: id.optional(),
  limit: z.number().int().min(1).max(200).default(100),
});

export const createAftersalesCaseInput = z.object({
  branchId: id,
  customerId: id,
  saleId: id.optional(),
  productId: id.optional(),
  serviceItemId: id.optional(),
  serialNumber: text.max(160).optional(),
  serviceType: z.enum(["warranty", "non_warranty"]),
  requestType: z.enum(["installation", "warranty", "repair", "replacement", "inspection", "maintenance", "technical_support"]),
  complaint: text.min(5).max(1_000),
  notes: text.max(1_000).optional(),
  idempotencyKey: z.string().uuid(),
});

const changeAftersalesStatusInput = z.object({
  caseId: id,
  status: z.enum(["diagnosed", "in_service", "awaiting_collection", "completed", "cancelled"]),
  resolution: text.min(5).max(1_000),
  notes: text.max(1_000).optional(),
  idempotencyKey: z.string().uuid(),
});

export const updateAftersalesCaseInput = z.union([
  z.object({
    caseId: id,
    action: z.literal("assign_staff"),
    operatingContext,
    staffId: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9-]+$/).transform(value => value.toUpperCase()).nullable(),
    reason: text.min(5).max(500),
    idempotencyKey: z.string().uuid(),
  }).strict().transform(input => { const values = { ...input }; delete values.operatingContext; return values; }),
  changeAftersalesStatusInput,
]);

export const setAftersalesChargeInput = z.object({
  caseId: id,
  chargeAmountMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  reason: text.min(5).max(500),
  idempotencyKey: z.string().uuid(),
});

export const recordAftersalesPaymentInput = z.object({
  caseId: id,
  method: z.enum(["cash", "card", "bank_transfer"]),
  bankAccountId: id.optional(),
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  reference: text.max(160).optional(),
  idempotencyKey: z.string().uuid(),
}).superRefine((value, context) => {
  if (value.method !== "cash" && !value.bankAccountId)
    context.addIssue({ code: "custom", path: ["bankAccountId"], message: "Select the receiving bank account." });
});

export const refundAftersalesPaymentInput = z.object({
  action: z.literal("refund"),
  operatingContext,
  caseId: id,
  originalPaymentId: id,
  method: z.enum(["cash", "card", "bank_transfer"]),
  bankAccountId: id.optional(),
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  reference: text.max(160).optional(),
  reason: text.min(5).max(500),
  idempotencyKey: z.string().uuid(),
}).strict().superRefine((value, context) => {
  if (value.method !== "cash" && !value.bankAccountId)
    context.addIssue({ code: "custom", path: ["bankAccountId"], message: "Select the account paying this refund." });
}).transform(input => { const values = { ...input }; delete values.operatingContext; return values; });
