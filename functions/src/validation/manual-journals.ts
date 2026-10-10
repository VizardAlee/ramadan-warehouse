import { z } from "zod";

const id = z.string().trim().min(1).max(180).refine(value => !value.includes("/"), "Invalid reference.");
const money = z.number().int().nonnegative().safe();
const common = {
  branchId: id,
  effectiveAt: z.string().datetime(),
  reference: z.string().trim().min(2).max(160),
  reason: z.string().trim().min(5).max(500),
  idempotencyKey: z.string().uuid(),
};
export const manualJournalInput = z.object({
  action: z.literal("post"), ...common,
  purpose: z.enum(["opening_balance", "accrual", "depreciation", "year_end", "accountant_adjustment"]),
  cashFlowActivity: z.enum(["operating", "investing", "financing"]),
  lines: z.array(z.object({ accountId: id, debitMinor: money, creditMinor: money, bankAccountId: id.optional() }))
    .min(2).max(40),
}).superRefine((value, context) => {
  let debit = 0, credit = 0;
  for (const [index, line] of value.lines.entries()) {
    if ((line.debitMinor === 0) === (line.creditMinor === 0)) context.addIssue({ code: "custom", path: ["lines", index], message: "Enter one positive debit or credit, not both." });
    debit += line.debitMinor; credit += line.creditMinor;
  }
  if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit) || debit !== credit)
    context.addIssue({ code: "custom", path: ["lines"], message: "Safe debit and credit totals must balance." });
});
export const reverseManualJournalInput = z.object({ action: z.literal("reverse"), ...common, journalEntryId: id });
export const journalWorkspaceInput = z.object({
  action: z.literal("workspace"), branchId: id.optional(),
  fromDate: z.string().date(), toDate: z.string().date(),
  pageSize: z.union([z.literal(25), z.literal(50), z.literal(100)]).default(25),
  cursorId: id.optional(),
}).refine(value => value.fromDate <= value.toDate, "The end date cannot precede the start date.");
export const saveLedgerAccountInput = z.object({
  action: z.literal("save_account"), code: z.string().regex(/^[1-9]\d{3}$/),
  name: z.string().trim().min(2).max(160), active: z.boolean(),
  reason: z.string().trim().min(5).max(500), idempotencyKey: z.string().uuid(),
});
export const accountingJournalInput = z.union([manualJournalInput, reverseManualJournalInput, journalWorkspaceInput, saveLedgerAccountInput,
  z.object({ action: z.literal("detail"), journalEntryId: id })]);

// These balances belong to operational subledgers. An arbitrary manual journal
// must not change inventory, customer/supplier positions or statutory tax evidence.
export function isOperationalControlCode(code: string) {
  return /^(11|12|13|20|21|22|23)\d{2}$/.test(code) || ["3100", "3999", "5200"].includes(code);
}
export function canConfigureManualAccount(code: string) {
  return /^[1-9]\d{3}$/.test(code) && !/^10\d{2}$/.test(code) && !isOperationalControlCode(code)
    && !["4000", "4100", "5000", "5010", "6000"].includes(code);
}
