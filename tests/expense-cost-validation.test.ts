import { describe, expect, it } from "vitest";
import { createExpenseInput } from "../functions/src/validation/expenses";

const base = { categoryName: "Installation", payeeName: "Contract technician", expenseDate: "2026-10-09", description: "Outsourced installation", netAmountMinor: 10000, idempotencyKey: "a55e9d6c-beb3-4fc0-86d8-5a4729fb1111" };
describe("linked provider bill validation", () => {
  it("preserves legacy unlinked expense inputs without new defaults", () => {
    expect(createExpenseInput.parse(base)).not.toHaveProperty("costPurpose");
  });
  it("requires a complete reference, cost purpose and store", () => {
    expect(createExpenseInput.safeParse({ ...base, costReferenceId: "case" }).success).toBe(false);
    expect(createExpenseInput.safeParse({ ...base, costReferenceId: "case", costReferenceType: "aftersales", costPurpose: "service" }).success).toBe(false);
    expect(createExpenseInput.parse({ ...base, branchId: "store", costReferenceId: "case", costReferenceType: "aftersales", costPurpose: "service" })).toMatchObject({ costReferenceId: "case" });
  });
  it("rejects nested paths and unsafe totals", () => {
    expect(createExpenseInput.safeParse({ ...base, branchId: "stores/other" }).success).toBe(false);
    expect(createExpenseInput.safeParse({ ...base, netAmountMinor: Number.MAX_SAFE_INTEGER, vatAmountMinor: 1 }).success).toBe(false);
  });
});
