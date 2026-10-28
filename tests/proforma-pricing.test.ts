import { expect, it, vi } from "vitest";
vi.mock("../functions/src/admin", () => ({ db: {} }));
import { proformaSaveIssue, quotedLineInput } from "@/features/pos/proforma-pricing";
import { proformaInput } from "../functions/src/sales/proforma";

const line = { productId: "product", quantity: 3, priceTier: "retail" as const, customUnitPrice: "" };
it("identifies the incomplete field instead of silently disabling Save", () => {
  expect(proformaSaveIssue("", [line])).toContain("Valid through");
  expect(proformaSaveIssue("2026-12-01", [])).toContain("Add at least one");
  expect(proformaSaveIssue("2026-12-01", [line, { ...line, productId: "" }])).toContain("quoted product 2");
  expect(proformaSaveIssue("2026-12-01", [{ ...line, quantity: 0 }])).toContain("whole quantity");
  expect(proformaSaveIssue("2026-12-01", [{ ...line, quantity: 100001 }])).toContain("whole quantity");
  expect(proformaSaveIssue("2026-12-01", [{ ...line, customUnitPrice: "1.234" }])).toContain("two decimal places");
  expect(proformaSaveIssue("2026-12-01", [line])).toBeUndefined();
});
it("omits a blank custom price so the server resolves the chosen preset", () => {
  expect(quotedLineInput(line)).toEqual({ productId: "product", quantity: 3, priceTier: "retail" });
  expect(quotedLineInput({ ...line, priceTier: "wholesale", customUnitPrice: " " })).toEqual({ productId: "product", quantity: 3, priceTier: "wholesale" });
});
it.each([["123.45", 12345], ["0", 0], ["0.00", 0], [".25", 25], [" 42.10 ", 4210]] as const)("converts quoted naira %s to exact integer kobo", (customUnitPrice, unitPriceMinor) => {
  expect(quotedLineInput({ ...line, customUnitPrice })).toMatchObject({ unitPriceMinor });
});
it.each(["-1", "1.234", "1e3", "Infinity", "NaN", "1,000", "9007199254740991"])("rejects invalid/unsafe custom price %s", customUnitPrice => {
  expect(() => quotedLineInput({ ...line, customUnitPrice })).toThrow();
});
it("preserves every kobo at the safe-integer boundary and rejects the next kobo", () => {
  expect(quotedLineInput({ ...line, customUnitPrice: "90071992547409.91" }).unitPriceMinor).toBe(Number.MAX_SAFE_INTEGER);
  expect(() => quotedLineInput({ ...line, customUnitPrice: "90071992547409.92" })).toThrow("too large");
});
it("accepts only nonnegative safe integer kobo at the server boundary, with no client totals", () => {
  const input = { action: "create_proforma", branchId: "a", validUntil: "2026-12-01", idempotencyKey: "b4f3e259-256d-4c77-9890-8024a8206430" };
  for (const unitPriceMinor of [0, 12345]) expect(proformaInput.safeParse({ ...input, lines: [{ productId: "product", quantity: 1, unitPriceMinor }] }).success).toBe(true);
  for (const unitPriceMinor of [-1, 1.23, Infinity, NaN, "12345", Number.MAX_SAFE_INTEGER + 1]) expect(proformaInput.safeParse({ ...input, lines: [{ productId: "product", quantity: 1, unitPriceMinor }] }).success).toBe(false);
  expect(proformaInput.safeParse({ ...input, lines: [{ productId: "product", quantity: 1, unitPriceMinor: 100, grossAmountMinor: 1 }] }).success).toBe(false);
});
