"use client";

import { Download, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { useOrganizationCollection } from "@/features/administration/use-organization-collection";
import { useAuth } from "@/features/auth/auth-context";
import { formatNaira } from "@/features/inventory/format";
import { hasPermission } from "@/lib/permissions/roles";
import type { Branch } from "@/types/domain";

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
  branchId?: string | null;
  rows: StatementRow[];
  totalDebitMinor?: number;
  totalCreditMinor?: number;
  incomeMinor?: number;
  expenseMinor?: number;
  profitMinor?: number;
  assetsMinor?: number;
  liabilitiesMinor?: number;
  equityMinor?: number;
  netAssetsMinor?: number;
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
  const raw = String(value ?? "");
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function FinancialStatements() {
  const { profile, accessProfile, operatingContext } = useAuth();
  const branches = useOrganizationCollection<Branch>("branches");
  const canReadOrganization = Boolean(profile && hasPermission(profile, "sales.read.all"));
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const branchId = selectedBranchId || (!canReadOrganization ?
    (operatingContext?.type === "branch" ? operatingContext.id : accessProfile?.branchIds[0] ?? "") : "");
  const [reportType, setReportType] = useState<StatementType>("income_statement");
  const [fromDate, setFromDate] = useState(currentMonthStart);
  const [toDate, setToDate] = useState(today);
  const [result, setResult] = useState<StatementResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const reportKey = JSON.stringify([reportType, fromDate, toDate, branchId]);
  const currentResult = result?.reportType === reportType && result.fromDate === fromDate && result.toDate === toDate && (result.branchId ?? "") === branchId ? result : null;
  const validDates = Boolean(fromDate && toDate && fromDate <= toDate && (canReadOrganization || branchId));

  useEffect(() => {
    const version = ++requestVersion.current;
    const timer = window.setTimeout(() => {
      if (!validDates) {
        setBusy(false);
        return;
      }
      void (async () => {
        setBusy(true);
        setError(null);
        try {
          const statement: StatementResult = await callAdministration("generateFinancialStatement", { reportType, fromDate, toDate, branchId: branchId || undefined });
          if (version === requestVersion.current) setResult(statement);
        } catch (cause) {
          if (version !== requestVersion.current) return;
          setError(cause instanceof Error ? cause.message : "The statement could not be generated.");
          setErrorKey(reportKey);
        } finally {
          if (version === requestVersion.current) setBusy(false);
        }
      })();
    }, 250);
    return () => {
      window.clearTimeout(timer);
      requestVersion.current += 1;
    };
  }, [branchId, fromDate, reportKey, reportType, toDate, validDates]);
  function download() {
    if (!currentResult) return;
    const rows = currentResult.rows.map((row) => [
      row.section,
      row.accountCode,
      row.accountName,
      row.debitMinor === undefined ? "" : (row.debitMinor / 100).toFixed(2),
      row.creditMinor === undefined ? "" : (row.creditMinor / 100).toFixed(2),
      row.balanceMinor === undefined ? "" : (row.balanceMinor / 100).toFixed(2),
      row.amountMinor === undefined ? "" : (row.amountMinor / 100).toFixed(2),
    ]);
    const summary = ([
      ["Total debits", currentResult.totalDebitMinor],
      ["Total credits", currentResult.totalCreditMinor],
      ["Income", currentResult.incomeMinor],
      ["Expenses", currentResult.expenseMinor],
      ["Profit / (loss)", currentResult.profitMinor],
      ["Assets", currentResult.assetsMinor],
      ["Liabilities", currentResult.liabilitiesMinor],
      ["Equity", currentResult.equityMinor],
      ["Net assets", currentResult.netAssetsMinor],
      ["Net cash movement", currentResult.netCashMovementMinor],
    ] as const).flatMap(([label, amount]) => amount === undefined ? [] :
      [["Summary", "", label, "", "", "", (amount / 100).toFixed(2)]]);
    const csv = [
      ["section", "account_code", "account_name", "debit_naira", "credit_naira", "balance_naira", "amount_naira"],
      ...rows,
      ...summary,
    ].map((row) => row.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${currentResult.reportType}-${currentResult.fromDate}-to-${currentResult.toDate}.csv`;
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
        <label className="text-sm font-medium">Scope
          <select value={branchId} onChange={(event) => setSelectedBranchId(event.target.value)} className="mt-1 w-full rounded-lg border p-2.5">
            {canReadOrganization && <option value="">Entire organization</option>}
            {branches.data.filter((branch) => branch.status === "active" && (canReadOrganization || accessProfile?.branchIds.includes(branch.id))).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        </label>
      </section>
      {!validDates && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Select a valid date range and an assigned store.</p>}
      {validDates && !currentResult && !(error && errorKey === reportKey) && <p role="status" className="flex items-center gap-2 text-sm text-[var(--muted)]"><Loader2 className="size-4 animate-spin" /> Updating statement…</p>}
      {error && errorKey === reportKey && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {currentResult && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">{labels[currentResult.reportType]}</h2>
              <p className="text-sm text-[var(--muted)]">{currentResult.fromDate} to {currentResult.toDate} · {branches.data.find((branch) => branch.id === branchId)?.name ?? "Entire organization"} · NGN</p>
            </div>
            <Button variant="secondary" disabled={busy} onClick={download}><Download className="mr-2 size-4" /> Download CSV</Button>
          </div>
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            These are ledger-derived draft statements. The balance sheet includes cumulative unclosed earnings; the cash-flow grouping follows posted journal types. Review classifications, opening balances, adjustments, and any unmatched entries before external use.
            {currentResult.reportType === "balance_sheet" && currentResult.balanced === false && " The balance sheet does not balance; investigate the ledger before relying on it."}
          </p>
          <div className="responsive-table-wrap">
            <table className="responsive-table text-sm">
              <thead className="bg-slate-50"><tr><th className="px-3 py-2">Section</th><th className="px-3 py-2">Account</th><th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th><th className="px-3 py-2 text-right">Amount</th></tr></thead>
              <tbody>
                {currentResult.rows.map((row, index) => (
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
            {currentResult.totalDebitMinor !== undefined && <Summary label="Total debits" value={currentResult.totalDebitMinor} />}
            {currentResult.totalCreditMinor !== undefined && <Summary label="Total credits" value={currentResult.totalCreditMinor} />}
            {currentResult.incomeMinor !== undefined && <Summary label="Income" value={currentResult.incomeMinor} />}
            {currentResult.expenseMinor !== undefined && <Summary label="Expenses" value={currentResult.expenseMinor} />}
            {currentResult.profitMinor !== undefined && <Summary label="Profit / (loss)" value={currentResult.profitMinor} />}
            {currentResult.assetsMinor !== undefined && <Summary label="Assets" value={currentResult.assetsMinor} />}
            {currentResult.liabilitiesMinor !== undefined && <Summary label="Liabilities" value={currentResult.liabilitiesMinor} />}
            {currentResult.equityMinor !== undefined && <Summary label="Equity" value={currentResult.equityMinor} />}
            {currentResult.netAssetsMinor !== undefined && <Summary label="Net assets (assets − liabilities)" value={currentResult.netAssetsMinor} />}
            {currentResult.netCashMovementMinor !== undefined && <Summary label="Net cash movement" value={currentResult.netCashMovementMinor} />}
          </section>
          {currentResult.reportType === "balance_sheet" && branchId && <p className="text-xs text-[var(--muted)]">Store net assets include branch-tagged ledger entries only; centrally held assets and liabilities remain in the organization view.</p>}
        </>
      )}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl border bg-white p-4"><span className="text-sm text-[var(--muted)]">{label}</span><strong className="mt-2 block text-xl">{formatNaira(value)}</strong></div>;
}
