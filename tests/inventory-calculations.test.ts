import { describe, expect, it } from "vitest";
import {
  balanceDocumentId,
  generateCategoryCode,
  issueCost,
  normalizeInventoryIdentifier,
  parseSerialNumbers,
  receiptCost,
} from "../functions/src/inventory/calculations";

describe("inventory calculations", () => {
  it("normalizes identifiers and detects case-insensitive serial duplicates", () => {
    expect(normalizeInventoryIdentifier("  inv   001 ")).toBe("INV 001");
    expect(parseSerialNumbers(["sn-1", " SN-1 ", "sn-2"])).toEqual({
      normalized: ["SN-1", "SN-1", "SN-2"],
      duplicates: ["SN-1"],
    });
  });

  it("generates readable, bounded category codes", () => {
    expect(generateCategoryCode("Solar Panels & Accessories")).toBe(
      "SOLAR-PANELS-ACCESSORIES",
    );
    expect(generateCategoryCode("é")).toMatch(/^E-[A-F0-9]{8}$/);
    expect(generateCategoryCode("A category name that is much longer than forty characters")).toHaveLength(40);
  });

  it("calculates weighted-average receipts in integer minor units", () => {
    expect(
      receiptCost(
        { quantity: 10, totalValueMinor: 10_000, averageUnitCostMinor: 1_000 },
        10,
        2_000,
      ),
    ).toEqual({
      quantity: 20,
      totalValueMinor: 30_000,
      averageUnitCostMinor: 1_500,
    });
  });

  it("carries source value on issue and zeroes exhausted balances", () => {
    expect(
      issueCost(
        { quantity: 4, totalValueMinor: 6_000, averageUnitCostMinor: 1_500 },
        4,
      ),
    ).toEqual({
      movementValueMinor: 6_000,
      unitCostMinor: 1_500,
      balance: {
        quantity: 0,
        totalValueMinor: 0,
        averageUnitCostMinor: 0,
      },
    });
    expect(() =>
      issueCost(
        { quantity: 1, totalValueMinor: 100, averageUnitCostMinor: 100 },
        2,
      ),
    ).toThrow(/Insufficient/);
  });

  it("creates deterministic lot-aware balance identifiers", () => {
    expect(balanceDocumentId("org", "product", "location", "lot")).toBe(
      "org__product__location__lot",
    );
    expect(balanceDocumentId("org", "product", "location")).toBe(
      "org__product__location__base",
    );
  });
});
