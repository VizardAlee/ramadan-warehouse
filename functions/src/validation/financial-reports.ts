import { z } from "zod";
import { taxRuleDocumentId } from "../tax/rules.js";

export const financialReportInput = z.object({
  reportType: z.enum([
    "trial_balance",
    "income_statement",
    "balance_sheet",
    "cash_flow",
    "receipts_payments",
  ]),
  fromDate: z.string().date(),
  toDate: z.string().date(),
  branchId: z.string().trim().min(1).max(128).optional(),
}).superRefine((value, context) => {
  if (value.fromDate > value.toDate)
    context.addIssue({
      code: "custom",
      path: ["toDate"],
      message: "The report end date cannot be before its start date.",
    });
});

export const taxWorkspaceInput = z.object({
  fromDate: z.string().date(),
  toDate: z.string().date(),
  rulePageSize: z.union([z.literal(25), z.literal(50), z.literal(100)]).default(25),
  ruleCursorId: taxRuleDocumentId.optional(),
}).superRefine((value, context) => {
  if (value.fromDate > value.toDate)
    context.addIssue({
      code: "custom",
      path: ["toDate"],
      message: "The tax period end date cannot be before its start date.",
    });
});
