import { describe, expect, it } from "vitest";
import {
  calculatePosCart,
  provisionalReceiptReference,
  reconcileHeldCart,
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
      subtotalAmountMinor: 200_000,
      discountAmountMinor: 0,
      netAmountMinor: 200_000,
      vatAmountMinor: 15_000,
      grossAmountMinor: 215_000,
      totalQuantity: 2,
    });
  });

  it("applies an auditable discount before calculating VAT", () => {
    expect(calculatePosCart([{ product, quantity: 2 }], 20_000)).toEqual({
      subtotalAmountMinor: 200_000,
      discountAmountMinor: 20_000,
      netAmountMinor: 180_000,
      vatAmountMinor: 13_500,
      grossAmountMinor: 193_500,
      totalQuantity: 2,
    });
    expect(() =>
      calculatePosCart([{ product, quantity: 1 }], 100_001),
    ).toThrow("cannot exceed");
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

  it("restores a held cart using current product and stock data", () => {
    const currentProduct = {
      ...product,
      unitPriceMinor: 120_000,
      availableQuantity: 5,
    };
    expect(
      reconcileHeldCart(
        [
          { productId: product.id, quantity: 5 },
          { productId: "removed-product", quantity: 2 },
        ],
        [currentProduct],
        new Map([[product.id, 2]]),
      ),
    ).toEqual({
      lines: [{ product: currentProduct, quantity: 3 }],
      adjustedProductCount: 1,
      omittedProductCount: 1,
    });
  });
});
