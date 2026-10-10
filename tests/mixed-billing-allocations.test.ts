import { describe, expect, it } from "vitest";
import { allocateMinor, createBilling, creditBilling, receiveBilling, serviceBalanceDelta, serviceBalances, type BillingMapping } from "../functions/src/billing/allocations";
import { calculateSale } from "../functions/src/sales/calculations";
const mapping: BillingMapping = { version: 1, deferredService: { id: "reviewed-service", code: "2401", name: "Test-only service control" }, providerPayable: { id: "reviewed-provider", code: "2402", name: "Test-only provider control" } };
const components = [{ id: "goods", kind: "goods" as const, grossMinor: 1075, vatMinor: 75, paidMinor: 0 }, { id: "service", kind: "service" as const, grossMinor: 1075, vatMinor: 75, paidMinor: 0 }, { id: "provider", kind: "provider" as const, grossMinor: 500, vatMinor: 0, paidMinor: 0, supplierId: "provider", supplierName: "Test provider", settledMinor: 0 }];
describe("mixed billing cumulative allocation", () => {
  it("never removes earlier allocations on uneven minor-unit receipts", () => {
    expect(allocateMinor([2, 1, 2], 2)).toEqual([1, 0, 1]);
    for (let x = 0; x <= 8; x++) for (let y = 0; y <= 8; y++) for (let z = 0; z <= 8; z++) {
      const weights = [x, y, z], total = x + y + z;
      let before = [0, 0, 0];
      for (let amount = 0; amount <= total; amount++) {
        const next = allocateMinor(weights, amount);
        expect(next.reduce((a, b) => a + b, 0)).toBe(amount);
        next.forEach((value, i) => { expect(value).toBeGreaterThanOrEqual(before[i]!); expect(value).toBeLessThanOrEqual(weights[i]!); });
        before = next;
      }
      expect(before).toEqual(weights);
    }
  });
  it("matches a literal priority schedule including ties", () => {
    for (const weights of [[2, 1, 2], [1, 3, 7, 0], [17, 4, 2, 23]]) {
      const expected = weights.map(() => 0);
      for (let amount = 1; amount <= weights.reduce((a, b) => a + b, 0); amount++) {
        let best = -1;
        weights.forEach((weight, i) => { if (expected[i]! < weight && (best < 0 || BigInt(weight) * BigInt(expected[best]! + 1) > BigInt(weights[best]!) * BigInt(expected[i]! + 1))) best = i; });
        expected[best]!++; expect(allocateMinor(weights, amount)).toEqual(expected);
      }
    }
  });
  it("conserves safe large amounts without Number multiplication or iteration per kobo", () => {
    const weights = [4_000_000_000_000_001, 3_000_000_000_000_003, 1_000_000_000_000_001];
    const a = allocateMinor(weights, 6_000_000_000_000_001), b = allocateMinor(weights, 6_000_000_000_000_002);
    expect(a.reduce((x, y) => x + y, 0)).toBe(6_000_000_000_000_001); b.forEach((v, i) => expect(v).toBeGreaterThanOrEqual(a[i]!));
  });
  it("keeps split receipts identical to one receipt and fully settles residual VAT", () => {
    const start = createBilling(mapping, components, 0), single = receiveBilling(start, 1327), split = receiveBilling(receiveBilling(start, 1), 1326);
    expect(split).toEqual(single); expect(receiveBilling(single, 1323).components.map(c => c.paidMinor)).toEqual([1075, 1075, 500]);
    expect(serviceBalances(receiveBilling(single, 1323))).toEqual({ deferred: 0, income: 1000, vat: 75 });
    expect(serviceBalanceDelta(start, single).reduce((sum, l) => sum + l.creditMinor - l.debitMinor, 0)).toBe(0);
  });
  it("reallocates credited paid goods to remaining services without inventing cash", () => {
    const state = createBilling(mapping, components.slice(0, 2), 1075);
    const after = creditBilling(state, [{ id: "goods", grossMinor: 1075, vatMinor: 75 }], 0);
    expect(after.paidMinor).toBe(1075); expect(serviceBalances(after)).toEqual({ deferred: 0, income: 1000, vat: 75 });
    expect(() => creditBilling(after, [{ id: "service", grossMinor: 1075, vatMinor: 75 }], 0)).toThrow();
  });
  it("service credits and receipt corrections reverse recognition without restocking", () => {
    const state = createBilling(mapping, components.slice(1, 2), 500);
    const corrected = creditBilling(state, [], 100); expect(corrected.paidMinor).toBe(400); expect(serviceBalances(corrected).deferred).toBe(675);
    const cancelled = creditBilling(state, [{ id: "service", grossMinor: 1075, vatMinor: 75 }], 500);
    expect(serviceBalances(cancelled)).toEqual({ deferred: 0, income: 0, vat: 0 });
    expect(serviceBalanceDelta(state, cancelled).reduce((sum, l) => sum + l.debitMinor - l.creditMinor, 0)).toBe(1075);
  });
  it("requires recovery before crediting settled provider funds", () => {
    const state = createBilling(mapping, [{ ...components[2]!, settledMinor: 300 }], 500);
    expect(() => creditBilling(state, [{ id: "provider", grossMinor: 300, vatMinor: 0 }], 300)).toThrow(/Recover/);
  });
  it("carries original service receipts as a fixed base", () => {
    const state = createBilling(mapping, [{ ...components[1]!, paidMinor: 537 }, components[0]!], 1);
    expect(state.components[0]!.paidMinor).toBeGreaterThanOrEqual(537); expect(state.paidMinor).toBe(538);
  });
  it("keeps immutable linked VAT and discounts only other company lines", () => {
    const result = calculateSale([{ quantity: 1, unitPriceMinor: 3, vatRateBasisPoints: 10000, unitCostMinor: 0, fixedGrossMinor: 7, fixedVatMinor: 4 }, { quantity: 2, unitPriceMinor: 100, vatRateBasisPoints: 0, unitCostMinor: 0 }], 10);
    expect(result.lines[0]!.grossAmountMinor).toBe(7); expect(result.lines[0]!.vatAmountMinor).toBe(4); expect(result.grossAmountMinor).toBe(197);
    expect(() => calculateSale([{ quantity: 1, unitPriceMinor: 3, vatRateBasisPoints: 10000, unitCostMinor: 0, fixedGrossMinor: 7, fixedVatMinor: 4 }], 1)).toThrow();
  });
});
