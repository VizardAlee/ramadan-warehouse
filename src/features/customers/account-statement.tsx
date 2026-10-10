"use client";

import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { callAdministration } from "@/features/administration/api";
import { Button } from "@/components/ui/button";
import { downloadCsv, formatNaira } from "@/features/inventory/format";
import { customerHistoryLabel, type CustomerHistory } from "./history-presentation";
import { completeStatementRows, statementCredit, statementCsv, statementDate, statementDebit, type Statement, type StatementRow } from "./statement-presentation";

const money = (value: number | null | undefined) => value == null ? "Needs review" : formatNaira(value);
const movement = (value: number | null | undefined) => value === 0 ? "—" : money(value);

export function CustomerAccountStatement({ result }: { result: CustomerHistory }) {
  const [complete, setComplete] = useState<{ rows: StatementRow[]; statement: Statement } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!complete) return;
    const timer = window.setTimeout(() => window.print(), 50);
    const done = () => setComplete(null);
    window.addEventListener("afterprint", done);
    return () => { window.clearTimeout(timer); window.removeEventListener("afterprint", done); };
  }, [complete]);
  async function completeStatement(print: boolean) {
    if (!result.statement || busy) return;
    setBusy(true); setError(null);
    try {
      const rows: StatementRow[] = [];
      let cursor: CustomerHistory["nextCursor"] = null;
      let summary: Statement | undefined;
      let scans = 0;
      do {
        const page: CustomerHistory = await callAdministration("getCustomerHistory", { customerId: result.customer.id, view: "statement", includeSummary: !summary, customerAccountId: result.statement.accountId ?? undefined, branchId: result.statement.branchId ?? undefined, fromDate: result.statement.fromDate ?? undefined, toDate: result.statement.toDate ?? undefined, limit: 100, cursor: cursor ?? undefined });
        if (!summary) summary = page.statement;
        if (!summary || summary.openingDebtMinor === undefined || summary.openingAdvanceMinor === undefined) throw new Error("Statement balances are unavailable. Refresh and try again.");
        rows.push(...page.rows); cursor = page.nextCursor;
        scans += 100;
        if (scans >= 10000 && cursor) throw new Error("This statement exceeds 10,000 entries. Select a shorter date range.");
      } while (cursor);
      const chronological = completeStatementRows(rows, summary);
      if (print) setComplete({ rows: chronological, statement: summary });
      else downloadCsv("customer-statement.csv", statementCsv(chronological, summary, result.customer));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to prepare statement."); }
    finally { setBusy(false); }
  }
  const statement = result.statement;
  if (!statement) return null;
  return <>
    <section aria-label="Customer account statement" className="rounded-2xl border bg-white p-4 sm:p-6 customer-statement-screen">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
        <div><p className="text-xs uppercase tracking-widest text-[var(--muted)]">Credit and advances</p><h2 className="mt-1 font-serif text-2xl">Account statement</h2><p className="mt-1 text-sm">{statement.accountName} · {result.customer.name}</p></div>
        <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => void completeStatement(true)}>{busy ? "Preparing…" : "Print / Save complete statement"}</Button><Button variant="outline" disabled={busy} onClick={() => void completeStatement(false)}>Export complete statement</Button></div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-amber-50 p-4"><p className="text-sm">Currently owed by customer</p><strong className="text-xl finance-attention">{formatNaira(statement.outstandingMinor)}</strong></div>
        <div className="rounded-xl bg-blue-50 p-4"><p className="text-sm">Unused customer advance</p><strong className="text-xl finance-balance">{formatNaira(statement.advanceMinor)}</strong></div>
      </div>
      <p className="mt-3 text-xs text-[var(--muted)]">Current balances across all stores as at {statementDate(statement.asOf)} (Lagos). Store selection filters entries only. Debt and advances are separate balances, not netted against each other.</p>
      {error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
      <p className="mt-2 text-xs text-[var(--muted)]">Each account movement appears once. Cash sales without account movements remain in Activity. Recorded ledger balances below cover the selected dates and store; old unassigned entries stay in General.</p>
      {statement.openingDebtMinor !== undefined && <StatementBalances statement={statement} />}
      <p className="mt-3 text-xs text-[var(--muted)]">Newest transactions first. Each balance is the amount after that transaction, including earlier entries in the selected scope. Debt debit adds to debt; debt credit clears debt. Advances received and used are shown separately. Dates are Lagos time.</p>
      <div className="responsive-table-wrap mt-4 hidden lg:block"><StatementTable rows={result.rows} statement={statement} /></div>
      <div className="mt-4 space-y-3 lg:hidden">{result.rows.map(row => <article key={row.id} className="rounded-xl border p-3 text-sm">
        <strong>{customerHistoryLabel(row.kind, row.detail, row.invoiceAllocations)}</strong><p className="text-xs text-[var(--muted)]">{row.reference} · {row.accountName} · {statementDate(row.at)}</p>
        <p className="mt-2">Debt debit: {movement(statementDebit(row.debtChangeMinor))} · Credit: {movement(statementCredit(row.debtChangeMinor))}</p>
        <p className="font-semibold">Debt balance: {money(row.runningDebtMinor)}</p>
        <p>Advance received: {movement(statementDebit(row.advanceChangeMinor))} · Used / refunded: {movement(statementCredit(row.advanceChangeMinor))}</p>
        <p className="font-semibold">Advance balance: {money(row.runningAdvanceMinor)}</p>
        {row.needsReview && <p className="finance-attention">Classification needs review</p>}
      </article>)}</div>
      {!result.rows.length && <p className="p-6 text-center text-sm text-[var(--muted)]">{result.nextCursor ? "No matching arrangement entries in this page. Choose Next to continue through older entries." : "No matching account entries in this page."}</p>}
      <p className="mt-3 text-xs text-[var(--muted)]">{statement.scannedCount} ledger entries checked on this page. Print and export include opening balances, every matching transaction in chronological order, and closing balances.</p>
    </section>
    {complete && createPortal(<section data-print-document className="customer-statement-print-only">
      <h1>AB Ramadan · Customer statement</h1><h2>{result.customer.name} · {result.customer.customerNumber}</h2>
      <p>{complete.statement.accountName} · {complete.statement.fromDate ?? "Beginning of recorded history"} to {complete.statement.toDate ?? "Latest recorded entry"} · {complete.statement.branchId ? "Selected store" : "All stores"} · NGN · Lagos time</p>
      <StatementBalances statement={complete.statement} /><StatementTable rows={complete.rows} statement={complete.statement} />
      <p>Debt debit adds to debt; debt credit clears debt. Advances remain separate. Recorded account ledger only. Historical balances without ledger entries require reconciliation. Generated {statementDate(complete.statement.asOf)} (Lagos).</p>
    </section>, document.body)}
  </>;
}

