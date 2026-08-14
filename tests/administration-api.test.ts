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
});
