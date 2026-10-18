import { describe, expect, it } from "vitest";
import { expenseWorkspaceInput } from "../functions/src/validation/expenses";
import { expenseCursor, expenseCursorBinding, expenseMatches, readExpenseCursor } from "../functions/src/expenses/workspace";
import { eligibleExpenseAccounts, expenseDraftAmounts, expenseStatusLabel } from "@/features/expenses/workspace-presentation";

const input = (extra = {}) => expenseWorkspaceInput.parse(extra);
describe("expense read filters and cursor bounds", () => {
  it("matches all supported queues without conflating approval and payment", () => {
    for (const status of ["draft", "submitted", "approved", "partially_paid", "paid"]) {
      expect(expenseMatches({ status }, input({ status: "ready" }))).toBe(["approved", "partially_paid"].includes(status));
      expect(expenseMatches({ status }, input({ status }))).toBe(true);
      expect(expenseMatches({ status }, input({ status: "paid" }))).toBe(status === "paid");
    }
  });
  it("uses inclusive bill dates and matches legacy free text without requiring new indexed fields", () => {
    const row = { status: "paid", expenseDate: "2026-10-18", payeeName: "ÉLECTRICITY ＣＯ", supplierDocumentNumber: "INV-500", description: "Generator repair" };
    expect(expenseMatches(row, input({ fromDate: "2026-10-18", toDate: "2026-10-18", search: "electricity" }))).toBe(false);
    expect(expenseMatches(row, input({ fromDate: "2026-10-18", toDate: "2026-10-18", search: "électricity co" }))).toBe(true);
    expect(expenseMatches(row, input({ search: "inv-500" }))).toBe(true);
    expect(expenseMatches(row, input({ search: "repair" }))).toBe(true);
    expect(expenseMatches(row, input({ fromDate: "2026-10-19" }))).toBe(false);
    expect(expenseMatches({}, input({ toDate: "2026-10-18" }))).toBe(false);
    expect(expenseMatches({}, input())).toBe(true);
  });
  it("binds pages to identity, authorized context and every effective filter", () => {
    const original = input({ branchId: "a", status: "ready", search: "bill", limit: 25 });
    const binding = expenseCursorBinding("org", "uid", original), cursor = expenseCursor("record-500", binding);
    expect(readExpenseCursor(cursor, binding)).toBe("record-500");
    for (const change of [{ branchId: "b" }, { warehouseId: "w", branchId: undefined }, { status: "paid" }, { search: "other" }, { fromDate: "2026-01-01" }, { toDate: "2026-12-31" }, { limit: 50 }])
      expect(() => readExpenseCursor(cursor, expenseCursorBinding("org", "uid", input({ ...original, ...change })))).toThrow(/different filters/);
    for (const [org, uid] of [["foreign", "uid"], ["org", "other"]]) expect(() => readExpenseCursor(cursor, expenseCursorBinding(org!, uid!, original))).toThrow();
    expect(() => readExpenseCursor("broken", binding)).toThrow();
    expect(() => readExpenseCursor(expenseCursor("bad/path", binding), binding)).toThrow();
  });
  it("rejects unbounded, malformed or contradictory filters", () => {
    for (const value of [{ limit: 201 }, { search: "x".repeat(121) }, { cursor: "x".repeat(1025) }, { fromDate: "2026-02-30" }, { fromDate: "2026-10-20", toDate: "2026-10-18" }, { branchId: "b", warehouseId: "w" }, { view: "choices" }, { choiceCursor: "bad/path" }])
      expect(expenseWorkspaceInput.safeParse(value).success).toBe(false);
  });
});
describe("expense presentation preserves real amounts and bank ownership", () => {
  it("previews net plus VAT in exact minor units and rejects negative, fractional and unsafe money", () => {
    expect(expenseDraftAmounts("14.55", "1.23")).toEqual({ netMinor: 1455, vatMinor: 123, grossMinor: 1578 });
    for (const [net, vat] of [["", "0"], ["-1", "0"], ["10", "-1"], ["0.001", "0"], ["10", "NaN"], ["90071992547409.9", "1"]]) expect(expenseDraftAmounts(net!, vat!)).toBeNull();
  });
  it("offers only the bill store and company-wide configured accounts, including warehouse/organization cases", () => {
    const accounts = [{ id: "all", ledgerAccountCode: "1030" }, { id: "a", branchId: "a", ledgerAccountCode: "1031" }, { id: "b", branchId: "b", ledgerAccountCode: "1032" }, { id: "unconfigured", ledgerAccountCode: "" }];
    expect(eligibleExpenseAccounts(accounts, { branchId: "a" }).map(x => x.id)).toEqual(["all", "a"]);
    expect(eligibleExpenseAccounts(accounts, {}).map(x => x.id)).toEqual(["all"]);
  });
  it("labels draft, submitted and paid honestly", () => {
    expect(expenseStatusLabel("draft")).toContain("not posted");
    expect(expenseStatusLabel("submitted")).toContain("awaiting approval");
    expect(expenseStatusLabel("approved")).toContain("unpaid");
    expect(expenseStatusLabel("partially_paid")).toBe("Partially paid");
    expect(expenseStatusLabel("paid")).toBe("Paid");
  });
});
