import { z } from "zod";

const date = z.string().date();

export const bankWorkspaceInput = z.object({
  bankAccountId: z.string().trim().min(1).max(180).optional(),
});

export const saveBankAccountInput = z.object({
  bankAccountId: z.string().trim().min(1).max(180).optional(),
  bankName: z.string().trim().min(2).max(120),
  accountName: z.string().trim().min(2).max(160),
  accountNumberLast4: z.string().regex(/^\d{4}$/),
  ledgerAccountCode: z.string().regex(/^10\d{2}$/).default("1030"),
  openingBalanceMinor: z.number().int().safe(),
  openingDate: date,
  active: z.boolean().default(true),
});

export const importBankStatementInput = z.object({
  bankAccountId: z.string().trim().min(1).max(180),
  rows: z.array(z.object({
    transactionDate: date,
    description: z.string().trim().min(2).max(300),
    reference: z.string().trim().max(160).optional(),
    externalId: z.string().trim().max(160).optional(),
    amountMinor: z.number().int().safe().refine((value) => value !== 0, "Amount cannot be zero."),
  })).min(1).max(200),
  idempotencyKey: z.string().uuid(),
});

export const bankMatchInput = z.object({
  statementTransactionId: z.string().trim().min(1).max(180),
  journalLineId: z.string().trim().min(1).max(180),
  idempotencyKey: z.string().uuid(),
});

export const bankUnmatchInput = z.object({
  statementTransactionId: z.string().trim().min(1).max(180),
  idempotencyKey: z.string().uuid(),
});

export const prepareBankReconciliationInput = z.object({
  bankAccountId: z.string().trim().min(1).max(180),
  periodStart: date,
  periodEnd: date,
  openingBalanceMinor: z.number().int().safe(),
  closingBalanceMinor: z.number().int().safe(),
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().uuid(),
}).refine((value) => value.periodEnd >= value.periodStart, {
  path: ["periodEnd"],
  message: "The period end cannot precede the period start.",
});

export const completeBankReconciliationInput = z.object({
  reconciliationId: z.string().trim().min(1).max(180),
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().uuid(),
});
