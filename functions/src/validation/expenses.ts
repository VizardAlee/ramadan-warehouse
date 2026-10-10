import { z } from "zod";

const id = z.string().trim().min(1).max(128).refine(value => !value.includes("/") && value !== "." && value !== "..", "Invalid record identifier.");
const optionalText = (max: number) => z.string().trim().max(max).optional();
const positiveMoney = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const expenseWorkspaceInput = z.object({
  branchId: id.optional(),
  warehouseId: id.optional(),
  limit: z.number().int().min(1).max(200).default(100),
}).superRefine((value, context) => {
  if (value.branchId && value.warehouseId)
    context.addIssue({ code: "custom", message: "Select a branch or warehouse context, not both." });
});

export const createExpenseInput = z.object({
  categoryName: z.string().trim().min(2).max(120),
  payeeName: z.string().trim().min(2).max(160),
  supplierId: id.optional(),
  independentObligationReference: z.string().trim().min(5).max(200).optional(),
  costPurpose: z.enum(["service", "logistics"]).optional(),
  costReferenceType: z.enum(["sale", "aftersales"]).optional(),
  costReferenceId: id.optional(),
  branchId: id.optional(),
  warehouseId: id.optional(),
  expenseDate: z.string().date(),
  dueDate: z.string().date().optional(),
  supplierDocumentNumber: optionalText(160),
  description: z.string().trim().min(3).max(500),
  netAmountMinor: positiveMoney,
  vatAmountMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  notes: optionalText(500),
  idempotencyKey: z.string().uuid(),
}).superRefine((value, context) => {
  if (Boolean(value.costReferenceType) !== Boolean(value.costReferenceId))
    context.addIssue({ code: "custom", path: ["costReferenceId"], message: "Provide both the linked record type and identifier." });
  if (value.costReferenceId && (!value.costPurpose || !value.branchId || value.warehouseId))
    context.addIssue({ code: "custom", path: ["branchId"], message: "Linked service/logistics costs require their store and purpose." });
  if (value.branchId && value.warehouseId)
    context.addIssue({ code: "custom", message: "Allocate an expense to a branch or warehouse, not both." });
  const gross = value.netAmountMinor + value.vatAmountMinor;
  if (!Number.isSafeInteger(gross) || gross <= 0)
    context.addIssue({ code: "custom", path: ["netAmountMinor"], message: "Expense total is invalid." });
});

export const expenseActionInput = z.object({
  expenseId: id,
  notes: optionalText(500),
  idempotencyKey: z.string().uuid(),
});

export const recordExpensePaymentInput = z.object({
  expenseId: id,
  method: z.enum(["cash", "card", "bank_transfer"]),
  bankAccountId: id.optional(),
  amountMinor: positiveMoney,
  reference: optionalText(160),
  paidAt: z.string().datetime(),
  notes: optionalText(500),
  idempotencyKey: z.string().uuid(),
}).superRefine((value, context) => {
  if (value.method !== "cash" && !value.bankAccountId)
    context.addIssue({ code: "custom", path: ["bankAccountId"], message: "Select the company bank account funding this payment." });
  if (value.method !== "cash" && !value.reference)
    context.addIssue({ code: "custom", path: ["reference"], message: "Record the external payment reference." });
});
