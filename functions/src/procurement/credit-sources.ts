export interface SupplierCreditSources { cashAdvanceMinor: number; returnCreditMinor: number; legacyUnclassifiedMinor: number }
export type SupplierCreditSourceMap = Record<string, SupplierCreditSources>;
const fields = ["returnCreditMinor", "cashAdvanceMinor", "legacyUnclassifiedMinor"] as const;
const safe = (value: unknown) => { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Supplier credit provenance requires reconciliation."); return value as number; };
export function creditSources(total: number, recorded?: SupplierCreditSources): SupplierCreditSources {
  safe(total);
  if (!recorded) return { cashAdvanceMinor: 0, returnCreditMinor: 0, legacyUnclassifiedMinor: total };
  if (fields.reduce((sum, key) => sum + safe(recorded[key]), 0) !== total) throw new Error("Supplier credit source totals do not match the available credit.");
  return { ...recorded };
}
/** Explicit source policy: return credits first, then paid advances, then unclassified legacy credit. No journal changes. */
export function changeCreditSources(map: SupplierCreditSourceMap | undefined, key: string, before: number, delta: number, origin?: "cashAdvanceMinor" | "returnCreditMinor" | "legacyUnclassifiedMinor") {
  const next = creditSources(before, map?.[key]), used = { cashAdvanceMinor: 0, returnCreditMinor: 0, legacyUnclassifiedMinor: 0 };
  if (!Number.isSafeInteger(delta)) throw new Error("Invalid supplier credit movement.");
  if (delta >= 0) { if (!origin) throw new Error("Record the source of new supplier credit."); next[origin] = safe(next[origin] + delta); }
  else if (origin) { if (next[origin] < -delta) throw new Error("The original return credit has already been used or refunded. Reconcile it before reversing this return."); next[origin] += delta; used[origin] = -delta; }
  else {
    let remaining = -delta;
    for (const field of fields) { const take = Math.min(remaining, next[field]); next[field] -= take; used[field] += take; remaining -= take; }
    if (remaining) throw new Error("Insufficient supplier credit sources.");
  }
  creditSources(safe(before + delta), next);
  return { balances: { ...(map ?? {}), [key]: next }, used, remaining: next };
}
