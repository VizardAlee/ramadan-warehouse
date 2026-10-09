import { describe, expect, it } from "vitest";
import { calculateReviewedTax, hasReviewedTaxCoverage, periodsOverlap, taxRuleDefinition } from "../functions/src/tax/rules";
const rule = { taxType: "VAT" as const, scopeKey: "standard", version: "test-v1", title: "Reviewed test fixture", effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31", calculation: "flat_rate" as const, basis: "taxable_supplies" as const, rateBasisPoints: 750, applicability: "Test taxable supplies only", exemptions: "Review exemptions separately", source: "https://nass.gov.ng/documents/download/11249", sourceReference: "Test fixture: section 147" };
const approved = { ...rule, status: "approved", sourceVerified: true };
describe("versioned reviewed tax engine", () => {
  it("uses exact minor-unit arithmetic and snapshots the chosen version/source", () => {
    expect(calculateReviewedTax(rule, "2026-10-09", 100000)).toMatchObject({ taxMinor: 7500, ruleVersion: "test-v1", source: rule.source, baseMinor: 100000 });
    const large = Number.MAX_SAFE_INTEGER;
    expect(calculateReviewedTax({ ...rule, rateBasisPoints: 9999 }, "2026-10-09", large).taxMinor).toBe(Number((BigInt(large) * 9999n + 5000n) / 10000n));
    expect(calculateReviewedTax({ ...rule, rateBasisPoints: 5000 }, "2026-10-09", 1).taxMinor).toBe(1);
    expect(calculateReviewedTax({ ...rule, rateBasisPoints: 0 }, "2026-10-09", 100).taxMinor).toBe(0);
  });
  it("rejects unsafe money, out-of-period dates, invalid rates and unbounded/source-less definitions", () => {
    for (const value of [-1, 1.2, Number.MAX_SAFE_INTEGER + 1, Infinity]) expect(() => calculateReviewedTax(rule, "2026-10-09", value)).toThrow();
    expect(() => calculateReviewedTax(rule, "2025-12-31", 100)).toThrow();
    expect(() => calculateReviewedTax(rule, "2027-01-01", 100)).toThrow();
    for (const change of [{ rateBasisPoints: 10001 }, { source: "http://example.test" }, { effectiveTo: "" }, { effectiveTo: "2025-12-31" }]) expect(taxRuleDefinition.safeParse({ ...rule, ...change }).success).toBe(false);
  });
  it("requires complete, reviewed and unambiguous period coverage", () => {
    expect(hasReviewedTaxCoverage([approved], "VAT", "standard", "2026-01-01", "2026-12-31")).toBe(true);
    for (const change of [{ status: "draft" }, { status: "active" }, { sourceVerified: false }, { sourceReference: "" }, { effectiveFrom: "2026-01-02" }, { effectiveTo: "2026-12-30" }, { scopeKey: "exempt" }]) expect(hasReviewedTaxCoverage([{ ...approved, ...change }], "VAT", "standard", "2026-01-01", "2026-12-31")).toBe(false);
    const halves = [{ ...approved, effectiveTo: "2026-06-30" }, { ...approved, version: "v2", effectiveFrom: "2026-07-01" }];
    expect(hasReviewedTaxCoverage(halves, "VAT", "standard", "2026-01-01", "2026-12-31")).toBe(true);
    expect(hasReviewedTaxCoverage([halves[0]!, { ...halves[1]!, effectiveFrom: "2026-07-02" }], "VAT", "standard", "2026-01-01", "2026-12-31")).toBe(false);
    expect(hasReviewedTaxCoverage([approved, { ...approved, version: "overlap", effectiveFrom: "2026-02-01" }], "VAT", "standard", "2026-01-01", "2026-12-31")).toBe(false);
    expect(periodsOverlap(rule, { effectiveFrom: "2026-12-31", effectiveTo: "2027-12-31" })).toBe(true);
    expect(periodsOverlap(rule, { effectiveFrom: "2027-01-01", effectiveTo: "2027-12-31" })).toBe(false);
  });
});
