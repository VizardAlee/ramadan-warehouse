import { Button } from "@/components/ui/button";
import { downloadCsv, formatNaira } from "@/features/inventory/format";
import { customerHistoryLabel, type CustomerHistory } from "./history-presentation";

export function CustomerAccountStatement({ result }: { result: CustomerHistory }) {
  const statement = result.statement;
  if (!statement) return null;
  const change = (value: number | null | undefined, positive: string, negative: string) => value == null ? "Needs review" : value === 0 ? "—" : `${value > 0 ? positive : negative} ${formatNaira(Math.abs(value))}`;
  return <section aria-label="Customer account statement" className="rounded-2xl border bg-white p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
      <div><p className="text-xs uppercase tracking-widest text-[var(--muted)]">Credit and advances</p><h2 className="mt-1 font-serif text-2xl">Account statement</h2><p className="mt-1 text-sm">{statement.accountName} · {result.customer.name}</p></div>
      <Button variant="outline" disabled={!result.rows.length} onClick={() => downloadCsv("customer-statement-page.csv", result.rows.map(row => ({ date: row.at ?? "", activity: customerHistoryLabel(row.kind, row.detail), reference: row.reference, arrangement: row.accountName ?? "General account", debtChangeNaira: row.debtChangeMinor == null ? "Needs review" : row.debtChangeMinor / 100, advanceChangeNaira: row.advanceChangeMinor == null ? "Needs review" : row.advanceChangeMinor / 100, journal: row.journalEntryId ?? "" })))}>Export this statement page</Button>
    </div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <div className="rounded-xl bg-amber-50 p-4"><p className="text-sm">Currently owed by customer</p><strong className="text-xl finance-attention">{formatNaira(statement.outstandingMinor)}</strong></div>
      <div className="rounded-xl bg-blue-50 p-4"><p className="text-sm">Unused customer advance</p><strong className="text-xl finance-balance">{formatNaira(statement.advanceMinor)}</strong></div>
    </div>
    <p className="mt-3 text-xs text-[var(--muted)]">Current balances across all stores as at {new Date(statement.asOf).toLocaleString("en-NG")}. Store selection filters entries only. Debt and advances are separate balances, not netted against each other.</p>
    <p className="mt-2 text-xs text-[var(--muted)]">Each account movement appears once. Cash sales without account movements remain in Activity. This page is not an opening/closing balance reconciliation; old unassigned entries stay in General.</p>
    <div className="responsive-table-wrap mt-4 hidden lg:block"><table className="responsive-table">
      <thead className="bg-slate-50"><tr><th className="p-3">Date / reference</th><th className="p-3">Activity / arrangement</th><th className="p-3">Customer debt</th><th className="p-3">Customer advance</th></tr></thead>
      <tbody>{result.rows.map(row => <tr key={row.id} className="border-t"><td className="p-3 text-sm">{row.at ? new Date(row.at).toLocaleString("en-NG") : "Date pending"}<span className="block font-mono text-xs text-[var(--muted)]">{row.reference}</span></td><td className="p-3 text-sm">{customerHistoryLabel(row.kind, row.detail)}<span className="block text-xs text-[var(--muted)]">{row.accountName}{row.needsReview && " · Classification needs review"}</span></td><td className={`p-3 text-sm font-semibold finance-${(row.debtChangeMinor ?? 0) > 0 ? "attention" : "income"}`}>{change(row.debtChangeMinor, "Added", "Cleared")}</td><td className="p-3 text-sm font-semibold finance-balance">{change(row.advanceChangeMinor, "Received", "Used / refunded")}</td></tr>)}</tbody>
    </table></div>
    <div className="mt-4 space-y-3 lg:hidden">{result.rows.map(row => <article key={row.id} className="rounded-xl border p-3 text-sm"><strong>{customerHistoryLabel(row.kind, row.detail)}</strong><p className="text-xs text-[var(--muted)]">{row.reference} · {row.accountName} · {row.at ? new Date(row.at).toLocaleString("en-NG") : "Date pending"}</p><p className="mt-2">Debt: {change(row.debtChangeMinor, "Added", "Cleared")}</p><p>Advance: {change(row.advanceChangeMinor, "Received", "Used / refunded")}</p>{row.needsReview && <p className="finance-attention">Classification needs review</p>}</article>)}</div>
    {!result.rows.length && <p className="p-6 text-center text-sm text-[var(--muted)]">{result.nextCursor ? "No matching arrangement entries in this page. Choose Next to continue through older entries." : "No matching account entries in this page."}</p>}
    <p className="mt-3 text-xs text-[var(--muted)]">{statement.scannedCount} ledger entries checked on this page. Pagination and export cover this page only.</p>
  </section>;
}
