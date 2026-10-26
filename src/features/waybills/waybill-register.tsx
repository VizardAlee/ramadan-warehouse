"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { useAuth } from "@/features/auth/auth-context";
import { useOperatingContextOptions } from "@/features/auth/use-operating-context-options";
import { hasAnyPermission } from "@/lib/permissions/roles";
import { CollectionWaybill } from "@/features/pos/collection-waybill";
import type { DispatchDetails } from "@/features/pos/dispatch-details-form";
import type { SaleDocument } from "@/features/pos/types";

export interface WaybillRow {
  id: string; saleId: string; branchId: string; invoiceNumber: string; waybillNumber: string; collectedAt: string | null; totalQuantity: number;
  dispatcherPhone: string | null; vehiclePlate: string | null; deliveryRecipientName: string | null;
}
interface WaybillPage { rows: WaybillRow[]; nextCursor: string | null }

export function WaybillRegister() {
  const { profile, operatingContext, setOperatingContext } = useAuth();
  const { options, canSelectAll } = useOperatingContextOptions();
  const [selectedBranch, setSelectedBranch] = useState<string>();
  const [invoice, setInvoice] = useState("");
  const [lookup, setLookup] = useState("");
  const branches = options.filter(option => option.type === "branch");
  const preferred = selectedBranch ?? (operatingContext?.type === "branch" ? operatingContext.id : branches.length === 1 ? branches[0]!.id : "");
  const branchId = branches.some(option => option.id === preferred) ? preferred : "";
  const identity = JSON.stringify([profile?.uid, profile?.organizationId, profile?.authorizationVersion, profile?.roleId, profile?.effectivePermissions, profile?.roleIds, profile?.branchIds, branchId, lookup]);
  const allowed = Boolean(profile && hasAnyPermission(profile, ["reports.sales.read", "sales.read.own_branch", "sales.read.all"]));
  function search(event: FormEvent) { event.preventDefault(); setLookup(invoice.trim()); }
  if (!allowed) return <section className="surface space-y-3 p-5"><h1 className="text-3xl font-semibold">Waybills</h1><p>Your existing sales-document access is required. No handovers have been loaded.</p><Link className="underline" href="/dashboard">Return to dashboard</Link></section>;
  return <div className="space-y-5">
    <header className="space-y-2"><h1 className="text-3xl font-semibold">Waybills</h1><p className="text-sm text-[var(--muted)]">View recorded physical handovers, add dispatch details and print the goods released in each handover.</p><p className="text-sm">Goods awaiting collection have no waybill until an authorized physical release is recorded. Service-only sales have no collection waybill.</p></header>
    <form className="surface flex flex-wrap items-end gap-3 p-4" onSubmit={search} aria-label="Waybill filters">
      <label className="min-w-0 flex-1 text-sm font-medium">Store<select className="input mt-1 block w-full" value={branchId} onChange={event => { setSelectedBranch(event.target.value); if (!canSelectAll && event.target.value) setOperatingContext({ type: "branch", id: event.target.value }); }}><option value="">Choose a permitted store</option>{branches.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
      <label className="min-w-0 flex-1 text-sm font-medium">Invoice number<input type="search" className="input mt-1 block w-full" maxLength={100} placeholder="Exact invoice number (optional)" value={invoice} onChange={event => setInvoice(event.target.value)} /></label>
      <Button type="submit">Find waybills</Button><Button type="button" variant="outline" onClick={() => { setInvoice(""); setLookup(""); }}>Clear lookup</Button>
    </form>
    {!branchId ? <p role="status">Choose a permitted store to view its recorded handovers.</p> : <RegisterPage key={identity} branchId={branchId} invoiceNumber={lookup} />}
  </div>;
}

function RegisterPage({ branchId, invoiceNumber }: { branchId: string; invoiceNumber: string }) {
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<{ key: string; value?: WaybillPage; error?: string }>();
  const [document, setDocument] = useState<SaleDocument>();
  const [opening, setOpening] = useState<string>();
  const [openError, setOpenError] = useState<string>();
  const active = useRef(true), flight = useRef(false);
  const cursor = cursors.at(-1);
  const key = JSON.stringify([cursor, revision]);
  const current = page?.key === key ? page : undefined;
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    let currentRequest = true;
    void callAdministration<object, WaybillPage>("getSaleDocument", { action: "list_waybills", branchId, invoiceNumber, limit: 25, ...(cursor ? { cursor } : {}) })
      .then(value => {
        if (value.rows.some(row => row.branchId !== branchId || !row.id || !row.saleId)) throw new Error("Waybill store verification failed. Refresh your access and try again.");
        if (currentRequest) setPage({ key, value });
      }).catch(cause => { if (currentRequest) setPage({ key, error: cause instanceof Error ? cause.message : "Waybills could not be loaded. Try again." }); });
    return () => { currentRequest = false; };
  }, [branchId, invoiceNumber, cursor, key]);
  async function open(row: WaybillRow) {
    if (flight.current) return;
    flight.current = true; setOpening(row.id); setOpenError(undefined);
    try {
      const result = await callAdministration<object, SaleDocument>("getSaleDocument", { saleId: row.saleId, collectionId: row.id });
      if (!result.official || result.sale.id !== row.saleId || result.branch.id !== branchId || result.collections?.length !== 1 || result.collections[0]?.id !== row.id)
        throw new Error("The handover does not match this waybill. Refresh before trying again.");
      if (active.current) setDocument(result);
    } catch (cause) { if (active.current) setOpenError(cause instanceof Error ? cause.message : "Waybill could not be opened."); }
    finally { flight.current = false; if (active.current) setOpening(undefined); }
  }
  function updated(details: DispatchDetails) {
    if (!document) return;
    setPage(previous => previous?.value ? { ...previous, value: { ...previous.value, rows: previous.value.rows.map(row => row.id === document.collections![0]!.id ? { ...row, dispatcherPhone: details.dispatcherPhone ?? null, vehiclePlate: details.vehiclePlate ?? null, deliveryRecipientName: details.deliveryRecipientName ?? null } : row) } } : previous);
  }
  return <section className="space-y-4" aria-label="Recorded waybills">
    <div className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={Boolean(opening)} onClick={() => setRevision(value => value + 1)}>Refresh waybills</Button><p className="text-sm">Recorded handovers · dates use Africa/Lagos{invoiceNumber ? ` · Invoice ${invoiceNumber}` : ""}</p></div>
    {!current && <p role="status">Loading recorded handovers…</p>}
    {current?.error && <p role="alert">{current.error}</p>}{openError && <p role="alert">{openError}</p>}
    {current?.value && !current.value.rows.length && <p role="status" className="surface p-5">No recorded handovers match this store and invoice lookup. Try another invoice or store. No waybill has been created.</p>}
    {Boolean(current?.value?.rows.length) && <div className="responsive-table-wrap"><table className="responsive-table" aria-label="Waybill register"><thead><tr>{["Waybill number", "Invoice", "Handed over", "Quantity", "Dispatcher phone", "Vehicle plate", "Delivery recipient", "Waybill"].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{current!.value!.rows.map(row => <tr key={row.id}>
      <td data-label="Waybill number" data-primary="true"><strong>{row.waybillNumber}</strong></td><td data-label="Invoice">{row.invoiceNumber}</td><td data-label="Handed over">{row.collectedAt ? new Date(row.collectedAt).toLocaleString("en-NG", { timeZone: "Africa/Lagos" }) : "Date not recorded"}</td><td data-label="Quantity">{row.totalQuantity} units</td><td data-label="Dispatcher phone">{row.dispatcherPhone || "Not recorded"}</td><td data-label="Vehicle plate">{row.vehiclePlate || "Not recorded"}</td><td data-label="Delivery recipient">{row.deliveryRecipientName || "Not recorded"}</td><td data-label="Waybill" data-actions="true"><Button variant="outline" disabled={Boolean(opening)} aria-busy={opening === row.id} onClick={() => void open(row)}>{opening === row.id ? "Opening…" : "View waybill"}</Button></td>
    </tr>)}</tbody></table></div>}
    <div className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={!current || Boolean(opening) || cursors.length === 1} onClick={() => setCursors(values => values.slice(0, -1))}>Previous page</Button><span>Page {cursors.length}</span><Button variant="outline" disabled={!current?.value?.nextCursor || Boolean(opening)} onClick={() => setCursors(values => [...values, current!.value!.nextCursor!])}>Next page</Button></div>
    {document && <CollectionWaybill key={document.collections![0]!.id} document={document} collection={document.collections![0]!} backLabel="Back to waybills" onBack={() => setDocument(undefined)} onClose={() => setDocument(undefined)} onUpdated={updated} />}
  </section>;
}
