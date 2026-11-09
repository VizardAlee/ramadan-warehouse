"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CursorTablePagination } from "@/components/ui/table-pagination";
import { callAdministration } from "@/features/administration/api";
import { useAuth } from "@/features/auth/auth-context";
import { hasPermission } from "@/lib/permissions/roles";
import { FinancialMessage, FinancialText, FinancialValue } from "@/features/finance/financial-privacy";
import { formatNaira } from "@/features/inventory/format";
import { UserFacingError } from "@/lib/firebase/user-facing-error";
import type { PurchaseOrder, SupplierInvoice } from "@/types/domain";

type Scope = { branchId?: string; warehouseId?: string };
type OrderRow = PurchaseOrder & { createdAt?: { seconds?: number; _seconds?: number } | string; nextAction?: string };
type Page = { orders?: OrderRow[]; invoices?: Array<SupplierInvoice & { createdAt?: OrderRow["createdAt"] }>; nextCursor: string | null; hasMore: boolean; note?: string };
export function PurchasingList({ kind, scope, suppliers, branches, warehouses, revision, initialSearch = "", onOrder, onInvoice, onDismiss }: {
  kind: "orders" | "invoices"; scope: Scope;
  suppliers: Array<{ id: string; name: string }>;
  branches: Array<{ id: string; name: string }>;
  warehouses: Array<{ id: string; name: string }>;
  revision: number; initialSearch?: string;
  onOrder: (id: string) => void; onInvoice: (invoice: SupplierInvoice) => void; onDismiss: () => void;
}) {
  const { profile } = useAuth();
  const canApproveInvoice = Boolean(profile && hasPermission(profile, "payables.approve"));
  const canPayInvoice = Boolean(profile && hasPermission(profile, "payables.pay"));
  const [filters, setFilters] = useState({ search: initialSearch, supplierId: "", location: "", status: "", startDate: "", endDate: "", view: initialSearch ? "all" : "needs_action" });
  const [pageSize, setPageSize] = useState(25);
  const [pages, setPages] = useState<Array<string | null>>([null]);
  const [response, setResponse] = useState<{ key: string; data?: Page; error?: string; restartRequired?: boolean }>();
  const [retry, setRetry] = useState(0);
  const [type, id] = filters.location.split(":");
  const effectiveScope = scope.branchId || scope.warehouseId ? scope : type === "branch" ? { branchId: id } : type === "warehouse" ? { warehouseId: id } : {};
  const key = JSON.stringify([kind, effectiveScope, filters, pageSize, pages.at(-1), revision, retry]);
  const data = response?.key === key ? response.data : undefined;
  const error = response?.key === key ? response.error : undefined;
  const invalidDates = Boolean(filters.startDate && filters.endDate && filters.startDate > filters.endDate);
  useEffect(() => {
    if (invalidDates) return;
    let active = true;
    // A small delay coalesces typing; cleanup also rejects late replies after any scope/filter change.
    const timer = window.setTimeout(() => {
      void (async () => {
        let cursor = pages.at(-1) || undefined;
        // Bounded continuation avoids making the user walk through sparse legacy pages.
        // Keep the original page anchor so Previous and Retry reproduce the same search.
        for (let attempt = 0; attempt < 5 && active; attempt++) {
          const value = await callAdministration<object, Page>("getProcurementWorkspace", {
            view: kind === "orders" ? "orders_page" : "invoices_page",
            ...effectiveScope, workflow: filters.view, search: filters.search.trim() || undefined,
            supplierId: filters.supplierId || undefined, status: filters.status || undefined,
            startDate: filters.startDate || undefined, endDate: filters.endDate || undefined,
            pageSize, cursor,
          });
          if (!active) return;
          const rows = kind === "orders" ? value.orders : value.invoices;
          if (rows?.length || !value.nextCursor || value.nextCursor === cursor || attempt === 4) {
            setResponse({ key, data: value });
            return;
          }
          cursor = value.nextCursor;
        }
      })().catch(cause => {
        if (active) setResponse({
          key, error: cause instanceof Error ? cause.message : "Records could not be loaded.",
          restartRequired: cause instanceof UserFacingError && ["functions/invalid-argument", "functions/permission-denied", "functions/failed-precondition", "OPERATING_CONTEXT_MISMATCH"].includes(cause.diagnosticCode ?? ""),
        });
      });
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
    // The serialized key contains every request field, including scope and cursor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, invalidDates]);
  function change(name: keyof typeof filters, value: string) {
    onDismiss(); setFilters(current => ({ ...current, [name]: value })); setPages([null]);
  }
  function restart() {
    onDismiss(); setPages([null]); setRetry(value => value + 1);
  }
  const records = kind === "orders" ? data?.orders ?? [] : data?.invoices ?? [];
  const statuses = kind === "orders" ? ["draft", "submitted", "approved", "partially_received", "received"] : ["submitted", "approved", "partially_paid", "paid"];
  return <section id={kind === "orders" ? "purchase-orders" : "supplier-invoices"} aria-label={kind === "orders" ? "Order list" : "Invoice list"} className="space-y-3 rounded-xl border bg-white p-4">
    <div className="flex flex-wrap gap-2" aria-label="Record view">{([["needs_action", "Needs action"], ["history", "History"], ["all", "All records"]] as const).map(([value, label]) => <Button key={value} variant={filters.view === value ? "primary" : "outline"} aria-pressed={filters.view === value} onClick={() => change("view", value)}>{label}</Button>)}</div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <label className="text-sm">Search reference or supplier<input className="mt-1 w-full rounded-lg border p-2" value={filters.search} onChange={event => change("search", event.target.value)} /></label>
      <label className="text-sm">Filter supplier<select className="mt-1 w-full rounded-lg border p-2" value={filters.supplierId} onChange={event => change("supplierId", event.target.value)}><option value="">All suppliers</option>{suppliers.map(supplier => <option key={supplier.id} value={supplier.id}><FinancialText>{supplier.name}</FinancialText></option>)}</select></label>
      <label className="text-sm">Filter status<select className="mt-1 w-full rounded-lg border p-2" value={filters.status} onChange={event => change("status", event.target.value)}><option value="">All statuses in this view</option>{statuses.map(status => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></label>
      <label className="text-sm">Created from<input type="date" className="mt-1 w-full rounded-lg border p-2" value={filters.startDate} onChange={event => change("startDate", event.target.value)} /></label>
      <label className="text-sm">Created through<input type="date" className="mt-1 w-full rounded-lg border p-2" value={filters.endDate} min={filters.startDate} onChange={event => change("endDate", event.target.value)} /></label>
      <label className="text-sm">Filter location<select className="mt-1 w-full rounded-lg border p-2" disabled={Boolean(scope.branchId || scope.warehouseId)} value={scope.branchId ? `branch:${scope.branchId}` : scope.warehouseId ? `warehouse:${scope.warehouseId}` : filters.location} onChange={event => change("location", event.target.value)}><option value="">All permitted locations</option>{branches.map(branch => <option key={branch.id} value={`branch:${branch.id}`}>{branch.name}</option>)}{warehouses.map(warehouse => <option key={warehouse.id} value={`warehouse:${warehouse.id}`}>{warehouse.name}</option>)}</select></label>
    </div>
    {(scope.branchId || scope.warehouseId) && <p className="text-xs text-[var(--muted)]">Location follows your working location. Change it in the main location selector.</p>}
    <p className="text-xs text-[var(--muted)]">Completed orders and paid invoices remain searchable in History or All records. Date filters use the record creation date in Lagos.</p>
    {invalidDates ? <p role="alert">The end date must be on or after the start date.</p> : error ? <div role="alert"><FinancialMessage>{error}</FinancialMessage> {!response?.restartRequired && <Button variant="outline" onClick={() => setRetry(value => value + 1)}>Retry list</Button>} <Button variant="outline" onClick={restart}>Restart list</Button></div> : !data ? <p role="status">Loading {kind}…</p> : <>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{["Reference / date", "Supplier", "Location", kind === "orders" ? "Total" : "Still owed", "Status", "Next action"].map(label => <th className="p-2" key={label}>{label}</th>)}</tr></thead><tbody>
        {records.map(record => {
          const order = "purchaseOrderNumber" in record && !("supplierInvoiceNumber" in record) ? record as OrderRow : null;
          const invoice = order ? null : record as SupplierInvoice;
          const timestamp = (record as OrderRow).createdAt;
          const seconds = typeof timestamp === "object" ? timestamp.seconds ?? timestamp._seconds : undefined;
          const date = (typeof timestamp === "string" ? timestamp.slice(0, 10) : seconds ? new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos" }).format(new Date(seconds * 1000)) : "Not recorded");
          const action = order ? order.nextAction ?? ({ draft: "Review & submit", submitted: "Review approval", approved: "Receive goods", partially_received: "Receive / match", received: "Review matching" }[order.status]) : invoice?.status === "submitted" ? canApproveInvoice ? "Review approval" : "View invoice" : invoice?.status === "paid" ? "View settlement" : canPayInvoice && ["approved", "partially_paid"].includes(invoice?.status ?? "") ? "Review payment" : "View invoice";
          const location = order?.operationalLocationName ?? order?.branchName ?? order?.warehouseName ?? branches.find(value => value.id === record.branchId)?.name ?? warehouses.find(value => value.id === record.warehouseId)?.name ?? "Not recorded";
          return <tr className="border-t" key={record.id}><td className="p-2 font-medium"><FinancialText>{order?.purchaseOrderNumber ?? invoice?.supplierInvoiceNumber}</FinancialText><p className="text-xs font-normal text-[var(--muted)]"><FinancialText>{date}</FinancialText></p></td><td className="p-2"><FinancialText>{record.supplierName}</FinancialText></td><td className="p-2"><FinancialText>{location}</FinancialText></td><td className="whitespace-nowrap p-2"><FinancialValue>{formatNaira(order?.grossAmountMinor ?? invoice?.outstandingAmountMinor ?? 0)}</FinancialValue></td><td className="p-2 capitalize"><FinancialText>{record.status.replaceAll("_", " ")}</FinancialText></td><td className="p-2"><Button size="sm" variant="outline" onClick={() => order ? onOrder(order.id) : invoice && onInvoice(invoice)}>{action}</Button></td></tr>;
        })}
        {!records.length && <tr><td colSpan={6} className="p-5 text-center">{data.nextCursor ? "No matches in the records searched so far. Continue search with Next." : "No records match these filters."}</td></tr>}
      </tbody></table></div>
      {data.note && <p className="text-xs text-[var(--muted)]"><FinancialText>{data.note}</FinancialText></p>}
    </>}
    <CursorTablePagination page={pages.length} pageSize={pageSize} rowCount={records.length} hasNextPage={Boolean(data?.nextCursor)} loading={(!data && !error) || invalidDates} onPrevious={() => { onDismiss(); setPages(value => value.slice(0, -1)); }} onNext={() => { if (data?.nextCursor) { onDismiss(); setPages(value => [...value, data.nextCursor]); } }} onPageSizeChange={size => { onDismiss(); setPageSize(size); setPages([null]); }} itemLabel={kind} />
  </section>;
}
