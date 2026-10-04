"use client";

import { Download, Loader2, Printer } from "lucide-react";
import Image from "next/image";
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
function statementMoney(value: number | undefined) {
  if (value === undefined || value === 0) return "—";
  return value < 0 ? `(${formatNaira(Math.abs(value))})` : formatNaira(value);
}
function statementDate(value: string) {
  return new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function StatementLine({ label, value, kind = "item" }: { label: string; value?: number; kind?: "item" | "subtotal" | "total" }) {
  return (
    <div className={`financial-statement-line financial-statement-line--${kind}`}>
      <span>{label}</span><span className="financial-statement-amount">{statementMoney(value)}</span>
    </div>
  );
}

function StatementSection({ title, rows, totalLabel, total }: { title: string; rows: StatementRow[]; totalLabel?: string; total?: number }) {
  return (
    <section className="financial-statement-section" aria-label={title}>
      <h3>{title}</h3>
      {rows.length === 0 ? <p className="financial-statement-empty">No posted activity in this section</p> : rows.map((row, index) => (
        <StatementLine key={`${row.accountCode ?? row.section}-${index}`} label={row.accountName ?? row.section ?? "Other"} value={row.amountMinor} />
      ))}
      {totalLabel && <StatementLine label={totalLabel} value={total} kind="subtotal" />}
    </section>
  );
}

function StatementDocument({ statement, scope }: { statement: StatementResult; scope: string }) {
  const period = statement.reportType === "balance_sheet" || statement.reportType === "trial_balance"
    ? `As at ${statementDate(statement.toDate)}`
    : `For the period ${statementDate(statement.fromDate)} to ${statementDate(statement.toDate)}`;
  const sectionRows = (section: string) => statement.rows.filter((row) => row.section === section);
  return (
    <article className="financial-statement-document" data-financial-statement aria-label={`${labels[statement.reportType]} for ${scope}`}>
      <header className="financial-statement-header">
        <div className="financial-statement-brand"><Image src="/abr-logo.jpg" alt="AB Ramadan logo" width={36} height={36} /><span>AB Ramadan</span></div>
        <div className="financial-statement-eyebrow">Financial report · Draft</div>
        <h2>{labels[statement.reportType]}</h2>
        <p>{period}</p>
        <div className="financial-statement-meta"><span>{scope}</span><span>Amounts in Nigerian naira (NGN)</span></div>
      </header>
      <div className="financial-statement-body">
        {statement.reportType === "income_statement" && <>
          <StatementSection title="Income" rows={sectionRows("Income")} totalLabel="Total income" total={statement.incomeMinor} />
          <StatementSection title="Expenses" rows={sectionRows("Expenses")} totalLabel="Total expenses" total={statement.expenseMinor} />
          <StatementLine label="Net profit / (loss)" value={statement.profitMinor} kind="total" />
        </>}
        {statement.reportType === "balance_sheet" && <>
          <StatementSection title="Assets" rows={sectionRows("Assets")} totalLabel="Total assets" total={statement.assetsMinor} />
          <StatementSection title="Liabilities" rows={sectionRows("Liabilities")} totalLabel="Total liabilities" total={statement.liabilitiesMinor} />
          <StatementSection title="Equity" rows={sectionRows("Equity")} totalLabel="Total equity" total={statement.equityMinor} />
          <StatementLine label="Total liabilities and equity" value={(statement.liabilitiesMinor ?? 0) + (statement.equityMinor ?? 0)} kind="total" />
          {statement.balanced === false && <p className="financial-statement-warning">This statement does not balance. Investigate the ledger before relying on it.</p>}
        </>}
        {statement.reportType === "cash_flow" && <>
          {statement.rows.map((row, index) => <section className="financial-statement-section" key={`${row.section}-${index}`} aria-label={row.section ?? "Other activities"}><h3>{row.section ?? "Other activities"}</h3><StatementLine label={`Net cash from ${row.section?.toLowerCase() ?? "other activities"}`} value={row.amountMinor} kind="subtotal" /></section>)}
          <StatementLine label="Net increase / (decrease) in cash" value={statement.netCashMovementMinor} kind="total" />
        </>}
        {statement.reportType === "trial_balance" && <div className="financial-statement-trial-wrap"><table className="financial-statement-trial"><thead><tr><th scope="col">Account</th><th scope="col">Debit</th><th scope="col">Credit</th></tr></thead><tbody>{statement.rows.map((row, index) => <tr key={`${row.accountCode}-${index}`}><td>{row.accountName}{row.accountCode && <small>{row.accountCode}</small>}</td><td>{statementMoney(row.debitMinor)}</td><td>{statementMoney(row.creditMinor)}</td></tr>)}</tbody><tfoot><tr><th scope="row">Total</th><td>{statementMoney(statement.totalDebitMinor)}</td><td>{statementMoney(statement.totalCreditMinor)}</td></tr></tfoot></table></div>}
      </div>
      <footer className="financial-statement-footer">Ledger-derived draft · Review before external use</footer>
    </article>
  );
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
          <div className="flex flex-wrap items-center justify-between gap-3" data-no-print>
            <div>
              <h2 className="text-xl font-semibold">{labels[currentResult.reportType]}</h2>
              <p className="text-sm text-[var(--muted)]">{currentResult.fromDate} to {currentResult.toDate} · {branches.data.find((branch) => branch.id === branchId)?.name ?? "Entire organization"} · NGN</p>
            </div>
            <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy} onClick={() => window.print()}><Printer className="mr-2 size-4" /> Print / Save PDF</Button><Button variant="secondary" disabled={busy} onClick={download}><Download className="mr-2 size-4" /> Download CSV</Button></div>
          </div>
          <StatementDocument statement={currentResult} scope={branches.data.find((branch) => branch.id === branchId)?.name ?? "Entire organization"} />
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900" data-no-print>
            These are ledger-derived draft statements. The balance sheet includes cumulative unclosed earnings; the cash-flow grouping follows posted journal types. Review classifications, opening balances, adjustments, and any unmatched entries before external use.
            {currentResult.reportType === "balance_sheet" && currentResult.balanced === false && " The balance sheet does not balance; investigate the ledger before relying on it."}
          </p>
          {currentResult.reportType === "balance_sheet" && branchId && <p className="text-xs text-[var(--muted)]" data-no-print>Store net assets include branch-tagged ledger entries only; centrally held assets and liabilities remain in the organization view.</p>}
        </>
      )}
    </div>
  );
}
