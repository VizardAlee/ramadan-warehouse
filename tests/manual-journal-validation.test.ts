import { describe, expect, it } from "vitest";
import { canConfigureManualAccount, isOperationalControlCode, manualJournalInput, reverseManualJournalInput } from "../functions/src/validation/manual-journals";

const input = { action: "post", branchId: "store", effectiveAt: "2026-01-01T12:00:00Z", reference: "DEP-1", reason: "Monthly depreciation", purpose: "depreciation", cashFlowActivity: "operating", idempotencyKey: "08a610c3-3012-414b-82de-f921b982defb", lines: [
  { accountId: "expense", debitMinor: 100, creditMinor: 0 }, { accountId: "asset", debitMinor: 0, creditMinor: 100 },
] };
describe("manual journal safeguards", () => {
  it("requires a balanced, safe, independently explained journal", () => {
    expect(manualJournalInput.safeParse(input).success).toBe(true);
    for (const change of [{ reason: "" }, { branchId: "bad/path" }, { lines: [] }, { cashFlowActivity: "guess" },
      { lines: [{ accountId: "expense", debitMinor: 100, creditMinor: 100 }, input.lines[1]] },
      { lines: [input.lines[0], { ...input.lines[1], creditMinor: 90 }] },
      { lines: [ { accountId: "a", debitMinor: Number.MAX_SAFE_INTEGER, creditMinor: 0 }, { accountId: "b", debitMinor: 1, creditMinor: 0 }, { accountId: "c", debitMinor: 0, creditMinor: Number.MAX_SAFE_INTEGER }, { accountId: "d", debitMinor: 0, creditMinor: 1 } ] }])
      expect(manualJournalInput.safeParse({ ...input, ...change }).success).toBe(false);
  });
  it("reserves operational control accounts and money-account setup for their existing workflows", () => {
    for (const code of ["1100", "1200", "1250", "1300", "2000", "2100", "2200", "2210", "2300", "3100", "3999", "5200"]) {
      expect(isOperationalControlCode(code)).toBe(true); expect(canConfigureManualAccount(code)).toBe(false);
    }
    expect(canConfigureManualAccount("1031")).toBe(false);
    for (const code of ["4000", "4100", "5000", "5010", "6000"]) expect(canConfigureManualAccount(code)).toBe(false);
    for (const code of ["1500", "1590", "3000", "6100", "2400"]) expect(canConfigureManualAccount(code)).toBe(true);
    expect(reverseManualJournalInput.safeParse({ ...input, action: "reverse", journalEntryId: "original" }).success).toBe(true);
  });
});
