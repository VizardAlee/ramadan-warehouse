import { describe, expect, it } from "vitest";
import { serviceChargeVat, serviceReceiptVat, serviceRefundVat } from "../functions/src/services/billing";
import { refundAftersalesPaymentInput, updateAftersalesCaseInput } from "../functions/src/validation/aftersales";
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
  it("refunds cumulative VAT exactly and permits subsequent corrected receipts", () => {
    let paid = 10750, vat = 750;
    for (const amount of [1, 1455, 2000, 7294]) {
      const reversed = serviceRefundVat(paid, amount, 10750, 750);
      expect(reversed).toBeGreaterThanOrEqual(0); expect(reversed).toBeLessThanOrEqual(amount);
      paid -= amount; vat -= reversed;
      expect(vat).toBe(serviceReceiptVat(0, paid, 10750, 750));
    }
    expect(paid).toBe(0); expect(vat).toBe(0);
    expect(serviceReceiptVat(paid, 10750, 10750, 750)).toBe(750);
    for (const amount of [0, -1, 101, 1.5, NaN]) expect(() => serviceRefundVat(100, amount, 100, 5)).toThrow();
  });
  it("accepts validated browser store context without including it in saved financial instructions", () => {
    const context = { type: "branch", id: "store" };
    const refund = { action: "refund", caseId: "case", originalPaymentId: "receipt", method: "cash", amountMinor: 100, reason: "Correct the original receipt", idempotencyKey: crypto.randomUUID() };
    expect(refundAftersalesPaymentInput.parse({ ...refund, operatingContext: context })).toEqual(refund);
    expect(refundAftersalesPaymentInput.safeParse({ ...refund, operatingContext: { type: "unknown", id: "store" } }).success).toBe(false);
    expect(refundAftersalesPaymentInput.safeParse({ ...refund, bankAccountId: "foreign/record" }).success).toBe(false);
    expect(refundAftersalesPaymentInput.safeParse({ ...refund, amountMinor: 0 }).success).toBe(false);
    expect(refundAftersalesPaymentInput.safeParse({ ...refund, method: "bank_transfer" }).success).toBe(false);
    expect(refundAftersalesPaymentInput.safeParse({ ...refund, overridePermissions: true }).success).toBe(false);
    const assignment = { action: "assign_staff", caseId: "case", staffId: "TECH-01", reason: "Assign service technician", idempotencyKey: crypto.randomUUID() };
    expect(updateAftersalesCaseInput.parse({ ...assignment, operatingContext: context })).toEqual(assignment);
  });
});
