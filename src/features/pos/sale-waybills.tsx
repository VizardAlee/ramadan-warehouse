"use client";

import { useRef, useState } from "react";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";
import { AppDialog } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import type { DispatchDetails } from "./dispatch-details-form";
import { CollectionWaybill } from "./collection-waybill";
import type { SaleDocument } from "./types";

type WaybillProps = { document: SaleDocument; onClose: () => void; onUpdated?: (collectionId: string, details: DispatchDetails) => void };
export function SaleWaybills(props: WaybillProps) {
  return <SaleWaybillsContent key={`${props.document.sale.id}:${props.document.branch.id}:${props.document.official}`} {...props} />;
}
function SaleWaybillsContent({ document, onClose, onUpdated }: { document: SaleDocument; onClose: () => void; onUpdated?: (collectionId: string, details: DispatchDetails) => void }) {
  const [page, setPage] = useState(document), [selected, setSelected] = useState<string>();
  const dialogRef = useDialogFocus<HTMLElement>(!selected, onClose);
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  const flight = useRef(false);
  async function load(cursor: string | undefined, target: number) {
    if (flight.current || !document.official) return;
    flight.current = true; setBusy(true); setError(undefined);
    try {
      const result = await callAdministration<object, SaleDocument>("getSaleDocument", { saleId: document.sale.id, collectionLimit: 25, ...(cursor ? { collectionCursorId: cursor } : {}) });
      if (!result.official || result.sale.id !== document.sale.id || result.branch.id !== document.branch.id) throw new Error("This handover page does not belong to this invoice.");
      setPage(result); setCursors(previous => [...previous.slice(0, target), cursor]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Handovers could not be loaded."); }
    finally { flight.current = false; setBusy(false); }
  }
  const collection = document.official ? page.collections?.find(row => row.id === selected) : undefined;
  if (collection) return <CollectionWaybill key={collection.id} document={document} collection={collection} backLabel="Back to handovers" onBack={() => setSelected(undefined)} onClose={onClose} onUpdated={details => { setPage(previous => ({ ...previous, collections: previous.collections?.map(row => row.id === collection.id ? { ...row, ...details } : row) })); onUpdated?.(collection.id, details); }} />;
  return <AppDialog role="dialog" aria-modal="true" aria-label="Choose waybill handover"><section ref={dialogRef} className="app-dialog-panel max-w-2xl space-y-4 rounded-2xl bg-white p-5">
    <h2 className="text-xl font-semibold">Print waybill · {document.sale.invoiceNumber}</h2>
    <p className="text-sm text-[var(--muted)]">Choose the actual recorded handover. Each waybill includes only goods released in that handover. Reprinting does not release stock or post payments.</p>
    {!document.official ? <p role="status">Synchronize this provisional sale before opening official handovers.</p> : <>
      {!page.collections?.length && <p role="status">No recorded handover is available on this page. Goods still awaiting collection need an authorized physical release in Goods awaiting collection. Service-only and historical sales without collection evidence have no collection waybill.</p>}
      {page.collections?.map(row => <article key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"><div className="min-w-0 break-words"><strong>{row.waybillNumber || `WB-${row.id}`}</strong><p className="text-sm">{row.collectedAt ? new Date(row.collectedAt).toLocaleString("en-NG", { timeZone: "Africa/Lagos" }) : "Date not recorded"} · {row.totalQuantity} units · {row.collector}</p></div><Button variant="outline" onClick={() => setSelected(row.id)}>View waybill</Button></article>)}
      {error && <p role="alert">{error}</p>}
      <div className="flex flex-wrap items-center gap-2"><Button variant="outline" disabled={busy || cursors.length === 1} onClick={() => void load(cursors[cursors.length - 2], cursors.length - 2)}>Newer handovers</Button><span>Page {cursors.length}</span><Button variant="outline" disabled={busy || !page.collectionsNextCursorId} onClick={() => void load(page.collectionsNextCursorId!, cursors.length)}>Older handovers</Button></div>
    </>}
    <Button variant="secondary" onClick={onClose}>Close</Button>
  </section></AppDialog>;
}
