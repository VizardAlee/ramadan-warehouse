import { describe, expect, it } from "vitest";
import { matchesProductName, normalizeProductName } from "@/features/products/name-search";

describe("product name matching", () => {
  it("normalizes case, repeated whitespace and compatible Unicode forms", () => {
    expect(normalizeProductName("  Ｓｏｌａｒ   PANEL  ")).toBe("solar panel");
    expect(matchesProductName("Goodwe Solar Panel", " SOLAR    panel ")).toBe(true);
  });
  it("accepts any part of a name and an empty query", () => {
    expect(matchesProductName("Goodwe Solar Panel", "oodwe")).toBe(true);
    expect(matchesProductName("Goodwe Solar Panel", " ")).toBe(true);
    expect(matchesProductName("Goodwe Solar Panel", "SKU-123")).toBe(false);
  });
});
