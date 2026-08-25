import { z } from "zod";

export const accountingCloseWorkspaceInput = z.object({
  periodKey: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});

export const prepareAccountingCloseInput = accountingCloseWorkspaceInput.extend({
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().uuid(),
});

export const completeAccountingCloseInput = z.object({
  accountingPeriodId: z.string().trim().min(1).max(180),
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().uuid(),
});
