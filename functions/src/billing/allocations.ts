import { serviceReceiptVat } from "../services/billing.js";

export interface BillingAccount { id: string; code: string; name: string }
export interface BillingMapping { version: number; deferredService: BillingAccount; providerPayable: BillingAccount }
export interface BillingComponent {
  id: string; kind: "goods" | "service" | "provider";
  grossMinor: number; vatMinor: number; creditedGrossMinor: number; creditedVatMinor: number;
  paidMinor: number; epochBaseMinor: number; epochWeightMinor: number;
  aftersalesCaseId?: string;
  supplierId?: string; supplierName?: string; settledMinor?: number;
}
export interface MixedBilling { version: 1; mapping: BillingMapping; components: BillingComponent[]; epochReceivedMinor: number; paidMinor: number }
export interface BillingJournalLine { accountCode: string; accountId?: string; accountName: string; debitMinor: number; creditMinor: number }
const safe = (value: number) => { if (!Number.isSafeInteger(value) || value < 0) throw new Error("Billing amounts require non-negative safe minor units."); return value; };
const sum = (values: number[]) => safe(values.reduce((a, b) => a + safe(b), 0));
export const remainingCharge = (component: BillingComponent) => safe(component.grossMinor - component.creditedGrossMinor);
export function validateBilling(state: MixedBilling) {
  if (state.version !== 1 || !state.components.length || state.components.length > 100 || new Set(state.components.map(c => c.id)).size !== state.components.length) throw new Error("Mixed billing evidence requires reconciliation.");
  safe(state.epochReceivedMinor); safe(state.paidMinor);
  for (const c of state.components) {
    if (!["goods", "service", "provider"].includes(c.kind)) throw new Error("Unknown billing component.");
    [c.grossMinor, c.vatMinor, c.creditedGrossMinor, c.creditedVatMinor, c.paidMinor, c.epochBaseMinor, c.epochWeightMinor].forEach(safe);
    if (c.vatMinor > c.grossMinor || c.creditedVatMinor > c.vatMinor || c.creditedVatMinor > c.creditedGrossMinor || c.grossMinor - c.vatMinor < c.creditedGrossMinor - c.creditedVatMinor || c.paidMinor > remainingCharge(c) || c.epochBaseMinor > c.paidMinor || c.epochBaseMinor + c.epochWeightMinor !== remainingCharge(c)) throw new Error("Billing component amounts require reconciliation.");
    if (c.kind === "provider" && (c.vatMinor || !c.supplierId || !c.supplierName || safe(c.settledMinor ?? 0) > remainingCharge(c))) throw new Error("Provider funds require reconciliation.");
  }
  if (sum(state.components.map(c => c.paidMinor)) !== state.paidMinor) throw new Error("Billing payment evidence does not reconcile.");
  const allocated = allocateMinor(state.components.map(c => c.epochWeightMinor), state.epochReceivedMinor);
  if (state.components.some((c, i) => c.paidMinor !== c.epochBaseMinor + allocated[i]!)) throw new Error("Billing allocation evidence does not reconcile.");
  return state;
}
/** Highest averages (D'Hondt), with stable component-order ties. Every additional
 * minor unit takes the next largest weight/(allocated+1), so no line loses paid
 * funds. Quota floors include only priorities >= total/amount; fewer than n
 * remaining seats are selected exactly with BigInt cross products. */
