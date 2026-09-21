import { z } from "zod";

const id = z.string().trim().min(1).max(128);
const text = z.string().trim();

export const aftersalesWorkspaceInput = z.object({
  branchId: id.optional(),
  limit: z.number().int().min(1).max(200).default(100),
});

export const createAftersalesCaseInput = z.object({
  branchId: id,
  customerId: id,
  saleId: id.optional(),
  productId: id.optional(),
  serialNumber: text.max(160).optional(),
  serviceType: z.enum(["warranty", "non_warranty"]),
  requestType: z.enum(["installation", "warranty", "repair", "replacement", "inspection", "maintenance", "technical_support"]),
  complaint: text.min(5).max(1_000),
  notes: text.max(1_000).optional(),
  idempotencyKey: z.string().uuid(),
});

export const updateAftersalesCaseInput = z.object({
  caseId: id,
  status: z.enum(["diagnosed", "in_service", "awaiting_collection", "completed", "cancelled"]),
  resolution: text.min(5).max(1_000),
  notes: text.max(1_000).optional(),
  idempotencyKey: z.string().uuid(),
});

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