function StatementTable({ rows, statement }: { rows: StatementRow[]; statement: Statement }) {
  return <table className="responsive-table min-w-[1100px]">
    <thead className="bg-slate-50"><tr>{["Date / reference", "Description / arrangement", "Debt debit", "Debt credit", "Debt balance", "Advance received", "Advance used / refunded", "Advance balance"].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead>
    <tbody>
      <BalanceRow title="Opening recorded balance" debt={statement.openingDebtMinor} advance={statement.openingAdvanceMinor} />
      {rows.map(row => <tr key={row.id} className="border-t">
        <td className="p-3 text-sm">{statementDate(row.at)}<span className="block font-mono text-xs">{row.reference}</span></td>
        <td className="p-3 text-sm">{customerHistoryLabel(row.kind, row.detail, row.invoiceAllocations)}<span className="block text-xs">{row.accountName}{row.needsReview && " · Classification needs review"}</span></td>
        <td className="p-3 text-sm">{movement(statementDebit(row.debtChangeMinor))}</td><td className="p-3 text-sm">{movement(statementCredit(row.debtChangeMinor))}</td>
        <td className="p-3 text-sm font-semibold">{money(row.runningDebtMinor)}</td>
        <td className="p-3 text-sm">{movement(statementDebit(row.advanceChangeMinor))}</td><td className="p-3 text-sm">{movement(statementCredit(row.advanceChangeMinor))}</td>
        <td className="p-3 text-sm font-semibold">{money(row.runningAdvanceMinor)}</td>
      </tr>)}
      <BalanceRow title="Closing recorded balance" debt={statement.closingDebtMinor} advance={statement.closingAdvanceMinor} />
    </tbody>
  </table>;
}
function BalanceRow({ title, debt, advance }: { title: string; debt?: number | null; advance?: number | null }) {
  return <tr className="border-t bg-slate-50 font-semibold"><td colSpan={2} className="p-3">{title}</td><td /><td /><td className="p-3">{money(debt)}</td><td /><td /><td className="p-3">{money(advance)}</td></tr>;
}
function StatementBalances({ statement }: { statement: Statement }) {
  return <div className="my-4"><h3 className="font-semibold">Recorded ledger balances</h3><div className="grid gap-2 sm:grid-cols-2">{([
    ["Opening debt", statement.openingDebtMinor], ["Closing debt", statement.closingDebtMinor],
    ["Debt added", statement.debtAddedMinor], ["Debt cleared", statement.debtClearedMinor],
    ["Opening advance", statement.openingAdvanceMinor], ["Closing advance", statement.closingAdvanceMinor],
    ["Advances received", statement.advanceReceivedMinor], ["Advances used / refunded", statement.advanceUsedMinor],
  ] as const).map(([label, amount]) => <p key={label} className="text-sm">{label}: <strong>{money(amount)}</strong></p>)}</div><p className="mt-2 text-xs text-[var(--muted)]">Balances reflect recorded account entries in the selected scope. Historical balances without ledger entries require reconciliation.{statement.needsReview && " Some entries need classification review; affected balances are marked Needs review and movement totals include classified entries only."}</p></div>;
}
