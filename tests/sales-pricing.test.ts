import { describe, expect, it } from "vitest";
import { resolveCatalogPrice } from "../functions/src/sales/pricing";
import { salesPriceInput, commitSaleInput } from "../functions/src/validation/sales";

describe("catalogue price levels", () => {
  const central = { basePriceMinor: 10000, wholesalePriceMinor: 8000, version: 3 };
  const branch = { active: true, sellingPriceMinor: 11000, version: 9 };
  it("keeps legacy retail and branch overrides compatible", () => {
    expect(resolveCatalogPrice(central, {})).toMatchObject({ unitPriceMinor: 10000, priceVersion: 3, priceSource: "central" });
    expect(resolveCatalogPrice(central, branch)).toMatchObject({ unitPriceMinor: 11000, priceVersion: 9, priceSource: "branch" });
  });
  it("uses the approved wholesale price and its own central version", () => {
    expect(resolveCatalogPrice(central, branch, "wholesale")).toEqual({ unitPriceMinor: 8000, priceVersion: 3, priceSource: "wholesale" });
  });
  it("never infers a wholesale discount when none is configured", () => {
    for (const value of [null, undefined, 0, -1, 1.2])
      expect(() => resolveCatalogPrice({ ...central, wholesalePriceMinor: value }, branch, "wholesale")).toThrow("not configured");
  });
  it("does not revive an unapproved or outdated below-base branch price", () => {
    expect(resolveCatalogPrice(central, { ...branch, sellingPriceMinor: 7000 })).toMatchObject({ unitPriceMinor: 10000 });
    expect(resolveCatalogPrice(central, { ...branch, sellingPriceMinor: 7000, belowBaseApproved: true, basePriceVersion: 2 })).toMatchObject({ unitPriceMinor: 10000 });
  });
  it("validates wholesale money without making old callers supply it", () => {
    const input = { productId: "test-product", basePriceMinor: 10000, vatRateBasisPoints: 0, idempotencyKey: crypto.randomUUID() };
    expect(salesPriceInput.safeParse(input).success).toBe(true);
    expect(salesPriceInput.safeParse({ ...input, wholesalePriceMinor: null }).success).toBe(true);
    expect(salesPriceInput.safeParse({ ...input, wholesalePriceMinor: 1.5 }).success).toBe(false);
    expect(commitSaleInput.shape.lines.safeParse([{ productId: "test-product", quantity: 1, priceTier: "wholesale" }]).success).toBe(true);
    expect(commitSaleInput.shape.lines.safeParse([{ productId: "test-product", quantity: 1, priceTier: "invented" }]).success).toBe(false);
  });
});
