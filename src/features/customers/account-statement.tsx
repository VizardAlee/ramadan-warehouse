"use client";

import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { callAdministration } from "@/features/administration/api";
import { Button } from "@/components/ui/button";
import { downloadCsv, formatNaira } from "@/features/inventory/format";
import { customerHistoryLabel, type CustomerHistory } from "./history-presentation";

export function CustomerAccountStatement({ result }: { result: CustomerHistory }) {
  const [completeRows, setCompleteRows] = useState<CustomerHistory["rows"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!completeRows) return;
    const timer = window.setTimeout(() => window.print(), 50);
    const done = () => setCompleteRows(null);
    window.addEventListener("afterprint", done);
    return () => { window.clearTimeout(timer); window.removeEventListener("afterprint", done); };
  }, [completeRows]);
  async function completeStatement(print: boolean) {
    if (!result.statement || busy) return;
    setBusy(true); setError(null);
    try {
      const rows: CustomerHistory["rows"] = [];
      let cursor: CustomerHistory["nextCursor"] = null;
      let scans = 0;
      do {
        const page: CustomerHistory = await callAdministration("getCustomerHistory", { customerId: result.customer.id, view: "statement", includeSummary: false, customerAccountId: result.statement.accountId ?? undefined, branchId: result.statement.branchId ?? undefined, fromDate: result.statement.fromDate ?? undefined, toDate: result.statement.toDate ?? undefined, limit: 100, cursor: cursor ?? undefined });
        rows.push(...page.rows); cursor = page.nextCursor;
        scans += 100;
        if (scans >= 10000 && cursor) throw new Error("This statement exceeds 10,000 entries. Select a shorter date range.");
      } while (cursor);
      if (print) setCompleteRows(rows);
      else downloadCsv("customer-statement.csv", rows.map(row => ({ date: row.at ?? "", activity: customerHistoryLabel(row.kind, row.detail, row.invoiceAllocations), reference: row.reference, arrangement: row.accountName ?? "General account", debtChangeNaira: row.debtChangeMinor == null ? "Needs review" : row.debtChangeMinor / 100, advanceChangeNaira: row.advanceChangeMinor == null ? "Needs review" : row.advanceChangeMinor / 100 })));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to prepare statement."); }
    finally { setBusy(false); }
  }
  const statement = result.statement;
  if (!statement) return null;
  const change = (value: number | null | undefined, positive: string, negative: string) => value == null ? "Needs review" : value === 0 ? "—" : `${value > 0 ? positive : negative} ${formatNaira(Math.abs(value))}`;
  return <> <section aria-label="Customer account statement" className="rounded-2xl border bg-white p-4 sm:p-6 customer-statement-screen">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
      <div><p className="text-xs uppercase tracking-widest text-[var(--muted)]">Credit and advances</p><h2 className="mt-1 font-serif text-2xl">Account statement</h2><p className="mt-1 text-sm">{statement.accountName} · {result.customer.name}</p></div>
      <div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => void completeStatement(true)}>{busy ? "Preparing…" : "Print / Save complete statement"}</Button><Button variant="outline" disabled={busy} onClick={() => void completeStatement(false)}>Export complete statement</Button></div>
    </div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <div className="rounded-xl bg-amber-50 p-4"><p className="text-sm">Currently owed by customer</p><strong className="text-xl finance-attention">{formatNaira(statement.outstandingMinor)}</strong></div>
      <div className="rounded-xl bg-blue-50 p-4"><p className="text-sm">Unused customer advance</p><strong className="text-xl finance-balance">{formatNaira(statement.advanceMinor)}</strong></div>
    </div>
    <p className="mt-3 text-xs text-[var(--muted)]">Current balances across all stores as at {new Date(statement.asOf).toLocaleString("en-NG")}. Store selection filters entries only. Debt and advances are separate balances, not netted against each other.</p>
    {error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
    <p className="mt-2 text-xs text-[var(--muted)]">Each account movement appears once. Cash sales without account movements remain in Activity. Recorded ledger balances below cover the selected dates and store; old unassigned entries stay in General.</p>
    {statement.openingDebtMinor !== undefined && <StatementBalances statement={statement} /> }
    <div className="responsive-table-wrap mt-4 hidden lg:block"><table className="responsive-table">
      <thead className="bg-slate-50"><tr><th className="p-3">Date / reference</th><th className="p-3">Activity / arrangement</th><th className="p-3">Customer debt</th><th className="p-3">Customer advance</th></tr></thead>
      <tbody>{result.rows.map(row => <tr key={row.id} className="border-t"><td className="p-3 text-sm">{row.at ? new Date(row.at).toLocaleString("en-NG") : "Date pending"}<span className="block font-mono text-xs text-[var(--muted)]">{row.reference}</span></td><td className="p-3 text-sm">{customerHistoryLabel(row.kind, row.detail)}<span className="block text-xs text-[var(--muted)]">{row.accountName}{row.needsReview && " · Classification needs review"}</span></td><td className={`p-3 text-sm font-semibold finance-${(row.debtChangeMinor ?? 0) > 0 ? "attention" : "income"}`}>{change(row.debtChangeMinor, "Added", "Cleared")}</td><td className="p-3 text-sm font-semibold finance-balance">{change(row.advanceChangeMinor, "Received", "Used / refunded")}</td></tr>)}</tbody>
    </table></div>
    <div className="mt-4 space-y-3 lg:hidden">{result.rows.map(row => <article key={row.id} className="rounded-xl border p-3 text-sm"><strong>{customerHistoryLabel(row.kind, row.detail)}</strong><p className="text-xs text-[var(--muted)]">{row.reference} · {row.accountName} · {row.at ? new Date(row.at).toLocaleString("en-NG") : "Date pending"}</p><p className="mt-2">Debt: {change(row.debtChangeMinor, "Added", "Cleared")}</p><p>Advance: {change(row.advanceChangeMinor, "Received", "Used / refunded")}</p>{row.needsReview && <p className="finance-attention">Classification needs review</p>}</article>)}</div>
    {!result.rows.length && <p className="p-6 text-center text-sm text-[var(--muted)]">{result.nextCursor ? "No matching arrangement entries in this page. Choose Next to continue through older entries." : "No matching account entries in this page."}</p>}
    <p className="mt-3 text-xs text-[var(--muted)]">{statement.scannedCount} ledger entries checked on this page. Pagination covers this page. Print and export include every matching page.</p>
  </section>
    {completeRows && createPortal(<section data-print-document className="customer-statement-print-only"><h1>AB Ramadan · Customer statement</h1><h2>{result.customer.name} · {result.customer.customerNumber}</h2><p>{statement.accountName} · {statement.fromDate ?? "Beginning of recorded history"} to {statement.toDate ?? "Latest recorded entry"} · {statement.branchId ? "Selected store" : "All stores"} · NGN</p><StatementBalances statement={statement} /><table><thead><tr><th>Date / reference</th><th>Activity / arrangement</th><th>Debt change</th><th>Advance change</th></tr></thead><tbody>{completeRows.map(row => <tr key={row.id}><td>{row.at ? new Date(row.at).toLocaleDateString("en-NG", { timeZone: "Africa/Lagos" }) : "Date pending"}<br />{row.reference}</td><td>{customerHistoryLabel(row.kind, row.detail, row.invoiceAllocations)}<br />{row.accountName}</td><td>{change(row.debtChangeMinor, "Added", "Cleared")}</td><td>{change(row.advanceChangeMinor, "Received", "Used / refunded")}</td></tr>)}</tbody></table><p>Recorded account ledger only. Historical balances without ledger entries require reconciliation. Generated {new Date(statement.asOf).toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}.</p></section>, document.body)}
  </>;
}

function StatementBalances({ statement }: { statement: NonNullable<CustomerHistory["statement"]> }) {
  return <div className="my-4"><h3 className="font-semibold">Recorded ledger balances</h3><div className="grid gap-2 sm:grid-cols-2">{([
    ["Opening debt", statement.openingDebtMinor], ["Closing debt", statement.closingDebtMinor],
    ["Debt added", statement.debtAddedMinor], ["Debt cleared", statement.debtClearedMinor],
    ["Opening advance", statement.openingAdvanceMinor], ["Closing advance", statement.closingAdvanceMinor],
    ["Advances received", statement.advanceReceivedMinor], ["Advances used / refunded", statement.advanceUsedMinor],
  ] as const).map(([label, amount]) => <p key={label} className="text-sm">{label}: <strong>{formatNaira(amount ?? 0)}</strong></p>)}</div><p className="mt-2 text-xs text-[var(--muted)]">Balances reflect recorded account entries in the selected scope. Historical balances without ledger entries require reconciliation.{statement.needsReview && " Some entries need classification review; these totals are incomplete."}</p></div>;

}
