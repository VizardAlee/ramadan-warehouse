import { describe, expect, it } from "vitest";
import { advanceJournalLines, applyAdvanceSettlement, outstandingAdvance } from "../functions/src/reconciliation/staff-advances";
import { staffAdvanceInput } from "../functions/src/validation/staff-advances";
describe("staff/driver advances", () => {
  const initial = { issuedMinor: 100000, retiredMinor: 0, returnedMinor: 0 };
  it("reduces outstanding for supported expenses then unused cash without income", () => {
    const retired = applyAdvanceSettlement(initial, "retire", 65000);
    expect(retired.outstandingMinor).toBe(35000);
    expect(applyAdvanceSettlement(retired, "return", 35000)).toMatchObject({ outstandingMinor: 0, status: "closed", retiredMinor: 65000, returnedMinor: 35000 });
    const lines = advanceJournalLines("return", 35000, { accountCode: "1010", accountName: "Cash on hand" });
    expect(lines.map(x => x.accountCode)).toEqual(["1010", "1260"]);
  });
  it("does not expense issuance or move cash again at retirement", () => {
    expect(advanceJournalLines("issue", 100000, { accountCode: "1031", accountName: "Bank", bankAccountId: "bank" })).toEqual([
      { accountCode: "1260", accountName: "Staff and driver advances", debitMinor: 100000, creditMinor: 0 },
      { accountCode: "1031", accountName: "Bank", bankAccountId: "bank", debitMinor: 0, creditMinor: 100000 },
    ]);
    expect(advanceJournalLines("retire", 65000).map(x => x.accountCode)).toEqual(["6000", "1260"]);
  });
  it.each([0, -1, 100001, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN])("rejects invalid return %s", amount => expect(() => applyAdvanceSettlement(initial, "return", amount)).toThrow());
  it("does not settle closed or corrupt balances", () => {
    expect(() => applyAdvanceSettlement({ ...initial, returnedMinor: 100000 }, "retire", 1)).toThrow();
    expect(() => outstandingAdvance({ ...initial, returnedMinor: 100001 })).toThrow();
    expect(() => outstandingAdvance({ ...initial, retiredMinor: -1 })).toThrow();
  });
  it("handles safe upper bound without overflow", () => {
    expect(applyAdvanceSettlement({ ...initial, issuedMinor: Number.MAX_SAFE_INTEGER }, "return", Number.MAX_SAFE_INTEGER).outstandingMinor).toBe(0);
  });
  it("requires evidence and correct tender/account pairing", () => {
    const input = { action: "return", advanceId: "advance", amountMinor: 100, reason: "Unused fuel money", reference: "receipt1", idempotencyKey: "11111111-1111-4111-8111-111111111111", method: "bank_transfer" };
    expect(staffAdvanceInput.safeParse(input).success).toBe(false);
    expect(staffAdvanceInput.safeParse({ ...input, bankAccountId: "bank1" }).success).toBe(true);
    expect(staffAdvanceInput.safeParse({ ...input, method: "cash", bankAccountId: "bank1" }).success).toBe(false);
    expect(staffAdvanceInput.safeParse({ ...input, method: "cash", amountMinor: 1.5 }).success).toBe(false);
    expect(staffAdvanceInput.safeParse({ ...input, action: "retire", method: undefined }).success).toBe(false);
  });
});
