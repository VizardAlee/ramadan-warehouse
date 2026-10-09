import { describe, expect, it } from "vitest";
import { budgetInput, budgetMonthDates, budgetVariance } from "../functions/src/accounting/budgets";
describe("monthly budget comparisons", () => {
  it("uses calendar months including leap years", () => {
    expect(budgetMonthDates("2028-02")).toEqual({ fromDate: "2028-02-01", toDate: "2028-02-29" });
    expect(budgetMonthDates("2026-12").toDate).toBe("2026-12-31");
    expect(budgetInput.safeParse({ action: "workspace", month: "2026-13" }).success).toBe(false);
  });
  it("distinguishes favorable income from favorable expense variance", () => {
    expect(budgetVariance("4100", 10000, 2000, 15000)).toMatchObject({ actualMinor: 13000, varianceMinor: 3000, variancePercent: 30, favorable: true });
    expect(budgetVariance("6100", 10000, 9000, 1000)).toMatchObject({ actualMinor: 8000, varianceMinor: 2000, variancePercent: 20, favorable: true });
    expect(budgetVariance("5100", 10000, 15000, 0)).toMatchObject({ varianceMinor: -5000, favorable: false });
  });
  it("does not divide by zero or accept invalid ledger arithmetic", () => {
    expect(budgetVariance("4100", 0, 0, 1000).variancePercent).toBeNull();
    expect(() => budgetVariance("1100", 1000, 0, 0)).toThrow();
    expect(() => budgetVariance("4100", 1000, -1, 0)).toThrow();
    expect(() => budgetVariance("4100", Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 0)).toThrow();
  });
});
