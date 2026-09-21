import { describe, expect, it } from "vitest";
import { resolveSettlementAccount } from "../functions/src/accounting/settlement-account";

const organizationId = "settlement-test-org";
function snapshot(data: Record<string, unknown>, id = "account-1") {
  return {
    id,
    exists: true,
    get: (field: string) => data[field],
  } as unknown as FirebaseFirestore.DocumentSnapshot;
}

describe("company settlement-account selection", () => {
  const valid = snapshot({
    organizationId,
    active: true,
    ledgerAccountCode: "1040",
    bankName: "Test Bank",
    accountName: "Collections",
    accountNumberLast4: "1234",
  });

  it("posts cash to cash on hand without a bank account", () => {
    expect(resolveSettlementAccount(organizationId, "cash", undefined, undefined))
      .toMatchObject({ accountCode: "1010", accountName: "Cash on hand" });
  });

  it("uses the selected active company account and captures a safe snapshot", () => {
    expect(resolveSettlementAccount(organizationId, "bank_transfer", "account-1", valid))
      .toMatchObject({
        accountCode: "1040",
        bankAccountId: "account-1",
        bankName: "Test Bank",
        accountNumberLast4: "1234",
      });
  });

  it("rejects missing, inactive, and cross-organization accounts", () => {
    expect(() => resolveSettlementAccount(organizationId, "card", undefined, undefined)).toThrow();
    expect(() => resolveSettlementAccount(organizationId, "card", "account-1", snapshot({ organizationId, active: false }))).toThrow();
    expect(() => resolveSettlementAccount(organizationId, "card", "account-1", snapshot({ organizationId: "other", active: true }))).toThrow();
  });
});
