import { z } from "zod";

export const dailyCloseWorkspaceInput = z.object({
  branchId: z.string().trim().min(1).max(128),
  date: z.iso.date(),
});
export const dailyCloseQueryInput = z.preprocess((value) => value && typeof value === "object"
  ? { action: "evidence", ...value } : value, z.discriminatedUnion("action", [
  dailyCloseWorkspaceInput.extend({ action: z.literal("evidence") }),
  z.object({ action: z.literal("locations"), cursor: z.string().min(1).max(128).optional() }),
]));
export const prepareDailyCloseInput = dailyCloseWorkspaceInput.extend({
  countedCashMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  explanation: z.string().trim().max(1000).default(""),
  evidenceHash: z.string().regex(/^[a-f0-9]{64}$/),
  idempotencyKey: z.string().uuid(),
});
export const signDailyCloseInput = dailyCloseWorkspaceInput.extend({
  version: z.number().int().positive(),
  notes: z.string().trim().max(1000).default(""),
  idempotencyKey: z.string().uuid(),
});
