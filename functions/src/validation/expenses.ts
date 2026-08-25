import { z } from "zod";

const id = z.string().trim().min(1).max(128);
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
  amountMinor: positiveMoney,
  reference: optionalText(160),
  paidAt: z.string().datetime(),
  notes: optionalText(500),
  idempotencyKey: z.string().uuid(),
}).superRefine((value, context) => {
  if (value.method !== "cash" && !value.reference)
    context.addIssue({ code: "custom", path: ["reference"], message: "Record the external payment reference." });
});
