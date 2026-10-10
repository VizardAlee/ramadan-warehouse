import { customerHistoryLabel, type CustomerHistory } from "./history-presentation";

export type Statement = NonNullable<CustomerHistory["statement"]>;
export type StatementRow = CustomerHistory["rows"][number];
const review = "Needs review";
export const statementDebit = (amount: number | null | undefined) => amount == null ? null : Math.max(0, amount);
export const statementCredit = (amount: number | null | undefined) => amount == null ? null : Math.max(0, -amount);
export function statementDate(at: string | null) {
  return at ? new Date(at).toLocaleString("en-GB", { timeZone: "Africa/Lagos", hour12: false }) : "Date pending";
}

// Server pages are newest first, with document IDs descending for equal dates.
// Reverse the complete sequence once so print and CSV are chronological and use
// exactly the same tie ordering as the running balances on screen.
export function completeStatementRows(rows: StatementRow[], statement: Statement): StatementRow[] {
  let debt = statement.openingDebtMinor ?? null;
  let advance = statement.openingAdvanceMinor ?? null;
  const chronological = [...rows].reverse().map(row => {
    debt = debt === null || row.debtChangeMinor == null ? null : debt + row.debtChangeMinor;
    advance = advance === null || row.advanceChangeMinor == null ? null : advance + row.advanceChangeMinor;
    if ([debt, advance].some(value => value !== null && !Number.isSafeInteger(value))) throw new Error("Statement exceeds safe minor-unit arithmetic.");
    return { ...row, runningDebtMinor: debt, runningAdvanceMinor: advance };
  });
  const totals = {
    debtAddedMinor: rows.reduce((sum, row) => sum + Math.max(0, row.debtChangeMinor ?? 0), 0),
    debtClearedMinor: rows.reduce((sum, row) => sum + Math.max(0, -(row.debtChangeMinor ?? 0)), 0),
    advanceReceivedMinor: rows.reduce((sum, row) => sum + Math.max(0, row.advanceChangeMinor ?? 0), 0),
    advanceUsedMinor: rows.reduce((sum, row) => sum + Math.max(0, -(row.advanceChangeMinor ?? 0)), 0),
  };
  if ((statement.closingDebtMinor !== undefined && statement.closingDebtMinor !== debt)
    || (statement.closingAdvanceMinor !== undefined && statement.closingAdvanceMinor !== advance)
    || Object.entries(totals).some(([key, total]) => statement[key as keyof typeof totals] !== undefined && statement[key as keyof typeof totals] !== total))
    throw new Error("Statement changed while preparing it. Refresh and try again.");
  return chronological;
}

export function statementCsv(rows: StatementRow[], statement: Statement, customer?: CustomerHistory["customer"]) {
  const identity = { customerName: customer?.name ?? "", customerNumber: customer?.customerNumber ?? "", storeScope: statement.branchId ?? "All stores", generatedAtLagos: statementDate(statement.asOf) };
  const naira = (amount: number | null | undefined) => amount == null ? review : amount / 100;
  const boundary = (type: "Opening" | "Closing") => ({
    ...identity, rowType: type.toLowerCase(), dateLagos: (type === "Opening" ? statement.fromDate : statement.toDate) ?? "",
    reference: "", description: `${type} recorded balance`, arrangement: statement.accountName,
    debtDebitNaira: "", debtCreditNaira: "", debtMovementNaira: "",
    runningDebtNaira: naira(type === "Opening" ? statement.openingDebtMinor : statement.closingDebtMinor),
    advanceReceivedNaira: "", advanceUsedNaira: "", advanceMovementNaira: "",
    runningAdvanceNaira: naira(type === "Opening" ? statement.openingAdvanceMinor : statement.closingAdvanceMinor),
    periodFrom: statement.fromDate ?? "Beginning of recorded history", periodTo: statement.toDate ?? "Latest recorded entry",
  });
  return [boundary("Opening"), ...rows.map(row => ({
    ...identity, rowType: "transaction", dateLagos: statementDate(row.at), reference: row.reference,
    description: customerHistoryLabel(row.kind, row.detail, row.invoiceAllocations), arrangement: row.accountName ?? "General account",
    debtDebitNaira: naira(statementDebit(row.debtChangeMinor)), debtCreditNaira: naira(statementCredit(row.debtChangeMinor)),
    debtMovementNaira: naira(row.debtChangeMinor), runningDebtNaira: naira(row.runningDebtMinor),
    advanceReceivedNaira: naira(statementDebit(row.advanceChangeMinor)), advanceUsedNaira: naira(statementCredit(row.advanceChangeMinor)),
    advanceMovementNaira: naira(row.advanceChangeMinor), runningAdvanceNaira: naira(row.runningAdvanceMinor),
    periodFrom: statement.fromDate ?? "Beginning of recorded history", periodTo: statement.toDate ?? "Latest recorded entry",
  })), boundary("Closing")];
}
