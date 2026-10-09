import { describe, expect, it } from "vitest";
import { serviceChargeVat, serviceReceiptVat } from "../functions/src/services/billing";
describe("catalogue service receipt allocations", () => {
  it("separates only the configured VAT and allocates partial receipts cumulatively", () => {
    expect(serviceChargeVat(10750, 750)).toBe(750);
    expect(serviceChargeVat(10750, 0)).toBe(0);
    expect(serviceChargeVat(0, 750)).toBe(0);
    let paid = 0, vat = 0;
    for (const amount of [1, 1455, 2000, 7294]) {
      const slice = serviceReceiptVat(paid, amount, 10750, 750);
      expect(slice).toBeGreaterThanOrEqual(0); expect(slice).toBeLessThanOrEqual(amount);
      paid += amount; vat += slice;
    }
    expect(paid).toBe(10750); expect(vat).toBe(750);
  });
  it("keeps kobo exact at large values and rejects invalid balances/rates", () => {
    expect(serviceChargeVat(Number.MAX_SAFE_INTEGER, 10000)).toBe(4503599627370496);
    for (const rate of [-1, 10001, NaN, 7.5]) expect(() => serviceChargeVat(100, rate)).toThrow();
    expect(() => serviceReceiptVat(100, 1, 100, 5)).toThrow();
    expect(() => serviceReceiptVat(0, 1, 100, 101)).toThrow();
    expect(() => serviceReceiptVat(0, 1, 0, 0)).toThrow();
  });
});
