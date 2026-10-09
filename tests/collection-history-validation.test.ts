import { describe, expect, it } from "vitest";
import { saleDocumentInput } from "../functions/src/validation/sales";

describe("collection history pages", () => {
  it("retains the legacy request with a bounded default page", () => {
    expect(saleDocumentInput.parse({ saleId: "sale" })).toEqual({ saleId: "sale", collectionLimit: 25 });
  });
  it("accepts only supported sizes and safe cursor identifiers", () => {
    for (const collectionLimit of [25, 50, 100]) expect(saleDocumentInput.safeParse({ saleId: "sale", collectionLimit, collectionCursorId: "cursor" }).success).toBe(true);
    for (const collectionLimit of [0, 26, 101, 500]) expect(saleDocumentInput.safeParse({ saleId: "sale", collectionLimit }).success).toBe(false);
    for (const collectionCursorId of ["/nested/path", ".", "..", ""]) expect(saleDocumentInput.safeParse({ saleId: "sale", collectionCursorId }).success).toBe(false);
  });
});
