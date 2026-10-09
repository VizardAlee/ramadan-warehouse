import { describe, expect, it } from "vitest";
import { companyFundsTransferInput } from "../functions/src/validation/bank-reconciliation";
import { assertSafeJournal } from "../functions/src/accounting/journal-validation";
const valid = { sourceBankAccountId: "bank-a", destinationBankAccountId: "bank-b", branchId: "store", amountMinor: 50000,
  transferredAt: "2026-10-09T09:00:00Z", reference: "BANK-1", reason: "Move reserve funds", confirmedCompleted: true,
  idempotencyKey: "08a610c3-3012-414b-82de-f921b982defb" };
describe("company transfers", () => {
  it("requires distinct accounts, an actual completed transfer and safe minor units", () => {
    expect(companyFundsTransferInput.safeParse(valid).success).toBe(true);
    for (const change of [{ destinationBankAccountId: "bank-a" }, { sourceBankAccountId: "bad/path" }, { amountMinor: 0 },
      { amountMinor: 1.1 }, { amountMinor: Number.MAX_SAFE_INTEGER + 1 }, { confirmedCompleted: false }, { reason: "" }, { reference: "" }, { branchId: "" }])
      expect(companyFundsTransferInput.safeParse({ ...valid, ...change }).success).toBe(false);
  });
  it("rejects unsafe journal totals even when rounded debit and credit appear equal", () => {
    expect(() => assertSafeJournal([
      { debitMinor: Number.MAX_SAFE_INTEGER, creditMinor: 0 }, { debitMinor: 1, creditMinor: 0 },
      { debitMinor: 0, creditMinor: Number.MAX_SAFE_INTEGER }, { debitMinor: 0, creditMinor: 1 },
    ])).toThrow();
  });
});
