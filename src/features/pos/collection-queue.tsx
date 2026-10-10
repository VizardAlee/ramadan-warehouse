"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { SaleDocumentDialog } from "./sale-document";
import type { SaleDocument } from "./types";
import { parseSaleSerials, validSaleSerials } from "./serial-selection";
import { CollectionPhotoUpload, type CollectionPhotoReference } from "./collection-photos";

interface PendingCollection {
  id: string; saleNumber: string; customerName: string; collectionStatus: string;
  totalQuantity: number; collectedQuantity: number; cancelledQuantity?: number; reservedAt: string | null;
}

export function CollectionQueue({ branchId, canRelease, online }: { branchId: string; canRelease: boolean; online: boolean }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<PendingCollection[]>([]);
  const [size, setSize] = useState(25);
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [next, setNext] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [document, setDocument] = useState<SaleDocument | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [serialText, setSerialText] = useState<Record<string, string>>({});
  const [collector, setCollector] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [print, setPrint] = useState(false);
  const [photos, setPhotos] = useState<CollectionPhotoReference[]>([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const retry = useRef<Record<string, unknown> | null>(null);
  const cursor = cursors.at(-1);
  useEffect(() => {
    if (!open || !branchId || !online) return;
    let active = true;
    void callAdministration<object, { rows: PendingCollection[]; nextCursor: string | null }>("getSaleDocument", { action: "list_collections", branchId, limit: size, cursor })
      .then((result) => { if (active) { setRows(result.rows); setNext(result.nextCursor); setError(null); } })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Collections could not be loaded."); });
    return () => { active = false; };
  }, [open, branchId, online, size, cursor, revision]);

  async function select(saleId: string) {
    setBusy(true); setError(null); setMessage(null);
    try {
      const result = await callAdministration<{ saleId: string }, SaleDocument>("getSaleDocument", { saleId });
      setDocument(result); setQuantities({}); setSerialText({}); setCollector(""); setNotes(""); setPhotos([]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Invoice could not be loaded."); }
    finally { setBusy(false); }
  }
  const selectedLines = document?.items.flatMap((item) => {
    const quantity = Number(quantities[item.id] || 0);
    return quantity > 0 ? [{ saleItemId: item.id, quantity, ...(item.trackingType === "serial" ? { serialNumbers: parseSaleSerials(serialText[item.id] ?? "") } : {}) }] : [];
  }) ?? [];
  const invalid = document?.items.some((item) => {
    const quantity = Number(quantities[item.id] || 0);
    const eligible = (item.serialNumbers ?? []).filter(serial => !item.collectedSerialNumbers?.includes(serial) && !item.cancelledSerialNumbers?.includes(serial));
    return !Number.isInteger(quantity) || quantity < 0 || quantity > item.quantity - (item.collectedQuantity ?? item.quantity) - (item.cancelledQuantity ?? 0) || (item.trackingType === "serial" && quantity > 0 && !validSaleSerials(parseSaleSerials(serialText[item.id] ?? ""), quantity, eligible));
  });
  async function collect() {
    if (!document || uploadBusy || (!retry.current && (!selectedLines.length || invalid || collector.trim().length < 2 || photos.some(photo => !selectedLines.some(line => line.saleItemId === photo.saleItemId))))) return;
    setBusy(true); setError(null);
    const payload = { action: "collect", saleId: document.sale.id, lines: selectedLines, collector, notes: notes || undefined, ...(photos.length ? { evidenceIds: photos.map(photo => photo.evidenceId) } : {}) };
    retry.current ??= { ...payload, idempotencyKey: crypto.randomUUID() };
    try {
      await callAdministration("confirmPosSaleOrder", retry.current);
      retry.current = null;
      setUncertain(false);
      setQuantities({}); setSerialText({}); setPhotos([]); setRevision((value) => value + 1);
      setMessage("Collection recorded. Physical stock, reservation, journal and audit were updated together.");
      const result = await callAdministration<{ saleId: string }, SaleDocument>("getSaleDocument", { saleId: document.sale.id });
      setDocument(result);
    } catch (cause) {
      const code = (cause as { diagnosticCode?: string; code?: string })?.diagnosticCode ?? (cause as { code?: string })?.code;
      const definitive = ["functions/invalid-argument", "functions/permission-denied", "functions/failed-precondition", "functions/not-found"].includes(code ?? "");
      if (definitive) retry.current = null;
      setUncertain(!definitive && Boolean(retry.current));
      setError(cause instanceof Error ? cause.message : "Collection could not be recorded.");
    }
    finally { setBusy(false); }
  }
  return <section className="surface p-4 sm:p-5">
    <Button variant="outline" disabled={busy || uncertain || uploadBusy} aria-expanded={open} onClick={() => { setOpen(!open); setDocument(null); setCursors([undefined]); }}>Goods awaiting collection</Button>
    {open && <div className="mt-4 space-y-4">
      <p className="text-sm text-[var(--muted)]">Payment and physical collection are separate. Reserved goods remain in the store until a release is recorded. This list shows the selected store only.</p>
      {!online && <p>Connect to the internet to review and record collections.</p>}
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {message && <p role="status" className="text-emerald-700">{message}</p>}
      <p className="text-sm text-[var(--muted)]">After seven days, responsible stock-release staff receive a weekly reminder. Goods remain reserved until an authorized collection or cancellation.</p>
      {uncertain && <p role="status" className="text-amber-900">Confirmation was not received. Retry the same collection before changing details or starting another release.</p>}
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Invoice / customer</th><th>Sold</th><th>Collected</th><th>Still reserved</th><th>Reserved on</th><th /></tr></thead>
        <tbody>{rows.map((sale) => <tr key={sale.id} className="border-t"><td className="p-2"><strong>{sale.saleNumber}</strong><p>{sale.customerName}</p>{Boolean(sale.cancelledQuantity) && <p>{sale.cancelledQuantity} cancelled</p>}</td><td>{sale.totalQuantity}</td><td>{sale.collectedQuantity}</td><td>{sale.totalQuantity - sale.collectedQuantity - (sale.cancelledQuantity ?? 0)}</td><td>{sale.reservedAt ? <>{new Date(sale.reservedAt).toLocaleDateString("en-NG")}<p className="text-xs text-[var(--muted)]">{Math.max(0, Math.floor((new Date().getTime() - new Date(sale.reservedAt).getTime()) / 86400000))} days waiting</p></> : "Date not recorded"}</td><td><Button variant="outline" disabled={busy || uncertain || uploadBusy || !online} onClick={() => void select(sale.id)}>Review collection</Button></td></tr>)}</tbody></table></div>
      {!rows.length && online && <p>No goods awaiting collection on this page.</p>}
      <div className="flex flex-wrap items-center gap-3"><label>Rows per page <select value={size} onChange={(event) => { setSize(Number(event.target.value)); setCursors([undefined]); }} className="rounded border p-2">{[25, 50, 100].map((value) => <option key={value}>{value}</option>)}</select></label><Button variant="outline" disabled={cursors.length === 1 || busy} onClick={() => setCursors((values) => values.slice(0, -1))}>Previous</Button><span>Page {cursors.length}</span><Button variant="outline" disabled={!next || busy} onClick={() => setCursors((values) => [...values, next!])}>Next</Button></div>
      {document && <div className="space-y-3 rounded-xl border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{document.sale.saleNumber} · {(document.sale.collectionStatus ?? "collected").replaceAll("_", " ")}</h3><Button variant="outline" onClick={() => setPrint(true)}>View invoice and collection record</Button></div>
        {document.items.filter(item => item.itemKind !== "service").map((item) => {
          const remaining = item.quantity - (item.collectedQuantity ?? item.quantity) - (item.cancelledQuantity ?? 0);
          const eligible = (item.serialNumbers ?? []).filter(serial => !item.collectedSerialNumbers?.includes(serial) && !item.cancelledSerialNumbers?.includes(serial));
          return <div key={item.id} className="space-y-2 rounded-lg border p-3">
            <label className="grid items-center gap-2 sm:grid-cols-[1fr_8rem]"><span>{item.productName} · sold {item.quantity}, collected {item.collectedQuantity ?? item.quantity}, cancelled {item.cancelledQuantity ?? 0}, remaining {remaining}</span><input aria-label={`Collect quantity for ${item.productName}`} type="number" min="0" max={remaining} step="1" value={quantities[item.id] ?? "0"} disabled={!canRelease || busy || uncertain || !remaining} onChange={(event) => setQuantities((values) => ({ ...values, [item.id]: event.target.value }))} className="rounded-lg border p-3" /></label>
            {item.trackingType === "serial" && remaining > 0 && <label className="block text-sm">Serials handed over for {item.productName}<textarea rows={3} disabled={!canRelease || busy || uncertain || !online} value={serialText[item.id] ?? ""} onChange={event => setSerialText(values => ({ ...values, [item.id]: event.target.value }))} className="mt-1 w-full rounded-lg border p-3" /><span className="block break-all text-xs text-[var(--muted)]">One per collected unit, one per line. Still reserved: {eligible.join(", ") || "None"}</span></label>}
          </div>;
        })}
        {canRelease ? <><CollectionPhotoUpload key={document.sale.id + ':' + revision} saleId={document.sale.id} items={document.items.filter(item => item.itemKind !== "service" && item.quantity > (item.collectedQuantity ?? item.quantity) + (item.cancelledQuantity ?? 0))} photos={photos} onChange={setPhotos} locked={busy || uncertain || !online} onBusy={setUploadBusy} />{photos.some(photo => !selectedLines.some(line => line.saleItemId === photo.saleItemId)) && <p className="text-sm text-amber-900">Enter a collection quantity for every photographed product, or remove its photo.</p>}<label className="block text-sm">Collector name<input disabled={busy || uncertain || uploadBusy} maxLength={120} value={collector} onChange={(event) => setCollector(event.target.value)} className="mt-1 w-full rounded-lg border p-3" /></label><label className="block text-sm">Collection notes<textarea disabled={busy || uncertain || uploadBusy} maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1 w-full rounded-lg border p-3" /></label><Button disabled={busy || uploadBusy || !online || photos.some(photo => !selectedLines.some(line => line.saleItemId === photo.saleItemId)) || (!uncertain && (!selectedLines.length || invalid || collector.trim().length < 2))} onClick={() => void collect()}>{uncertain ? "Retry same collection" : "Record physical collection"}</Button></> : <p>A user with stock-release permission must record the physical collection.</p>}
      </div>}
    </div>}
    {print && document && <SaleDocumentDialog document={document} onClose={() => setPrint(false)} />}
  </section>;
}
