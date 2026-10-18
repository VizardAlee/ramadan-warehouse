import { z } from "zod";
import { tenderTotalError, type MoneyTender } from "../accounting/money-tenders.js";

export const accountTenderInput = z.object({
  method: z.enum(["cash", "card", "bank_transfer"]),
  amountMinor: z.number().int().positive().safe(),
  bankAccountId: z.string().trim().min(1).max(180).optional(),
  reference: z.string().trim().max(160).optional(),
}).superRefine((value, context) => {
  if (value.method === "cash" && value.bankAccountId)
    context.addIssue({ code: "custom", path: ["bankAccountId"], message: "Cash cannot use a bank account." });
  if (value.method !== "cash" && (!value.bankAccountId || !value.reference || value.reference.length < 3))
    context.addIssue({ code: "custom", path: ["reference"], message: "Choose the actual company account and record its payment reference." });
});

export function refineAccountTenders(parts: MoneyTender[] | undefined, total: number, context: z.RefinementCtx) {
  if (!parts) return;
  const message = tenderTotalError(parts, total);
  if (message) context.addIssue({ code: "custom", path: ["tenders"], message });
}
