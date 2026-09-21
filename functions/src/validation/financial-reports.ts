import { z } from "zod";

export const financialReportInput = z.object({
  reportType: z.enum([
    "trial_balance",
    "income_statement",
    "balance_sheet",
    "cash_flow",
  ]),
  fromDate: z.string().date(),
  toDate: z.string().date(),
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
}).superRefine((value, context) => {
  if (value.fromDate > value.toDate)
    context.addIssue({
      code: "custom",
      path: ["toDate"],
      message: "The tax period end date cannot be before its start date.",
    });
});
