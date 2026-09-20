import { describe, expect, it } from "vitest";
import {
  assertBalancedJournal,
  assertPaymentsEqualTotal,
  calculateSale,
} from "../functions/src/sales/calculations";

describe("sales calculations", () => {
  it("keeps VAT separate and calculates cost in integer kobo", () => {
    expect(
      calculateSale([
        {
          quantity: 2,
          unitPriceMinor: 100_000,
          vatRateBasisPoints: 750,
          unitCostMinor: 70_000,
        },
      ]),
    ).toMatchObject({
      subtotalAmountMinor: 200_000,
      discountAmountMinor: 0,
      netAmountMinor: 200_000,
      vatAmountMinor: 15_000,
      grossAmountMinor: 215_000,
      costAmountMinor: 140_000,
    });
  });

  it("allocates discounts before VAT while preserving total cost", () => {
    expect(
      calculateSale(
        [
          {
            quantity: 2,
            unitPriceMinor: 100_000,
            vatRateBasisPoints: 750,
            unitCostMinor: 70_000,
          },
        ],
        20_000,
      ),
    ).toMatchObject({
      subtotalAmountMinor: 200_000,
      discountAmountMinor: 20_000,
      netAmountMinor: 180_000,
      vatAmountMinor: 13_500,
      grossAmountMinor: 193_500,
      costAmountMinor: 140_000,
      lines: [
        expect.objectContaining({
          subtotalAmountMinor: 200_000,
          discountAmountMinor: 20_000,
          netAmountMinor: 180_000,
        }),
      ],
    });
    expect(() =>
      calculateSale(
        [
          {
            quantity: 1,
            unitPriceMinor: 100,
            vatRateBasisPoints: 0,
            unitCostMinor: 50,
          },
        ],
        101,
      ),
    ).toThrow("cannot exceed");
  });

  it("requires paid-sale payments to equal the gross total", () => {
    expect(() => assertPaymentsEqualTotal([100_000, 115_000], 215_000)).not.toThrow();
    expect(() => assertPaymentsEqualTotal([200_000], 215_000)).toThrow(
      "Payment total must equal",
    );
  });

  it("enforces balanced double-entry journals", () => {
    expect(() =>
      assertBalancedJournal([
        { debitMinor: 215_000, creditMinor: 0 },
        { debitMinor: 140_000, creditMinor: 0 },
        { debitMinor: 0, creditMinor: 200_000 },
        { debitMinor: 0, creditMinor: 15_000 },
        { debitMinor: 0, creditMinor: 140_000 },
      ]),
    ).not.toThrow();
    expect(() =>
      assertBalancedJournal([
        { debitMinor: 100, creditMinor: 0 },
        { debitMinor: 0, creditMinor: 99 },
      ]),
    ).toThrow("must balance");
  });

  it("rejects invalid quantities and VAT rates", () => {
    expect(() =>
      calculateSale([
        {
          quantity: 0,
          unitPriceMinor: 100,
          vatRateBasisPoints: 750,
          unitCostMinor: 50,
        },
      ]),
    ).toThrow("Quantity");
    expect(() =>
      calculateSale([
        {
          quantity: 1,
          unitPriceMinor: 100,
          vatRateBasisPoints: 10_001,
          unitCostMinor: 50,
        },
      ]),
    ).toThrow("100 percent");
  });
});
