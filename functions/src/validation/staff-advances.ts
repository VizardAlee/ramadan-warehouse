import { z } from "zod";
const id = z.string().regex(/^[A-Za-z0-9_:-]{1,180}$/);
const common = { amountMinor: z.number().int().positive().safe(), reason: z.string().trim().min(5).max(500), idempotencyKey: z.string().uuid() };
const movement = { ...common, method: z.enum(["cash", "bank_transfer"]), bankAccountId: id.optional(), reference: z.string().trim().min(3).max(160) };
export const staffAdvanceInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("locations"), cursorId: id.optional() }).strict(),
  z.object({ action: z.literal("accounts"), branchId: id, cursorId: id.optional() }).strict(),
  z.object({ action: z.literal("workspace"), branchId: id, cursorId: id.optional() }).strict(),
  z.object({ action: z.literal("detail"), advanceId: id, cursorId: id.optional() }).strict(),
  z.object({ action: z.literal("issue"), branchId: id, recipientName: z.string().trim().min(2).max(120), recipientType: z.enum(["staff", "driver"]), purpose: z.string().trim().min(5).max(500), ...movement }).strict(),
  z.object({ action: z.literal("return"), advanceId: id, ...movement }).strict(),
  z.object({ action: z.literal("retire"), advanceId: id, ...common, receiptReference: z.string().trim().min(3).max(160) }).strict(),
]).superRefine((input, ctx) => {
  if (input.action === "issue" || input.action === "return") {
    if (input.method === "bank_transfer" && !input.bankAccountId) ctx.addIssue({ code: "custom", path: ["bankAccountId"], message: "Select the actual company bank account." });
    if (input.method === "cash" && input.bankAccountId) ctx.addIssue({ code: "custom", path: ["bankAccountId"], message: "Cash must not specify a bank account." });
  }
});
