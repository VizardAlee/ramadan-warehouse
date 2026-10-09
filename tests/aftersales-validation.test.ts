import { describe, expect, it } from "vitest";
import { aftersalesWorkspaceInput, recordAftersalesPaymentInput, updateAftersalesCaseInput } from "../functions/src/validation/aftersales";
describe("service record validation", () => {
  it("rejects path-like service and bank identifiers", () => {
    for (const caseId of ["/nested/path", ".", "..", ""]) {
      expect(aftersalesWorkspaceInput.safeParse({ caseId }).success).toBe(false);
      expect(updateAftersalesCaseInput.safeParse({ caseId, status: "diagnosed", resolution: "Checked cable", idempotencyKey: crypto.randomUUID() }).success).toBe(false);
    }
    expect(recordAftersalesPaymentInput.safeParse({ caseId: "case", bankAccountId: "nested/bank", method: "bank_transfer", amountMinor: 1455, idempotencyKey: crypto.randomUUID() }).success).toBe(false);
  });
  it("accepts safe minor-unit payments and still requires a bank for transfers", () => {
    const input = { caseId: "case", method: "cash", amountMinor: 1455, idempotencyKey: crypto.randomUUID() };
    expect(recordAftersalesPaymentInput.safeParse(input).success).toBe(true);
    expect(recordAftersalesPaymentInput.safeParse({ ...input, method: "bank_transfer" }).success).toBe(false);
    expect(recordAftersalesPaymentInput.safeParse({ ...input, amountMinor: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(false);
  });
});
