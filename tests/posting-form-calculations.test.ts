import { describe, expect, it } from "vitest";
import { openingStockCostOverride } from "@/features/inventory/posting-form-calculations";

describe("opening stock form defaults", () => {
  it("reuses a configured product cost instead of posting a duplicate override", () => {
    expect(openingStockCostOverride(50_000, 0)).toBeUndefined();
    expect(openingStockCostOverride(0, 12_000)).toBeUndefined();
  });

  it("uses the entered cost when the product has no configured default", () => {
    expect(openingStockCostOverride(undefined, 50_000)).toBe(50_000);
  });
});
