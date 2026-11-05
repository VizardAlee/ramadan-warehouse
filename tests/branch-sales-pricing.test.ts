import { describe, expect, it } from "vitest";
import { resolveCatalogPrice } from "../functions/src/sales/pricing";
import { branchSalesPriceInput } from "../functions/src/validation/sales";
import { productForPriceTier, reconcileHeldCart } from "../src/features/pos/calculations";
import type { PosProduct } from "../src/features/pos/types";

describe("branch retail and wholesale prices", () => {
  const central = { basePriceMinor: 10000, wholesalePriceMinor: 8000, version: 7 };
  const branch = { active: true, sellingPriceMinor: 12000, wholesalePriceMinor: 9000, version: 4 };
  it("resolves independent overrides with the branch version", () => {
    expect(resolveCatalogPrice(central, branch)).toEqual({ unitPriceMinor: 12000, priceVersion: 4, priceSource: "branch" });
    expect(resolveCatalogPrice(central, branch, "wholesale")).toEqual({ unitPriceMinor: 9000, priceVersion: 4, priceSource: "branch" });
    expect(resolveCatalogPrice(central, { ...branch, sellingPriceMinor: null })).toMatchObject({ unitPriceMinor: 10000, priceVersion: 7 });
    expect(resolveCatalogPrice(central, { ...branch, wholesalePriceMinor: null }, "wholesale")).toMatchObject({ unitPriceMinor: 8000, priceVersion: 7 });
  });
  it("falls back for inactive, corrupt or stale unapproved overrides", () => {
    for (const override of [{ ...branch, active: false }, { ...branch, wholesalePriceMinor: -1 }, { ...branch, wholesalePriceMinor: 1.1 }, { ...branch, version: 0 }, { ...branch, wholesalePriceMinor: 7000, belowWholesaleApproved: true, basePriceVersion: 6 }])
      expect(resolveCatalogPrice(central, override, "wholesale")).toMatchObject({ unitPriceMinor: 8000, priceSource: "wholesale" });
    expect(resolveCatalogPrice(central, { ...branch, wholesalePriceMinor: 7000, belowWholesaleApproved: true, basePriceVersion: 7 }, "wholesale")).toMatchObject({ unitPriceMinor: 7000, priceSource: "branch" });
  });
  it("supports administrator-approved branch-only wholesale without inventing a fallback", () => {
    const noWholesale = { ...central, wholesalePriceMinor: null };
    expect(() => resolveCatalogPrice(noWholesale, branch, "wholesale")).toThrow("not configured");
    expect(resolveCatalogPrice(noWholesale, { ...branch, belowWholesaleApproved: true, basePriceVersion: 7 }, "wholesale").unitPriceMinor).toBe(9000);
    expect(() => resolveCatalogPrice(noWholesale, { ...branch, active: false }, "wholesale")).toThrow("not configured");
  });
  it("accepts explicit inheritance and legacy saves, rejects invalid money and versions", () => {
    const input = { productId: "product", branchId: "branch", sellingPriceMinor: 100, idempotencyKey: crypto.randomUUID() };
    expect(branchSalesPriceInput.parse(input)).not.toHaveProperty("wholesalePriceMinor");
    expect(branchSalesPriceInput.parse({ ...input, sellingPriceMinor: null, wholesalePriceMinor: null, expectedVersion: 0 })).toMatchObject({ sellingPriceMinor: null, wholesalePriceMinor: null });
    for (const invalid of [0, -1, 0.01, Number.MAX_SAFE_INTEGER + 1]) expect(branchSalesPriceInput.safeParse({ ...input, wholesalePriceMinor: invalid }).success).toBe(false);
  });
  it("uses the effective wholesale version and source in POS and resumed baskets", () => {
    const product: PosProduct = { id: "product", sku: "P", name: "Panel", unitOfMeasure: "unit", trackingType: "quantity", unitPriceMinor: 12000, basePriceMinor: 10000, priceVersion: 4, priceSource: "branch", wholesalePriceMinor: 9000, wholesalePriceVersion: 4, wholesalePriceSource: "branch", centralPriceVersion: 7, vatRateBasisPoints: 0, availableQuantity: 10 };
    expect(productForPriceTier(product, "wholesale")).toMatchObject({ unitPriceMinor: 9000, priceVersion: 4, priceSource: "branch" });
    const held = { lines: [{ productId: "product", quantity: 1, priceTier: "wholesale" as const }] };
    expect(reconcileHeldCart(held.lines, [product]).lines[0]!.product).toMatchObject({ unitPriceMinor: 9000, priceVersion: 4 });
  });
});
