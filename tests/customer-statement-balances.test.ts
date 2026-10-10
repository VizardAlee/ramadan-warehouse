import { describe, expect, it } from "vitest";
import { completeStatementRows, statementCsv, statementDate, type Statement, type StatementRow } from "@/features/customers/statement-presentation";
const statement: Statement = { accountId: "general", accountName: "General", outstandingMinor: 0, advanceMinor: 0, asOf: "2033-03-01T00:00:00Z", scannedCount: 0, fromDate: "2033-03-01", toDate: "2033-03-01", openingDebtMinor: 10000, openingAdvanceMinor: 5000, closingDebtMinor: 6000, closingAdvanceMinor: 6500, debtAddedMinor: 0, debtClearedMinor: 4000, advanceReceivedMinor: 3000, advanceUsedMinor: 1500 };
function row(id: string, debt: number | null, advance: number | null): StatementRow {
  return { id, kind: "account", reference: id, branchId: "b1", amountMinor: debt ?? advance ?? 0, detail: "payment", at: "2033-02-28T23:30:00Z", debtChangeMinor: debt, advanceChangeMinor: advance };
}
describe("complete statement running balances", () => {
  it("keeps opening debt and advances separate across repayments, advances, applications, returns and refunds", () => {
    const rows = completeStatementRows([row("refund", 0, -500), row("return", -2000, 0), row("apply", -1000, -1000), row("advance", 0, 3000), row("payment", -1000, 0)], statement);
    expect(rows.map(r => [r.id, r.runningDebtMinor, r.runningAdvanceMinor])).toEqual([["payment", 9000, 5000], ["advance", 9000, 8000], ["apply", 8000, 7000], ["return", 6000, 7000], ["refund", 6000, 6500]]);
    const csv = statementCsv(rows, statement);
    expect(csv[0]).toMatchObject({ rowType: "opening", runningDebtNaira: 100, runningAdvanceNaira: 50, periodFrom: "2033-03-01", periodTo: "2033-03-01" });
    expect(csv[1]).toMatchObject({ rowType: "transaction", reference: "payment", debtDebitNaira: 0, debtCreditNaira: 10, debtMovementNaira: -10, runningDebtNaira: 90, runningAdvanceNaira: 50 });
    expect(csv.at(-1)).toMatchObject({ rowType: "closing", runningDebtNaira: 60, runningAdvanceNaira: 65 });
  });
  it("keeps server ordering for same-time entries by reversing the complete page sequence", () => {
    const rows = completeStatementRows([row("b", -3000, 0), row("a", 2000, 0)], { ...statement, closingDebtMinor: 9000, closingAdvanceMinor: 5000, debtAddedMinor: 2000, debtClearedMinor: 3000, advanceReceivedMinor: 0, advanceUsedMinor: 0 });
    expect(rows.map(r => [r.id, r.runningDebtMinor])).toEqual([["a", 12000], ["b", 9000]]);
  });
  it("keeps unknown classifications unknown from the affected transaction onward without poisoning the other balance", () => {
    const rows = completeStatementRows([row("after", -1000, -500), row("unknown", null, 0), row("before", -1000, 0)], { ...statement, closingDebtMinor: null, closingAdvanceMinor: 4500, debtClearedMinor: 2000, advanceReceivedMinor: 0, advanceUsedMinor: 500 });
    expect(rows.map(r => [r.runningDebtMinor, r.runningAdvanceMinor])).toEqual([[9000, 5000], [null, 5000], [null, 4500]]);
    expect(statementCsv(rows, { ...statement, closingDebtMinor: null })[2]).toMatchObject({ debtDebitNaira: "Needs review", debtCreditNaira: "Needs review", debtMovementNaira: "Needs review", runningDebtNaira: "Needs review", runningAdvanceNaira: 50 });
  });
  it("does not turn unknown opening balances into zero", () => {
    const rows = completeStatementRows([row("payment", -1000, 0)], { ...statement, openingDebtMinor: null, closingDebtMinor: null, closingAdvanceMinor: 5000, debtClearedMinor: 1000, advanceReceivedMinor: 0, advanceUsedMinor: 0 });
    expect(rows[0]).toMatchObject({ runningDebtMinor: null, runningAdvanceMinor: 5000 });
  });
  it("exports opening and closing balances for an empty period", () => {
    const empty = { ...statement, closingDebtMinor: 10000, closingAdvanceMinor: 5000, debtClearedMinor: 0, advanceReceivedMinor: 0, advanceUsedMinor: 0 };
    expect(completeStatementRows([], empty)).toEqual([]);
    expect(statementCsv([], empty).map(r => [r.rowType, r.runningDebtNaira, r.runningAdvanceNaira])).toEqual([["opening", 100, 50], ["closing", 100, 50]]);
  });
  it("refuses a truncated or changed export instead of printing an inconsistent closing balance", () => {
    expect(() => completeStatementRows([row("payment", -1000, 0)], statement)).toThrow("Statement changed");
    expect(() => completeStatementRows([row("payment", -4000, 1500)], statement)).toThrow("Statement changed");
  });
  it("renders export dates in Lagos independently of the viewer timezone", () => {
    expect(statementDate("2033-02-28T23:30:00Z")).toContain("01/03/2033");
  });
});
