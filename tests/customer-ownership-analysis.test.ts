import { describe, expect, it } from "vitest";
import { analyzeCustomerOwnership as analyze, type OwnershipRecord } from "../functions/src/sales/customer-ownership-analysis";
const branches = [{ id: "a", name: "Branch A", status: "active" }, { id: "b", name: "Branch B", status: "active" }, { id: "old", name: "Closed", status: "inactive" }];
const invoice = (branchId: string, outstanding = 0): OwnershipRecord => ({ id: branchId, collection: "sales", data: { branchId, status: "completed", receivableVersion: 1, receivableOutstandingMinor: outstanding } });
describe("customer ownership evidence", () => {
  it("leaves empty-history ownership to an explicit administrator choice", () => { const result = analyze({}, branches, []); expect(result.issues).toContain("missing_owner"); expect(result.allowedTargetBranchIds).toEqual(["a", "b"]); expect(result.currentBranchId).toBeNull(); });
  it("only permits the branch supported by single-branch posted history", () => { const customer = { branchId: "b", outstandingBalanceMinor: 1000 }; const records = [invoice("a", 1000)]; const before = JSON.stringify([customer, records]); const result = analyze(customer, branches, records); expect(result.issues).toContain("history_owner_conflict"); expect(result.allowedTargetBranchIds).toEqual(["a"]); expect(JSON.stringify([customer, records])).toBe(before); });
  it("does not invent an account-splitting policy for multiple branches", () => { const result = analyze({ branchId: "a" }, branches, [invoice("a"), invoice("b")]); expect(result.blockers).toContain("cross_branch_history"); expect(result.allowedTargetBranchIds).toEqual([]); });
  it("blocks unattributed or invalid branch evidence", () => { expect(analyze({}, branches, [invoice("unknown")]).allowedTargetBranchIds).toEqual([]); });
  it("blocks mismatched balances and unknown legacy invoice debt", () => { expect(analyze({ outstandingBalanceMinor: 500 }, branches, [invoice("a", 100)]).blockers).toContain("balance_review_required"); expect(analyze({ outstandingBalanceMinor: 100 }, branches, [{ id: "legacy", collection: "sales", data: { branchId: "a", status: "completed", creditAmountMinor: 100 } }]).allowedTargetBranchIds).toEqual([]); });
  it("blocks untracked legacy credit debt even when the customer master balance is zero", () => {
    const result = analyze({ outstandingBalanceMinor: 0 }, branches, [{ id: "legacy-zero-master", collection: "sales", data: { branchId: "a", status: "completed", creditAmountMinor: 100 } }]);
    expect(result.openInvoices).toEqual([expect.objectContaining({ id: "legacy-zero-master", tracked: false, outstandingMinor: null })]);
    expect(result.blockers).toContain("balance_review_required");
    expect(result.allowedTargetBranchIds).toEqual([]);
  });
  it("shows advances and arrangements without double-counting customer debt", () => { const result = analyze({ outstandingBalanceMinor: 100, advanceBalances: { general: 70 }, arrangements: [{ id: "x", name: "Job", outstandingBalanceMinor: 100 }] }, branches, [invoice("a", 100)]); expect(result.outstandingMinor).toBe(100); expect(result.advanceMinor).toBe(70); expect(result.allowedTargetBranchIds).toEqual(["a"]); });
  it("does not permit reassignment when the evidence is truncated", () => { expect(analyze({}, branches, [], false).blockers).toContain("review_limit"); });
  it("requires review for malformed money and untraceable advances", () => { for (const customer of [{ outstandingBalanceMinor: -1 }, { advanceBalances: { general: 50 } }, { advanceBalances: { general: "50" } }, { arrangements: [null] }]) expect(analyze(customer, branches, []).allowedTargetBranchIds).toEqual([]); });
});
