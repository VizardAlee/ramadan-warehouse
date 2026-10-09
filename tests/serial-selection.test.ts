import { describe, expect, it } from "vitest";
import { parseSaleSerials, validSaleSerials } from "../src/features/pos/serial-selection";
import { reconcileHeldCart } from "../src/features/pos/calculations";
import type { PosProduct } from "../src/features/pos/types";

describe("serialized POS selections", () => {
  it("normalizes exact manually confirmed identifiers without dropping embedded spaces", () => {
    expect(parseSaleSerials(" sn-a \n\n sn   b\r\n")).toEqual(["SN-A", "SN B"]);
    expect(validSaleSerials(parseSaleSerials("sn-a\nSN-A"), 2)).toBe(false);
    expect(validSaleSerials(["SN-A"], 2)).toBe(false);
    expect(validSaleSerials(["SN-A"], 1, ["SN-B"])).toBe(false);
    expect(validSaleSerials(["SN-A"], 1, ["SN-A", "SN-B"])).toBe(true);
    expect(validSaleSerials(Array.from({ length: 51 }, (_, i) => `SN-${i}`), 51)).toBe(false);
  });
  it("keeps serial selection when restoring held sales and reduces it with available quantity", () => {
    const product: PosProduct = { id: "p", sku: "P", name: "Panel", unitOfMeasure: "unit", trackingType: "serial", unitPriceMinor: 100, basePriceMinor: 100, vatRateBasisPoints: 0, priceVersion: 1, priceSource: "central", availableQuantity: 1 };
    const restored = reconcileHeldCart([{ productId: "p", quantity: 2, serialNumbers: ["SN-A", "SN-B"] }], [product]);
    expect(restored.lines[0]).toMatchObject({ quantity: 1, serialNumbers: ["SN-A"] });
    expect(restored.adjustedProductCount).toBe(1);
  });
});
