"use client";

import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { formatNaira } from "@/features/inventory/format";

type StatementType =
  | "trial_balance"
  | "income_statement"
  | "balance_sheet"
  | "cash_flow";
interface StatementRow {
  section?: string;
  accountCode?: string;
  accountName?: string;
  debitMinor?: number;
  creditMinor?: number;
  balanceMinor?: number;
  amountMinor?: number;
}
interface StatementResult {
  reportType: StatementType;
  fromDate: string;
  toDate: string;
  rows: StatementRow[];
  totalDebitMinor?: number;
  totalCreditMinor?: number;
  incomeMinor?: number;
  expenseMinor?: number;
  profitMinor?: number;
  assetsMinor?: number;
  liabilitiesMinor?: number;
  equityMinor?: number;
  balanced?: boolean;
  netCashMovementMinor?: number;
}
const labels: Record<StatementType, string> = {
  trial_balance: "Trial balance",
  income_statement: "Income statement",
  balance_sheet: "Balance sheet",
  cash_flow: "Cash-flow statement",
};
function currentMonthStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
function csvCell(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export function FinancialStatements() {
  const [reportType, setReportType] = useState<StatementType>("income_statement");
  const [fromDate, setFromDate] = useState(currentMonthStart);
  const [toDate, setToDate] = useState(today);
  const [result, setResult] = useState<StatementResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      setResult(
        await callAdministration("generateFinancialStatement", {
          reportType,
          fromDate,
          toDate,
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The statement could not be generated.");
    } finally {
      setBusy(false);
    }
  }
  function download() {
    if (!result) return;
    const rows = result.rows.map((row) => [
      row.section,
      row.accountCode,
      row.accountName,
      row.debitMinor === undefined ? "" : (row.debitMinor / 100).toFixed(2),
      row.creditMinor === undefined ? "" : (row.creditMinor / 100).toFixed(2),
      row.balanceMinor === undefined ? "" : (row.balanceMinor / 100).toFixed(2),
      row.amountMinor === undefined ? "" : (row.amountMinor / 100).toFixed(2),
    ]);
    const csv = [
      ["section", "account_code", "account_name", "debit_naira", "credit_naira", "balance_naira", "amount_naira"],
      ...rows,
    ].map((row) => row.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${result.reportType}-${result.fromDate}-to-${result.toDate}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <section className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-4">
        <label className="text-sm font-medium">
          Statement
          <select value={reportType} onChange={(event) => setReportType(event.target.value as StatementType)} className="mt-1 w-full rounded-lg border p-2.5">
            {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">
          From date
          <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="mt-1 w-full rounded-lg border p-2.5" />
        </label>
        <label className="text-sm font-medium">
          To date
          <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="mt-1 w-full rounded-lg border p-2.5" />
        </label>
        <Button className="self-end" disabled={busy || !fromDate || !toDate} onClick={() => void load()}>
          {busy && <Loader2 className="mr-2 size-4 animate-spin" />} Generate
        </Button>
      </section>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {result && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">{labels[result.reportType]}</h2>
              <p className="text-sm text-[var(--muted)]">{result.fromDate} to {result.toDate} · NGN</p>
            </div>
            <Button variant="secondary" onClick={download}><Download className="mr-2 size-4" /> Download CSV</Button>
          </div>
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            These are ledger-derived draft statements. The balance sheet includes cumulative unclosed earnings; the cash-flow grouping follows posted journal types. Review classifications, opening balances, adjustments, and any unmatched entries before external use.
            {result.reportType === "balance_sheet" && result.balanced === false && " The balance sheet does not balance; investigate the ledger before relying on it."}
          </p>
          <div className="responsive-table-wrap">
            <table className="responsive-table text-sm">
              <thead className="bg-slate-50"><tr><th className="px-3 py-2">Section</th><th className="px-3 py-2">Account</th><th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th><th className="px-3 py-2 text-right">Amount</th></tr></thead>
              <tbody>
                {result.rows.map((row, index) => (
                  <tr key={`${row.section}-${row.accountCode}-${index}`} className="border-t">
                    <td data-label="Section" className="px-3 py-2">{row.section ?? "Trial balance"}</td>
                    <td data-label="Account" className="px-3 py-2"><strong>{row.accountName ?? row.section}</strong>{row.accountCode && <span className="ml-2 font-mono text-xs text-[var(--muted)]">{row.accountCode}</span>}</td>
                    <td data-label="Debit" className="px-3 py-2 text-right">{row.debitMinor === undefined ? "—" : formatNaira(row.debitMinor)}</td>
                    <td data-label="Credit" className="px-3 py-2 text-right">{row.creditMinor === undefined ? "—" : formatNaira(row.creditMinor)}</td>
                    <td data-label="Amount" className="px-3 py-2 text-right font-semibold">{formatNaira(row.amountMinor ?? row.balanceMinor ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {result.totalDebitMinor !== undefined && <Summary label="Total debits" value={result.totalDebitMinor} />}
            {result.totalCreditMinor !== undefined && <Summary label="Total credits" value={result.totalCreditMinor} />}
            {result.incomeMinor !== undefined && <Summary label="Income" value={result.incomeMinor} />}
            {result.expenseMinor !== undefined && <Summary label="Expenses" value={result.expenseMinor} />}
            {result.profitMinor !== undefined && <Summary label="Profit / (loss)" value={result.profitMinor} />}
            {result.assetsMinor !== undefined && <Summary label="Assets" value={result.assetsMinor} />}
            {result.liabilitiesMinor !== undefined && <Summary label="Liabilities" value={result.liabilitiesMinor} />}
            {result.equityMinor !== undefined && <Summary label="Equity" value={result.equityMinor} />}
            {result.netCashMovementMinor !== undefined && <Summary label="Net cash movement" value={result.netCashMovementMinor} />}
          </section>
        </>
      )}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl border bg-white p-4"><span className="text-sm text-[var(--muted)]">{label}</span><strong className="mt-2 block text-xl">{formatNaira(value)}</strong></div>;
}
