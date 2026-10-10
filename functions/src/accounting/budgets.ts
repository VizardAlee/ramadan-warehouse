import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).refine(value => Number(value.slice(0, 4)) >= 2000 && Number(value.slice(0, 4)) <= 2199);
const operatingContext = z.object({ type: z.enum(["branch", "warehouse"]), id }).strict().optional();
export const budgetInput = z.discriminatedUnion("action", [
  z.object({ operatingContext, action: z.literal("workspace"), month, branchId: id.optional(), pageSize: z.union([z.literal(25), z.literal(50), z.literal(100)]).default(25), cursorId: id.optional() }).strict(),
  z.object({ operatingContext, action: z.literal("comparison"), fromMonth: month, toMonth: month, branchId: id.optional() }).strict().refine(value => value.fromMonth <= value.toMonth && budgetMonths(value.fromMonth, value.toMonth).length <= 12, { message: "Choose an ordered range of no more than 12 months." }),
  z.object({ operatingContext, action: z.literal("save"), month, branchId: id.optional(), accountId: id, amountMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), expectedVersion: z.number().int().nonnegative().max(1_000_000), reason: z.string().trim().min(10).max(1000), idempotencyKey: z.uuid() }).strict(),
  z.object({ operatingContext, action: z.literal("history"), budgetId: id, cursorId: id.optional() }).strict(),
]).transform(input => { const values = { ...input }; delete values.operatingContext; return values; });
export function budgetMonthDates(month: string) {
  const [year, value] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year!, value!, 0)).getUTCDate();
  return { fromDate: `${month}-01`, toDate: `${month}-${String(last).padStart(2, "0")}` };
}
export function budgetVariance(accountCode: string, budgetMinor: number, debitMinor: number, creditMinor: number) {
  if (!/^[4-9]\d{3}$/.test(accountCode) || [budgetMinor, debitMinor, creditMinor].some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error("Invalid budget or ledger amount.");
  const income = accountCode.startsWith("4");
  const actualMinor = income ? creditMinor - debitMinor : debitMinor - creditMinor;
  const varianceMinor = income ? actualMinor - budgetMinor : budgetMinor - actualMinor;
  if (![actualMinor, varianceMinor].every(Number.isSafeInteger)) throw new Error("Budget variance exceeds safe minor-unit arithmetic.");
  return { actualMinor, varianceMinor, variancePercent: budgetMinor ? varianceMinor / budgetMinor * 100 : null, favorable: varianceMinor >= 0, kind: income ? "Income" : "Expense" };
}

/** Calendar months, independent of host timezone; comparisons never invent targets. */
export function budgetMonths(fromMonth: string, toMonth: string): string[] {
  const months: string[] = [];
  let year = Number(fromMonth.slice(0, 4)), month = Number(fromMonth.slice(5));
  while (`${year}-${String(month).padStart(2, "0")}` <= toMonth && months.length <= 12) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    if (++month === 13) { year++; month = 1; }
  }
  return months;
}
