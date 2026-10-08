"use client";

import { useEffect, useState } from "react";
import { callAdministration } from "@/features/administration/api";
import { formatNaira } from "@/features/inventory/format";
import { Button } from "@/components/ui/button";
import { CursorTablePagination } from "@/components/ui/table-pagination";

export interface OpenCustomerInvoice { id: string; reference: string; accountId: string; accountName: string; dueDate: string | null; outstandingMinor: number; paidMinor: number; creditedMinor: number }
interface Receivables { invoices: OpenCustomerInvoice[]; aging: Array<{ name: string; amountMinor: number }>; historicalUnallocatedMinor: number; advanceBalances: Record<string, number>; nextCursor: { sale: string } | null }

export function CustomerReceivablesPanel({ customerId, branchId, onSelect }: { customerId: string; branchId?: string; onSelect?: (invoice: OpenCustomerInvoice) => void }) {
  const [pageSize, setPageSize] = useState(25);
  const [pages, setPages] = useState<Array<{ sale: string } | null>>([null]);
  const [response, setResponse] = useState<{ key: string; result?: Receivables; error?: string }>();
  const cursor = pages.at(-1);
  const key = JSON.stringify([customerId, branchId, pageSize, cursor]);
  const result = response?.key === key ? response.result : undefined;
  const error = response?.key === key ? response.error : undefined;
  useEffect(() => {
    let active = true;
    void callAdministration<object, Receivables>("getCustomerHistory", { customerId, branchId, view: "receivables", limit: pageSize, cursor: cursor ?? undefined })
      .then((value) => { if (active) setResponse({ key, result: value }); })
      .catch((cause) => { if (active) setResponse({ key, error: cause instanceof Error ? cause.message : "Unable to load invoice balances." }); });
    return () => { active = false; };
  }, [customerId, branchId, pageSize, cursor, key]);
  return <section aria-label="Customer invoice balances" className="space-y-3 rounded-xl border bg-white p-4">
    <h2 className="font-semibold">Unpaid invoices &amp; aging</h2>
    <p className="text-xs text-[var(--muted)]">Invoice balances reflect later repayments and account-credit returns. Collection remains separate. Aging uses the Nigerian business date; no due date is invented.</p>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {!result && !error && <p role="status">Loading invoice balances…</p>}
    {result && <>
      {!onSelect && <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{result.aging.map((bucket) => <div key={bucket.name} className="rounded-lg bg-amber-50 p-3 text-sm"><p>{bucket.name}</p><strong className="finance-attention">{formatNaira(bucket.amountMinor)}</strong></div>)}</div>}
      {result.historicalUnallocatedMinor > 0 && <p className="rounded-lg bg-amber-50 p-3 text-sm">Historical debt without verified invoice allocation: {formatNaira(result.historicalUnallocatedMinor)} across all stores. Previous repayments have not been guessed or reassigned.</p>}
      {!onSelect && <p className="rounded-lg bg-blue-50 p-3 text-sm">Unused customer advances (all stores): <strong className="finance-balance">{formatNaira(Object.values(result.advanceBalances).reduce((sum, amount) => sum + amount, 0))}</strong></p>}
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Invoice / arrangement</th><th className="p-2">Due</th><th className="p-2 text-right">Unpaid</th>{onSelect && <th className="p-2">Action</th>}</tr></thead><tbody>{result.invoices.map((invoice) => <tr key={invoice.id} className="border-t"><td className="p-2">{invoice.reference}<span className="block text-xs text-[var(--muted)]">{invoice.accountName}</span></td><td className="p-2">{invoice.dueDate ?? "Not set"}</td><td className="p-2 text-right font-semibold finance-attention">{formatNaira(invoice.outstandingMinor)}</td>{onSelect && <td className="p-2"><Button size="sm" variant="outline" onClick={() => onSelect(invoice)}>Pay invoice</Button></td>}</tr>)}{!result.invoices.length && <tr><td className="p-3" colSpan={onSelect ? 4 : 3}>No tracked unpaid invoices for this store selection.</td></tr>}</tbody></table></div>
      <CursorTablePagination page={pages.length} pageSize={pageSize} rowCount={result.invoices.length} hasNextPage={Boolean(result.nextCursor)} loading={false} onPrevious={() => setPages((value) => value.length > 1 ? value.slice(0, -1) : value)} onNext={() => { if (result.nextCursor) setPages((value) => [...value, result.nextCursor]); }} onPageSizeChange={(size) => { setPageSize(size); setPages([null]); }} itemLabel="unpaid invoices" />
    </>}
  </section>;
}
