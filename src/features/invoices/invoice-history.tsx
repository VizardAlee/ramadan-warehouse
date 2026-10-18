"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { PaginatedTableControls, useTablePagination } from "@/components/ui/table-pagination";
import { useAuth } from "@/features/auth/auth-context";
import { callAdministration } from "@/features/administration/api";
import { formatNaira } from "@/features/inventory/format";
import { SaleWaybills } from "@/features/pos/sale-waybills";
import { SaleDocumentDialog } from "@/features/pos/sale-document";
import type { SaleDocument } from "@/features/pos/types";
import { ReportPeriodPicker, reportDateRange, type ReportPeriod } from "@/features/reports/date-range";
import { downloadInvoiceHistory, filterInvoices, invoiceAccess, loadInvoiceRange, type InvoiceRow } from "./invoice-history-data";

const empty: InvoiceRow[] = [];
const readable = (text?: string) => text ? text.replaceAll("_", " ") : "Not recorded";
export function InvoiceHistory() {
  const { profile, operatingContext, setOperatingContext } = useAuth();
  const access = invoiceAccess(profile);
  const [selection, setSelection] = useState<string | null>(null);
  const preferred = selection ?? (operatingContext?.type === "branch" ? operatingContext.id : "");
  const chooseContext = !access.global && !operatingContext && (profile?.branchIds.length ?? 0) > 1 && selection === null;
  const branchId = chooseContext ? "" : preferred && (access.global || profile?.branchIds.includes(preferred)) ? preferred : access.global ? "" : profile?.branchIds[0] ?? "";
  const [period, setPeriod] = useState<ReportPeriod>("monthly");
  const [fromDate, setFrom] = useState(() => reportDateRange("monthly").fromDate);
  const [toDate, setTo] = useState(() => reportDateRange("monthly").toDate);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [refresh, setRefresh] = useState(0);
  const identity = JSON.stringify([profile?.uid, profile?.organizationId, profile?.authorizationVersion, profile?.roleIds, profile?.effectivePermissions, profile?.branchIds]);
  const key = JSON.stringify([identity, branchId, fromDate, toDate, refresh]);
  const validDates = /^\d{4}-\d{2}-\d{2}$/.test(fromDate) && /^\d{4}-\d{2}-\d{2}$/.test(toDate) && fromDate <= toDate;
  const ready = access.allowed && validDates && (access.global || Boolean(branchId));
  const [result, setResult] = useState<{ key: string; rows?: InvoiceRow[]; error?: string }>();
  const [document, setDocument] = useState<{ key: string; value: SaleDocument; waybills?: boolean }>();
  const [opening, setOpening] = useState<{ key: string; id: string }>();
  const [documentError, setDocumentError] = useState<{ key: string; message: string }>();
  const documentVersion = useRef(0);
  const invalidateDocument = useCallback(() => { documentVersion.current++; }, []);
  useEffect(() => {
    invalidateDocument();
    return invalidateDocument;
  }, [key, invalidateDocument]);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void loadInvoiceRange(input => callAdministration("generateSalesReport", input), { branchId: branchId || undefined, fromDate, toDate }, () => !active)
        .then(rows => { if (active && rows) setResult({ key, rows }); })
        .catch(cause => { if (active) setResult({ key, error: cause instanceof Error ? cause.message : "Invoice history could not be loaded. Try again." }); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [key, ready, branchId, fromDate, toDate]);
  const current = result?.key === key ? result : undefined;
  const rows = ready ? current?.rows ?? empty : empty;
  const filtered = useMemo(() => filterInvoices(rows, search, status), [rows, search, status]);
  const pagination = useTablePagination(filtered);
  const branches = new Map<string, string>((profile?.branchIds ?? []).map(id => [id, `Store ${id}`]));
  for (const row of rows) branches.set(row.branchId, row.branchName || `Store ${row.branchId}`);
  if (branchId && !branches.has(branchId)) branches.set(branchId, `Store ${branchId}`);
  const statuses = [...new Set(rows.map(row => row.paymentStatus).filter((value): value is string => typeof value === "string" && value.length > 0))].sort();
  async function openInvoice(row: InvoiceRow, waybills = false) {
    const version = ++documentVersion.current;
    setOpening({ key, id: row.id }); setDocumentError(undefined);
    try {
      const value = await callAdministration<{ saleId: string }, SaleDocument>("getSaleDocument", { saleId: row.id });
      if (!value.official || value.sale.id !== row.id || value.branch.id !== row.branchId)
        throw new Error("The document does not match this invoice. Refresh history before trying again.");
      if (version === documentVersion.current) setDocument({ key, value, waybills });
    } catch (cause) {
      if (version === documentVersion.current) setDocumentError({ key, message: cause instanceof Error ? cause.message : "The invoice could not be opened. Try again." });
    } finally { if (version === documentVersion.current) setOpening(undefined); }
  }
  if (!access.allowed) return <section className="surface space-y-3 p-5"><h1 className="text-2xl font-semibold">Invoice History</h1><p>This history requires your existing sales-report access. No invoice records have been loaded.</p><Link className="underline" href="/dashboard">Return to dashboard</Link></section>;
  return <div className="invoice-history space-y-5">
    <header className="space-y-2"><h1 className="text-3xl font-semibold">Invoice History</h1><p className="text-sm text-[var(--muted)]">Find existing customer invoices by invoice number, receipt or customer. View the original document, then print or save it as PDF.</p></header>
    <section className="surface filter-grid p-4" aria-label="Invoice filters">
      <ReportPeriodPicker value={period} onChange={value => { setPeriod(value); if (value !== "custom") { const range = reportDateRange(value); setFrom(range.fromDate); setTo(range.toDate); } }} />
      <label className="text-sm font-medium">Store<select className="input mt-1 block w-full" value={branchId} onChange={event => { setSelection(event.target.value); if (!access.global && event.target.value) setOperatingContext({ type: "branch", id: event.target.value }); pagination.setPage(1); }}>
        {access.global && <option value="">All permitted stores</option>}
        {!access.global && !branchId && <option value="">{profile?.branchIds.length ? "Choose an assigned store" : "No assigned store"}</option>}
        {[...branches].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select></label>
      <label className="text-sm font-medium">From date<input className="input mt-1 block w-full" type="date" value={fromDate} onChange={event => { setPeriod("custom"); setFrom(event.target.value); pagination.setPage(1); }} /></label>
      <label className="text-sm font-medium">To date<input className="input mt-1 block w-full" type="date" value={toDate} onChange={event => { setPeriod("custom"); setTo(event.target.value); pagination.setPage(1); }} /></label>
      <label className="text-sm font-medium">Search invoices<input className="input mt-1 block w-full" type="search" placeholder="Invoice, receipt or customer" value={search} onChange={event => { setSearch(event.target.value); pagination.setPage(1); }} /></label>
      <label className="text-sm font-medium">Recorded payment status<select className="input mt-1 block w-full" value={status} onChange={event => { setStatus(event.target.value); pagination.setPage(1); }}><option value="">All recorded statuses</option>{status && !statuses.includes(status) && <option value={status}>{readable(status)}</option>}{statuses.map(value => <option key={value} value={value}>{readable(value)}</option>)}</select></label>
    </section>
    <p className="text-sm text-[var(--muted)]">Dates use Africa/Lagos. Search covers every invoice in the selected range, up to 10,000 records. Status and invoice totals use saved sale records; use customer statements for current debt after repayments or credits.</p>
    {!validDates && <p role="alert">Choose a valid start and end date, with the start on or before the end.</p>}
    {!access.global && !branchId && <p role="alert">Choose an assigned store to load invoice history. If none is listed, ask an administrator to review your existing assignment.</p>}
    {ready && !current && <p role="status">Loading invoice history across the selected dates…</p>}
    {current?.error && <p role="alert">{current.error}</p>}
    {documentError?.key === key && <p role="alert">{documentError.message}</p>}
    <div className="action-row"><Button variant="outline" onClick={() => setRefresh(value => value + 1)}>Refresh history</Button><Button variant="secondary" disabled={!current?.rows || !filtered.length} onClick={() => downloadInvoiceHistory(filtered)}>Download history CSV</Button>{current?.rows && <p role="status" className="text-sm">{filtered.length.toLocaleString()} matching invoices · {rows.length.toLocaleString()} in this date range</p>}</div>
    {current?.rows && !filtered.length && <p className="surface p-5">No invoices match these filters. Try another date range, store, invoice number or customer.</p>}
    {filtered.length > 0 && <><div className="responsive-table-wrap"><table className="responsive-table" aria-label="Invoice history"><thead><tr>{["Invoice / receipt", "Issued", "Store", "Customer", "Recorded payment status", "Invoice total", "Actions"].map(text => <th key={text}>{text}</th>)}</tr></thead><tbody>{pagination.rows.map(row => <tr key={row.id}>
      <td data-label="Invoice / receipt" data-primary="true"><strong>{row.saleNumber || `Invoice ${row.id}`}</strong><span className="block text-sm text-[var(--muted)]">{row.receiptNumber}</span></td>
      <td data-label="Issued">{row.recordedAt ? new Date(row.recordedAt).toLocaleString("en-NG", { timeZone: "Africa/Lagos" }) : "Date unavailable"}</td>
      <td data-label="Store">{row.branchName || `Store ${row.branchId}`}</td><td data-label="Customer">{row.customerName}<span className="block text-sm text-[var(--muted)]">{row.customerNumber}</span></td>
      <td data-label="Recorded payment status">{readable(row.paymentStatus)}</td><td data-label="Invoice total" className="tabular-nums">{formatNaira(row.grossAmountMinor)}</td>
      <td data-label="Actions" data-actions="true"><Button variant="outline" aria-busy={opening?.key === key && opening.id === row.id} disabled={opening?.key === key} onClick={() => void openInvoice(row)}>{opening?.key === key && opening.id === row.id ? "Opening…" : "View invoice"}</Button><Button variant="outline" disabled={opening?.key === key} onClick={() => void openInvoice(row, true)}>Print waybill</Button></td>
    </tr>)}</tbody></table></div><PaginatedTableControls pagination={pagination} total={filtered.length} itemLabel="invoices" /></>}
    <p className="text-sm"><Link className="underline" href="/reports?family=sales">Open Sales register</Link> for sales summaries. Supplier invoices remain in Purchasing.</p>
    {ready && document?.key === key && (document.waybills ? <SaleWaybills document={document.value} onClose={() => setDocument(undefined)} /> : <SaleDocumentDialog document={document.value} onClose={() => setDocument(undefined)} />)}
  </div>;
}
