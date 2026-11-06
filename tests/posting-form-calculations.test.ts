import { describe, expect, it } from "vitest";
import { openingStockUnitCost } from "@/features/inventory/posting-form-calculations";

describe("opening stock form defaults", () => {
  it("sends the configured product cost without asking the user to re-enter it", () => {
    expect(openingStockUnitCost(50_000, 0)).toBe(50_000);
    expect(openingStockUnitCost(0, 12_000)).toBe(0);
  });

  it("uses an explicitly reviewed entry cost without changing the product default", () => {
    expect(openingStockUnitCost(50_000, 45_000, true)).toBe(45_000);
    expect(openingStockUnitCost(50_000, 0, true)).toBe(0);
    expect(openingStockUnitCost(50_000, undefined, true)).toBeUndefined();
  });
  it("uses the entered cost when the product has no configured default", () => {
    expect(openingStockUnitCost(undefined, 50_000)).toBe(50_000);
  });
});
