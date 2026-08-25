import { describe, expect, it } from "vitest";
import {
  calculatePosCart,
  provisionalReceiptReference,
} from "../src/features/pos/calculations";

const product = {
  id: "product-1",
  sku: "PANEL-620",
  name: "620W panel",
  unitOfMeasure: "unit",
  trackingType: "quantity" as const,
  unitPriceMinor: 100_000,
  basePriceMinor: 90_000,
  vatRateBasisPoints: 750,
  priceVersion: 3,
  priceSource: "branch" as const,
  availableQuantity: 12,
};

describe("POS cart calculations", () => {
  it("keeps VAT separate from the net selling price", () => {
    expect(calculatePosCart([{ product, quantity: 2 }])).toEqual({
      netAmountMinor: 200_000,
      vatAmountMinor: 15_000,
      grossAmountMinor: 215_000,
      totalQuantity: 2,
    });
  });

  it("rejects fractional or empty sale quantities", () => {
    expect(() => calculatePosCart([{ product, quantity: 0 }])).toThrow();
    expect(() => calculatePosCart([{ product, quantity: 1.5 }])).toThrow();
  });

  it("creates visibly provisional offline receipt references", () => {
    expect(
      provisionalReceiptReference(
        "IRB",
        new Date("2026-08-25T12:00:00.000Z"),
        "12345678-1234-1234-1234-123456789abc",
      ),
    ).toBe("OFF-IRB-20260825-12345678");
  });
});
