import { describe, expect, it } from "vitest";
import { statementEntry } from "../functions/src/sales/customer-statement";
import { customerHistoryInput } from "../functions/src/validation/sales";

describe("customer arrangement statements", () => {
  it("projects only the chosen part of a mixed receipt without double-counting", () => {
    const entry = { entryType: "advance_applied", amountMinor: -10000, debtAmountMinor: -10000, advanceAmountMinor: -10000,
      allocations: [{ accountId: "a", accountName: "Solar", amountMinor: 3000 }, { accountId: "b", accountName: "Shop", amountMinor: 7000 }],
      invoiceAllocations: [{ accountId: "a", saleId: "s1", saleNumber: "SALE-1", amountMinor: 3000 }, { accountId: "b", saleId: "s2", saleNumber: "SALE-2", amountMinor: 7000 }] };
    expect(statementEntry(entry, "a")).toMatchObject({ amountMinor: -3000, debtChangeMinor: -3000, advanceChangeMinor: -3000, accountName: "Solar", needsReview: false, invoiceAllocations: [{ saleId: "s1" }] });
    expect(statementEntry(entry, "c")).toBeNull();
    expect(statementEntry(entry)).toMatchObject({ amountMinor: -10000, debtChangeMinor: -10000, advanceChangeMinor: -10000 });
  });
  it("preserves General for historical entries and does not guess an arrangement", () => {
    const old = { entryType: "credit_sale", amountMinor: 20000 };
    expect(statementEntry(old, "a")).toBeNull();
    expect(statementEntry(old, "general")).toMatchObject({ debtChangeMinor: 20000, advanceChangeMinor: 0 });
    expect(statementEntry({ entryType: "advance_sale", amountMinor: -5000, customerAccountId: "a" }, "a")).toMatchObject({ debtChangeMinor: 0, advanceChangeMinor: -5000 });
  });
  it("flags unknown or non-proportional historical classifications for review", () => {
    expect(statementEntry({ entryType: "old_import", amountMinor: 5000 })).toMatchObject({ needsReview: true, debtChangeMinor: null, advanceChangeMinor: null });
    expect(statementEntry({ entryType: "payment", amountMinor: -5000, debtAmountMinor: -4000, allocations: [{ accountId: "a", accountName: "Solar", amountMinor: 3000 }] }, "a")).toMatchObject({ debtChangeMinor: null, needsReview: true });
  });
  it("accepts the bounded statement view and arrangement selector", () => {
    expect(customerHistoryInput.parse({ view: "statement", customerId: "c", customerAccountId: "general", limit: 25 })).toMatchObject({ view: "statement", customerAccountId: "general", limit: 25 });
    expect(customerHistoryInput.safeParse({ view: "statement", customerId: "c", limit: 101 }).success).toBe(false);
  });
});
