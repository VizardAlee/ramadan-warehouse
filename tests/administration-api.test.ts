import { describe, expect, it } from "vitest";
import { sanitizeCallableInput } from "@/features/administration/api";

describe("administration callable input", () => {
  it("omits absent optional fields before Firebase serializes them as null", () => {
    expect(
      sanitizeCallableInput({
        name: "Bifacial Solar Panels",
        code: "",
        description: "Solar panels with two faces",
        id: undefined,
        categoryId: undefined,
        categoryName: undefined,
      }),
    ).toEqual({
      name: "Bifacial Solar Panels",
      code: "",
      description: "Solar panels with two faces",
    });
  });

  it("preserves false, zero, empty strings, and identifiers", () => {
    expect(
      sanitizeCallableInput({
        id: "category-1",
        active: false,
        minimumStockLevel: 0,
        code: "",
      }),
    ).toEqual({
      id: "category-1",
      active: false,
      minimumStockLevel: 0,
      code: "",
    });
  });

  it("omits nested optional POS fields before Firebase converts them to null", () => {
    expect(
      sanitizeCallableInput({
        branchId: "branch-1",
        lines: [
          {
            productId: "product-1",
            quantity: 3,
            priceVersion: undefined,
          },
        ],
        payments: [
          {
            method: "cash",
            amountMinor: 41_925_000,
            reference: undefined,
          },
        ],
        customerId: undefined,
        creditAmountMinor: 0,
      }),
    ).toEqual({
      branchId: "branch-1",
      lines: [{ productId: "product-1", quantity: 3 }],
      payments: [{ method: "cash", amountMinor: 41_925_000 }],
      creditAmountMinor: 0,
    });
  });
});
