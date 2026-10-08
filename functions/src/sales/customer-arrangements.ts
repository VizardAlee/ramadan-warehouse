import { HttpsError } from "firebase-functions/v2/https";
import { moneyBalances } from "./receivables.js";

export interface CustomerArrangement {
  id: string;
  name: string;
  active: boolean;
  outstandingBalanceMinor: number;
}

// General is the residual of the existing customer balance. Never infer which
// new arrangement an old receipt or debt belonged to.
export function customerArrangements(data: { arrangements?: CustomerArrangement[]; outstandingBalanceMinor?: number }): CustomerArrangement[] {
  const named = data.arrangements ?? [];
  const total = data.outstandingBalanceMinor ?? 0;
  if (!Number.isSafeInteger(total) || total < 0 || named.length > 20 ||
    new Set(named.map((item) => item.id)).size !== named.length ||
    named.some((item) => item.id === "general" || !Number.isSafeInteger(item.outstandingBalanceMinor) || item.outstandingBalanceMinor < 0))
    throw new HttpsError("data-loss", "Customer account balances need review.");
  const allocated = named.reduce((sum, item) => sum + item.outstandingBalanceMinor, 0);
  if (!Number.isSafeInteger(allocated) || allocated > total)
    throw new HttpsError("data-loss", "Customer account balances do not match the customer total.");
  return [{ id: "general", name: "General account", active: true, outstandingBalanceMinor: total - allocated }, ...named.map((item) => ({ ...item }))];
}

export function selectedArrangement(data: Parameters<typeof customerArrangements>[0], id = "general", allowInactive = false) {
  const account = customerArrangements(data).find((item) => item.id === id);
  if (!account || (!account.active && !allowInactive))
    throw new HttpsError("failed-precondition", "Select an active account arrangement for this customer.");
  return account;
}

export function changeArrangementBalance(data: Parameters<typeof customerArrangements>[0], changes: Array<{ accountId: string; amountMinor: number }>) {
  const accounts = customerArrangements(data);
  for (const change of changes) {
    const account = accounts.find((item) => item.id === change.accountId);
    if (!account) throw new HttpsError("invalid-argument", "The selected customer account does not exist.");
    const next = account.outstandingBalanceMinor + change.amountMinor;
    if (!Number.isSafeInteger(next) || next < 0)
      throw new HttpsError("failed-precondition", `The amount exceeds the outstanding balance on ${account.name}.`);
    account.outstandingBalanceMinor = next;
  }
  return accounts.filter((item) => item.id !== "general");
}

export function upsertArrangement(data: Parameters<typeof customerArrangements>[0] & { advanceBalances?: unknown }, input: { id: string; name: string; active: boolean }) {
  const named = customerArrangements(data).filter((item) => item.id !== "general");
  const current = named.find((item) => item.id === input.id);
  if ((!current && named.length >= 20) || named.some((item) => item.id !== input.id && item.name.toLowerCase() === input.name.toLowerCase()))
    throw new HttpsError("failed-precondition", "Use a unique account name; a customer can have up to 20 named arrangements.");
  if (!input.active && ((current?.outstandingBalanceMinor ?? 0) > 0 || (moneyBalances(data.advanceBalances)[input.id] ?? 0) > 0))
    throw new HttpsError("failed-precondition", "Settle this account before deactivating it.");
  const saved = { ...input, outstandingBalanceMinor: current?.outstandingBalanceMinor ?? 0 };
  return current ? named.map((item) => item.id === input.id ? saved : item) : [...named, saved];
}
