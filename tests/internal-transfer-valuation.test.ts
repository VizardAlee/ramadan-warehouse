import { describe, expect, it } from "vitest";
import { internalTransferMovementValue } from "../functions/src/inventory/calculations";

describe("exact internal-return inventory valuation", () => {
  it("carries the final-unit remainder without inventing or losing company value", () => {
    expect(internalTransferMovementValue(101, 10, 10)).toBe(101);
    expect(internalTransferMovementValue(101, 10, 3)).toBe(30);
    expect(internalTransferMovementValue(71, 7, 7)).toBe(71);
  });
  it("rounds safe integers without overflowing the intermediate multiplication", () => {
    expect(internalTransferMovementValue(Number.MAX_SAFE_INTEGER, 1_000_000, 1_000_000)).toBe(Number.MAX_SAFE_INTEGER);
    expect(internalTransferMovementValue(1, 2, 1)).toBe(1);
    expect(internalTransferMovementValue(0, 3, 2)).toBe(0);
  });
  it.each([[1,0,1], [1,2,3], [-1,2,1], [1,2,0], [1.5,2,1]])("rejects invalid valuation %j", (value, quantity, moved) => {
    expect(() => internalTransferMovementValue(value!, quantity!, moved!)).toThrow();
  });
});
