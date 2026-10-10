import { describe, expect, it } from "vitest";
import { stockJournalLines } from "../functions/src/accounting/stock-postings";

describe("non-cash stock journals", () => {
  it("balances opening equity without creating cash or sales income", () => {
    expect(stockJournalLines("opening_balance", false, 1500)).toMatchObject([
      { accountCode: "1200", debitMinor: 1500, creditMinor: 0 },
      { accountCode: "3100", debitMinor: 0, creditMinor: 1500 },
    ]);
  });
  it("uses opposite balanced entries for stock shortage and surplus", () => {
    for (const kind of ["stock_adjustment", "stock_count_correction"] as const) {
      for (const issue of [true, false]) {
        const lines = stockJournalLines(kind, issue, 1455);
        expect(lines.reduce((sum, line) => sum + line.debitMinor, 0)).toBe(1455);
        expect(lines.reduce((sum, line) => sum + line.creditMinor, 0)).toBe(1455);
        expect(lines[0]).toMatchObject({ accountCode: "1200", debitMinor: issue ? 0 : 1455, creditMinor: issue ? 1455 : 0 });
        expect(lines[1]?.accountCode).toBe("5200");
      }
    }
  });
  it("does not invent financial value and rejects unsafe valuation", () => {
    expect(stockJournalLines("opening_balance", false, 0)).toEqual([]);
    for (const value of [-1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1]) expect(() => stockJournalLines("stock_adjustment", false, value)).toThrow();
    expect(() => stockJournalLines("opening_balance", true, 1)).toThrow();
  });
});
