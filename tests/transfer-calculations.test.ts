import { describe, expect, it } from "vitest";
import {
  allocateMinorUnits,
  assertTransferQuantityInvariant,
  transferStatusFromTotals,
} from "../functions/src/transfers/calculations";

describe("transfer calculations", () => {
  it("enforces the cumulative workflow invariant", () => {
    expect(() =>
      assertTransferQuantityInvariant({
        approved: 10,
        reserved: 9,
        picked: 8,
        packed: 7,
        dispatched: 6,
        received: 5,
      }),
    ).not.toThrow();
    expect(() =>
      assertTransferQuantityInvariant({
        approved: 10,
        reserved: 4,
        picked: 5,
        packed: 0,
        dispatched: 0,
        received: 0,
      }),
    ).toThrow(/invariant/);
    expect(() =>
      assertTransferQuantityInvariant({
        approved: 2,
        reserved: 2,
        picked: 2,
        packed: 2,
        dispatched: 2,
        received: 2,
        damaged: 1,
      }),
    ).toThrow(/disposition/);
  });
  it("derives partial and complete operational statuses", () => {
    expect(
      transferStatusFromTotals({
        approved: 10,
        reserved: 3,
        picked: 0,
        packed: 0,
        dispatched: 0,
        received: 0,
      }),
    ).toBe("partially_reserved");
    expect(
      transferStatusFromTotals({
        approved: 10,
        reserved: 10,
        picked: 10,
        packed: 10,
        dispatched: 10,
        received: 4,
      }),
    ).toBe("partially_received");
    expect(
      transferStatusFromTotals({
        approved: 10,
        reserved: 10,
        picked: 10,
        packed: 10,
        dispatched: 10,
        received: 10,
      }),
    ).toBe("received");
  });
  it("allocates integer minor units deterministically with residuals", () => {
    expect(allocateMinorUnits(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateMinorUnits(99, [60, 30, 10])).toEqual([59, 30, 10]);
    expect(allocateMinorUnits(7, [0, 0])).toEqual([7, 0]);
  });
});
