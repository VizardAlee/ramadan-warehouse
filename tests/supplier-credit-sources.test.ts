import { describe, expect, it } from "vitest";
import { changeCreditSources, creditSources } from "../functions/src/procurement/credit-sources";

describe("supplier credit provenance", () => {
  it("classifies an existing unexplained balance as legacy, without inventing a cash advance", () => {
    expect(creditSources(12345)).toEqual({ cashAdvanceMinor: 0, returnCreditMinor: 0, legacyUnclassifiedMinor: 12345 });
  });
  it("conserves exact kobo and consumes return credits, cash advances, then legacy in order", () => {
    const initial = { "branch:a": { cashAdvanceMinor: 3333, returnCreditMinor: 6668, legacyUnclassifiedMinor: 17 } };
    const original = structuredClone(initial);
    const result = changeCreditSources(initial, "branch:a", 10018, -10010);
    expect(result.used).toEqual({ returnCreditMinor: 6668, cashAdvanceMinor: 3333, legacyUnclassifiedMinor: 9 });
    expect(result.remaining).toEqual({ returnCreditMinor: 0, cashAdvanceMinor: 0, legacyUnclassifiedMinor: 8 });
    expect(initial).toEqual(original);
  });
  it("does not let a return reversal consume another source or another store's credit", () => {
    const map = { "branch:a": { cashAdvanceMinor: 500, returnCreditMinor: 100, legacyUnclassifiedMinor: 0 }, "branch:b": { cashAdvanceMinor: 0, returnCreditMinor: 900, legacyUnclassifiedMinor: 0 } };
    expect(() => changeCreditSources(map, "branch:a", 600, -101, "returnCreditMinor")).toThrow(/already been used/);
    const result = changeCreditSources(map, "branch:a", 600, -100, "returnCreditMinor");
    expect(result.remaining.cashAdvanceMinor).toBe(500);
    expect(result.balances["branch:b"]).toEqual(map["branch:b"]);
  });
  it("retains origins across a multi-line return and a subsequent paid advance", () => {
    const first = changeCreditSources(undefined, "warehouse:a", 25, 101, "returnCreditMinor");
    const second = changeCreditSources(first.balances, "warehouse:a", 126, 202, "returnCreditMinor");
    const third = changeCreditSources(second.balances, "warehouse:a", 328, 404, "cashAdvanceMinor");
    expect(third.remaining).toEqual({ returnCreditMinor: 303, cashAdvanceMinor: 404, legacyUnclassifiedMinor: 25 });
  });
  it("refuses inconsistent, fractional, negative and overflowing evidence without mutation", () => {
    expect(() => creditSources(10, { cashAdvanceMinor: 9, returnCreditMinor: 0, legacyUnclassifiedMinor: 0 })).toThrow(/do not match/);
    expect(() => creditSources(-1)).toThrow(/reconciliation/);
    expect(() => changeCreditSources(undefined, "a", 1, 0.5, "cashAdvanceMinor")).toThrow(/Invalid/);
    expect(() => changeCreditSources(undefined, "a", 1, -2)).toThrow(/Insufficient/);
    expect(() => changeCreditSources(undefined, "a", Number.MAX_SAFE_INTEGER, 1, "cashAdvanceMinor")).toThrow(/reconciliation/);
  });
});
