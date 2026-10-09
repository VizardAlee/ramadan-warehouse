"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { SupplierReturns } from "@/features/procurement/supplier-returns";

interface Workspace {
  handover: { quantity: number; settledQuantity: number; status: string };
  invoices: Array<{ id: string; invoiceNumber: string }>;
  nextCursor: string | null;
}
export function HeldSupplierCredit({ handoverId, productId, serialNumber, canPost }: { handoverId: string; productId: string; serialNumber?: string; canPost: boolean }) {
  const [page, setPage] = useState<Workspace>(), [pages, setPages] = useState<Array<string | null>>([null]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [invoiceId, setInvoiceId] = useState("");
  const [dialogInvoice, setDialogInvoice] = useState("");
  async function load(cursor: string | null = null) {
    setBusy(true); setError("");
    try { setPage(await callAdministration<object, Workspace>("getProcurementWorkspace", { view: "held_supplier_handover", heldHandoverId: handoverId, limit: 25, cursor: cursor ?? undefined })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load supplier settlement."); }
    finally { setBusy(false); }
  }
  const remaining = page ? page.handover.quantity - page.handover.settledQuantity : 0;
  return <details className="mt-2 rounded-lg border p-3" onToggle={event => { if (event.currentTarget.open && !page && !busy) void load(); }}>
    <summary className="cursor-pointer text-sm font-medium">Supplier credit settlement</summary>
    {busy && <p role="status" className="mt-2 text-sm">Loading settlement…</p>}
    {error && <p role="alert" className="mt-2 text-sm text-red-800">{error} <button className="underline" onClick={() => void load(pages.at(-1))}>Retry</button></p>}
    {page && <>
      <p className="mt-2 text-sm">{page.handover.settledQuantity} credited · {remaining} awaiting settlement. Credits reduce the original invoice’s debt first; excess stays on the supplier account. No cash refund is assumed.</p>
      {canPost && remaining > 0 && <>
        <label className="mt-3 block text-sm">Original supplier invoice<select disabled={busy} className="mt-1 w-full rounded-lg border p-3" value={invoiceId} onChange={event => setInvoiceId(event.target.value)}><option value="">Choose original invoice</option>{page.invoices.map(invoice => <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber}</option>)}</select></label>
        <p className="mt-1 text-xs text-[var(--muted)]">Only approved invoices from this supplier and store are listed. Cross-store purchases or unverified historical receipts need accounting reconciliation.</p>
        {!page.invoices.length && <p className="mt-2 text-sm">No matching invoices on this page.</p>}
        <div className="mt-2 flex flex-wrap gap-2"><Button variant="outline" disabled={busy || pages.length === 1} onClick={() => { const previous = pages.slice(0, -1); setPages(previous); setInvoiceId(""); void load(previous.at(-1)); }}>Previous invoices</Button><Button variant="outline" disabled={busy || !page.nextCursor} onClick={() => { setPages(value => [...value, page.nextCursor]); setInvoiceId(""); void load(page.nextCursor); }}>Next invoices</Button><Button disabled={busy || !invoiceId} onClick={() => setDialogInvoice(invoiceId)}>Record accepted credit note</Button></div>
      </>}
    </>}
    {dialogInvoice && page && <SupplierReturns invoiceId={dialogInvoice} canPost={canPost} heldHandover={{ id: handoverId, remaining, productId, serialNumber }} onClose={() => setDialogInvoice("")} onComplete={() => { setDialogInvoice(""); setInvoiceId(""); setPages([null]); void load(); }} />}
  </details>;
}
