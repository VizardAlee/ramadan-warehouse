import { HttpsError } from "firebase-functions/v2/https";

export const UNDATED_DEBT = "9999-12-31";
export function moneyBalances(value: unknown): Record<string, number> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpsError("data-loss", "Account balances need reconciliation.");
  const entries = Object.entries(value);
  if (entries.length > 21 || entries.some(([, amount]) => !Number.isSafeInteger(amount) || Number(amount) < 0))
    throw new HttpsError("data-loss", "Account balances need reconciliation.");
  return Object.fromEntries(entries) as Record<string, number>;
}
export function changeMoneyBalance(value: unknown, accountId: string, delta: number) {
  const balances = moneyBalances(value);
  const next = (balances[accountId] ?? 0) + delta;
  if (!Number.isSafeInteger(next) || next < 0) throw new HttpsError("failed-precondition", "The account has insufficient balance for this allocation.");
  balances[accountId] = next;
  return balances;
}
export function legacyDebt(accountOutstanding: number, tracked: unknown, accountId: string) {
  const remaining = accountOutstanding - (moneyBalances(tracked)[accountId] ?? 0);
  if (!Number.isSafeInteger(remaining) || remaining < 0) throw new HttpsError("data-loss", "Invoice balances need reconciliation.");
  return remaining;
}
export function reduceInvoice(outstanding: number, amount: number) {
  if (!Number.isSafeInteger(outstanding) || !Number.isSafeInteger(amount) || amount <= 0 || outstanding < amount)
    throw new HttpsError("failed-precondition", "The allocation exceeds this invoice's unpaid balance.");
  return { receivableOutstandingMinor: outstanding - amount, receivableStatus: outstanding === amount ? "settled" : "open" };
}
