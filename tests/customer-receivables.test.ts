import { describe, expect, it } from "vitest";
import { changeMoneyBalance, legacyDebt, moneyBalances, reduceInvoice } from "../functions/src/sales/receivables";
import { customerPaymentInput } from "../functions/src/validation/sales";
import { upsertArrangement } from "../functions/src/sales/customer-arrangements";

describe("invoice repayment and advance controls", () => {
  it("keeps legacy debt explicit and rejects inconsistent projections", () => {
    expect(legacyDebt(500, undefined, "general")).toBe(500);
    expect(legacyDebt(500, { general: 300 }, "general")).toBe(200);
    expect(() => legacyDebt(200, { general: 300 }, "general")).toThrow(/reconciliation/);
    expect(() => moneyBalances({ general: -1 })).toThrow(/reconciliation/);
    expect(() => moneyBalances({ general: 1.1 })).toThrow(/reconciliation/);
  });
  it("updates projections without altering input or creating negative balances", () => {
    const previous = { general: 500 };
    expect(changeMoneyBalance(previous, "general", -300)).toEqual({ general: 200 });
    expect(previous.general).toBe(500);
    expect(() => changeMoneyBalance(previous, "general", -501)).toThrow(/insufficient/);
    expect(reduceInvoice(500, 300)).toEqual({ receivableOutstandingMinor: 200, receivableStatus: "open" });
    expect(reduceInvoice(200, 200).receivableStatus).toBe("settled");
    expect(() => reduceInvoice(100, 101)).toThrow(/unpaid balance/);
    expect(() => reduceInvoice(100, 0)).toThrow();
  });
  it("rejects duplicate invoices, oversubscribed payments and fake advance receipts", () => {
    const base = { customerId: "customer", branchId: "branch", method: "cash", amountMinor: 100, idempotencyKey: crypto.randomUUID() };
    const invoice = { saleId: "sale", amountMinor: 60 };
    expect(customerPaymentInput.safeParse({ ...base, invoiceAllocations: [invoice] }).success).toBe(true);
    expect(customerPaymentInput.safeParse({ ...base, invoiceAllocations: [invoice, invoice] }).success).toBe(false);
    expect(customerPaymentInput.safeParse({ ...base, invoiceAllocations: [{ ...invoice, amountMinor: 101 }] }).success).toBe(false);
    expect(customerPaymentInput.safeParse({ ...base, purpose: "advance", source: "advance_balance" }).success).toBe(false);
    expect(customerPaymentInput.safeParse({ ...base, purpose: "advance", invoiceAllocations: [invoice] }).success).toBe(false);
    expect(customerPaymentInput.safeParse({ ...base, source: "advance_balance", bankAccountId: "bank" }).success).toBe(false);
  });
  it("blocks deactivation of an arrangement holding an unused advance", () => {
    const id = crypto.randomUUID();
    expect(() => upsertArrangement({ outstandingBalanceMinor: 0, arrangements: [{ id, name: "Project", active: true, outstandingBalanceMinor: 0 }], advanceBalances: { [id]: 100 } }, { id, name: "Project", active: false })).toThrow(/Settle/);
  });
  it("requires a real refund, reason and a traceable non-cash paying account", () => {
    const base = { customerId: "customer", branchId: "branch", method: "cash", amountMinor: 100, purpose: "advance_refund", notes: "Unused order advance returned", idempotencyKey: crypto.randomUUID() };
    expect(customerPaymentInput.safeParse(base).success).toBe(true);
    for (const change of [{ notes: "" }, { source: "advance_balance" }, { invoiceAllocations: [{ saleId: "sale", amountMinor: 100 }] }, { method: "bank_transfer" }, { bankAccountId: "bank" }])
      expect(customerPaymentInput.safeParse({ ...base, ...change }).success).toBe(false);
    expect(customerPaymentInput.safeParse({ ...base, method: "bank_transfer", bankAccountId: "bank", reference: "REF-123" }).success).toBe(true);
  });
});