export function allocateMinor(weights: number[], amount: number): number[] {
  const total = sum(weights); safe(amount);
  if (amount > total) throw new Error("The allocated amount exceeds the remaining charge.");
  if (!total) return weights.map(() => 0);
  const allocation = weights.map(weight => Number(BigInt(weight) * BigInt(amount) / BigInt(total)));
  let remainder = amount - sum(allocation);
  while (remainder-- > 0) {
    let best = -1;
    for (let i = 0; i < weights.length; i++) {
      if (allocation[i]! >= weights[i]!) continue;
      if (best < 0 || BigInt(weights[i]!) * BigInt(allocation[best]! + 1) > BigInt(weights[best]!) * BigInt(allocation[i]! + 1)) best = i;
    }
    if (best < 0) throw new Error("Billing allocation exhausted its charge weights.");
    allocation[best]!++;
  }
  return allocation;
}
export function createBilling(mapping: BillingMapping, input: Array<Omit<BillingComponent, "creditedGrossMinor" | "creditedVatMinor" | "epochBaseMinor" | "epochWeightMinor">>, receivedMinor: number): MixedBilling {
  const components = input.map(c => ({ ...c, creditedGrossMinor: 0, creditedVatMinor: 0, epochBaseMinor: c.paidMinor, epochWeightMinor: safe(c.grossMinor - c.paidMinor) }));
  const state: MixedBilling = { version: 1, mapping, components, epochReceivedMinor: 0, paidMinor: sum(components.map(c => c.paidMinor)) };
  validateBilling(state); return receiveBilling(state, receivedMinor);
}
export function receiveBilling(before: MixedBilling, amount: number): MixedBilling {
  validateBilling(before); safe(amount);
  const state = structuredClone(before); state.epochReceivedMinor = safe(state.epochReceivedMinor + amount);
  const allocation = allocateMinor(state.components.map(c => c.epochWeightMinor), state.epochReceivedMinor);
  state.components.forEach((c, i) => { c.paidMinor = safe(c.epochBaseMinor + allocation[i]!); });
  state.paidMinor = safe(state.paidMinor + amount); return validateBilling(state);
}
/** A commercial credit changes charges; a receipt correction only returns funds. */
export function creditBilling(before: MixedBilling, credits: Array<{ id: string; grossMinor: number; vatMinor: number }>, refundMinor: number): MixedBilling {
  validateBilling(before); safe(refundMinor);
  if (refundMinor > before.paidMinor || new Set(credits.map(c => c.id)).size !== credits.length) throw new Error("Invalid billing refund or duplicate credit.");
  const state = structuredClone(before);
  for (const credit of credits) {
    const c = state.components.find(c => c.id === credit.id); if (!c) throw new Error("The credited charge is not on this invoice.");
    safe(credit.grossMinor); safe(credit.vatMinor);
    c.creditedGrossMinor = safe(c.creditedGrossMinor + credit.grossMinor); c.creditedVatMinor = safe(c.creditedVatMinor + credit.vatMinor);
    if (c.creditedGrossMinor > c.grossMinor || c.creditedVatMinor > c.vatMinor || credit.vatMinor > credit.grossMinor || (c.kind === "provider" && safe(c.settledMinor ?? 0) > remainingCharge(c))) throw new Error("Recover settled provider funds before crediting this obligation.");
  }
  let released = 0;
  for (const c of state.components) { const kept = Math.min(c.paidMinor, remainingCharge(c)); released += c.paidMinor - kept; c.paidMinor = kept; }
  const extraRefund = Math.max(0, refundMinor - released);
  if (extraRefund) { const removed = allocateMinor(state.components.map(c => c.paidMinor), extraRefund); state.components.forEach((c, i) => { c.paidMinor -= removed[i]!; }); }
  const reallocated = allocateMinor(state.components.map(c => remainingCharge(c) - c.paidMinor), Math.max(0, released - refundMinor));
  state.components.forEach((c, i) => { c.paidMinor = safe(c.paidMinor + reallocated[i]!); c.epochBaseMinor = c.paidMinor; c.epochWeightMinor = safe(remainingCharge(c) - c.paidMinor); });
  state.epochReceivedMinor = 0; state.paidMinor = safe(before.paidMinor - refundMinor); return validateBilling(state);
}
export function serviceBalances(state: MixedBilling) {
  validateBilling(state); let deferred = 0, income = 0, vat = 0;
  for (const c of state.components.filter(c => c.kind === "service")) {
    const gross = remainingCharge(c), tax = c.vatMinor - c.creditedVatMinor;
    const recognizedVat = gross ? serviceReceiptVat(0, c.paidMinor, gross, tax) : 0;
    deferred = safe(deferred + gross - c.paidMinor); income = safe(income + c.paidMinor - recognizedVat); vat = safe(vat + recognizedVat);
  }
  return { deferred, income, vat };
}
export function serviceBalanceDelta(before: MixedBilling | null, after: MixedBilling): BillingJournalLine[] {
  const previous = before ? serviceBalances(before) : { deferred: 0, income: 0, vat: 0 }, next = serviceBalances(after);
  const accounts = [{ key: "deferred" as const, accountCode: after.mapping.deferredService.code, accountId: after.mapping.deferredService.id, accountName: after.mapping.deferredService.name }, { key: "income" as const, accountCode: "4100", accountName: "Service income" }, { key: "vat" as const, accountCode: "2100", accountName: "Output VAT payable" }];
  return accounts.flatMap(({ key, ...account }) => { const change = next[key] - previous[key]; return change ? [{ ...account, debitMinor: Math.max(0, -change), creditMinor: Math.max(0, change) }] : []; });
}
