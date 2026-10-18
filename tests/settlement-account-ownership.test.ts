import { describe, expect, it } from "vitest";
import { resolveSettlementAccount } from "../functions/src/accounting/settlement-account";

function bank(data: Record<string, unknown> = {}) {
  const fields = { organizationId: "org", active: true, ledgerAccountCode: "1031", bankName: "Test bank", accountName: "Store A", branchId: "a", ...data };
  return { id: "bank", exists: true, get: (key: string) => fields[key as keyof typeof fields] } as FirebaseFirestore.DocumentSnapshot;
}
describe("settlement bank ownership", () => {
  it("allows the owning store and retains actual bank attribution", () => {
    expect(resolveSettlementAccount("org", "card", "bank", bank(), { branchId: "a" })).toMatchObject({ accountCode: "1031", bankAccountId: "bank" });
  });
  it("denies another store or a missing recording store", () => {
    for (const scope of [{ branchId: "b" }, {}]) expect(() => resolveSettlementAccount("org", "bank_transfer", "bank", bank(), scope)).toThrow(/belongs to another store/);
  });
  it("preserves legacy company-wide accounts and cash settlement", () => {
    expect(resolveSettlementAccount("org", "bank_transfer", "bank", bank({ branchId: null }), { branchId: "b" }).bankAccountId).toBe("bank");
    expect(resolveSettlementAccount("org", "cash", undefined, undefined, { branchId: "b" })).toEqual({ accountCode: "1010", accountName: "Cash on hand" });
  });
  it("continues to reject foreign, inactive and unconfigured accounts", () => {
    for (const data of [{ organizationId: "foreign" }, { active: false }, { ledgerAccountCode: "" }]) expect(() => resolveSettlementAccount("org", "card", "bank", bank(data), { branchId: "a" })).toThrow();
  });
});
