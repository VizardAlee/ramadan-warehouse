import { describe, expect, it } from "vitest";
import { calculateSale } from "../functions/src/sales/calculations";
import {
  calculatePosCart,
  posLineUnitPriceMinor,
  productForPriceTier,
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
  it("matches server half-up VAT without losing a kobo in large intermediate products", () => {
    for (const [price, rate] of [[4_000_000_000_000_073, 750], [4_000_000_000_000_011, 5000], [1, 5000]]) {
      const current = { ...product, unitPriceMinor: price!, vatRateBasisPoints: rate! };
      const client = calculatePosCart([{ product: current, quantity: 1 }]);
      const server = calculateSale([{ quantity: 1, unitPriceMinor: price!, vatRateBasisPoints: rate!, unitCostMinor: 0 }]);
      expect(client.vatAmountMinor).toBe(Number((BigInt(price!) * BigInt(rate!) + 5000n) / 10000n));
      expect(client).toMatchObject({ subtotalAmountMinor: server.subtotalAmountMinor, netAmountMinor: server.netAmountMinor,
        vatAmountMinor: server.vatAmountMinor, grossAmountMinor: server.grossAmountMinor });
    }
  });

  it("allocates large mixed-rate discounts exactly and preserves client/server parity", () => {
    const prices = [3_000_000_000_000_017, 2_000_000_000_000_011, 1001];
    const rates = [750, 0, 5000];
    const discount = 1_234_567_890_123_457;
    const lines = prices.map((price, index) => ({ product: { ...product, id: String(index), unitPriceMinor: price, vatRateBasisPoints: rates[index]! }, quantity: 1 }));
    const client = calculatePosCart(lines, discount);
    const server = calculateSale(lines.map(line => ({ quantity: 1, unitPriceMinor: line.product.unitPriceMinor,
      vatRateBasisPoints: line.product.vatRateBasisPoints, unitCostMinor: 0 })), discount);
    expect(server.lines[0]!.discountAmountMinor).toBe(Number(BigInt(discount) * BigInt(prices[0]!) / BigInt(server.subtotalAmountMinor)));
    expect(server.lines.reduce((sum, line) => sum + line.discountAmountMinor, 0)).toBe(discount);
    expect(client).toMatchObject({ subtotalAmountMinor: server.subtotalAmountMinor, discountAmountMinor: discount,
      netAmountMinor: server.netAmountMinor, vatAmountMinor: server.vatAmountMinor, grossAmountMinor: server.grossAmountMinor });
  });

  it("rejects unsafe aggregate totals and malformed offline VAT snapshots", () => {
    const large = { ...product, unitPriceMinor: 4_000_000_000_000_000, vatRateBasisPoints: 5000 };
    expect(() => calculatePosCart([{ product: large, quantity: 1 }, { product: large, quantity: 1 }])).toThrow("too large");
    expect(() => calculatePosCart([{ product: { ...large, unitPriceMinor: Number.MAX_SAFE_INTEGER }, quantity: 2 }])).toThrow("too large");
    for (const rate of [-1, 0.5, 10001, NaN, Infinity])
      expect(() => calculatePosCart([{ product: { ...product, vatRateBasisPoints: rate }, quantity: 1 }])).toThrow("VAT rate");
    expect(calculatePosCart([]).grossAmountMinor).toBe(0);
  });

  it("does not put an excessive discount remainder on the final low-value line", () => {
    const lines = Array.from({ length: 100 }, (_, index) => ({ product: { ...product, id: String(index), unitPriceMinor: 1, vatRateBasisPoints: index % 2 ? 750 : 0 }, quantity: 1 }));
    const server = calculateSale(lines.map(line => ({ quantity: 1, unitPriceMinor: 1, vatRateBasisPoints: line.product.vatRateBasisPoints, unitCostMinor: 0 })), 99);
    expect(server.lines.every(line => line.netAmountMinor >= 0 && line.discountAmountMinor <= line.subtotalAmountMinor)).toBe(true);
    expect(server.lines.reduce((sum, line) => sum + line.discountAmountMinor, 0)).toBe(99);
    expect(server.netAmountMinor).toBe(1);
    expect(calculatePosCart(lines, 99)).toMatchObject({ netAmountMinor: 1, vatAmountMinor: server.vatAmountMinor, grossAmountMinor: server.grossAmountMinor });
  });
  it("restores wholesale held carts using the current wholesale snapshot", () => {
    const current = { ...product, wholesalePriceMinor: 70000, centralPriceVersion: 5 };
    const restored = reconcileHeldCart([{ productId: product.id, quantity: 2, priceTier: "wholesale" }], [current]);
    expect(restored.lines[0]).toMatchObject({ priceTier: "wholesale", product: { unitPriceMinor: 70000, priceVersion: 5 } });
    expect(calculatePosCart(restored.lines).subtotalAmountMinor).toBe(140000);
    expect(current.unitPriceMinor).toBe(100000);
    expect(() => productForPriceTier(product, "wholesale")).toThrow("not configured");
  });
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

  it("uses a one-sale unit price when calculating VAT and totals", () => {
    const line = { product, quantity: 2, sellingPriceMinor: 125_000, priceOverrideReason: "Agreed price" };
    expect(posLineUnitPriceMinor(line)).toBe(125_000);
    expect(calculatePosCart([line])).toMatchObject({
      subtotalAmountMinor: 250_000,
      vatAmountMinor: 18_750,
      grossAmountMinor: 268_750,
    });
    expect(product.unitPriceMinor).toBe(100_000);
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
      resetPriceCount: 0,
    });
  });

  it("preserves a held sale price only while its catalogue reference is current", () => {
    const line = { productId: product.id, quantity: 1, catalogUnitPriceMinor: 100_000, sellingPriceMinor: 110_000, priceOverrideReason: "Agreed price" };
    expect(reconcileHeldCart([line], [product]).lines[0]?.sellingPriceMinor).toBe(110_000);
    expect(reconcileHeldCart([{ ...line, sellingPriceMinor: 90_000 }], [product]).lines[0]?.sellingPriceMinor).toBe(90_000);
    expect(reconcileHeldCart([line], [{ ...product, unitPriceMinor: 105_000 }])).toMatchObject({ resetPriceCount: 1 });
    expect(reconcileHeldCart([{ ...line, sellingPriceMinor: 0 }], [product])).toMatchObject({ resetPriceCount: 1 });
  });
});
