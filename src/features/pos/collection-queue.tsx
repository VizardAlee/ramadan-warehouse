"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { SaleDocumentDialog } from "./sale-document";
import type { SaleDocument } from "./types";
import type { HandoverChoice } from "./use-pos-payment-confirmation";
import { parseSaleSerials, validSaleSerials } from "./serial-selection";
import { CollectionPhotoUpload, type CollectionPhotoReference } from "./collection-photos";

interface PendingCollection {
  id: string; saleNumber: string; customerName: string; collectionStatus: string;
  totalQuantity: number; collectedQuantity: number; cancelledQuantity?: number; reservedAt: string | null;
}

interface CollectionRequest {
  action: "collect";
  saleId: string;
  lines: Array<{ saleItemId: string; quantity: number; serialNumbers?: string[] }>;
  collector: string;
  dispatcherPhone?: string;
  vehiclePlate?: string;
  deliveryRecipientName?: string;
  notes?: string;
  evidenceIds?: string[];
  idempotencyKey: string;
}

export function CollectionQueue({ branchId, ownerKey, canRelease, online, handover, onDismissHandover, onLockChange }: {
  branchId: string; ownerKey: string; canRelease: boolean; online: boolean;
  handover?: { saleId: string; choice: HandoverChoice } | null;
  onDismissHandover?: () => void;
  onLockChange?: (locked: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  const [rows, setRows] = useState<PendingCollection[]>([]);
  const [size, setSize] = useState(25);
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [next, setNext] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [document, setDocument] = useState<SaleDocument | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [serialText, setSerialText] = useState<Record<string, string>>({});
  const [collector, setCollector] = useState("");
  const [dispatch, setDispatch] = useState({ dispatcherPhone: "", vehiclePlate: "", deliveryRecipientName: "" });
  const [notes, setNotes] = useState("");
  const [confirmedHandover, setConfirmedHandover] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [print, setPrint] = useState(false);
  const [photos, setPhotos] = useState<CollectionPhotoReference[]>([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const retry = useRef<CollectionRequest | null>(null);
  const flight = useRef(false);
  const selection = useRef(0);
  const active = useRef(true);
  const handledHandover = useRef<string | null>(null);
  const storageKey = `abr-pos-collection:${ownerKey}:${branchId}`;
  const cursor = cursors.at(-1);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { onLockChange?.(busy || uncertain || uploadBusy || !storageReady); }, [busy, uncertain, uploadBusy, storageReady, onLockChange]);
  useEffect(() => () => onLockChange?.(false), [onLockChange]);
  useEffect(() => {
    if (!open || !branchId || !online) return;
    let current = true;
    void callAdministration<object, { rows: PendingCollection[]; nextCursor: string | null }>("getSaleDocument", { action: "list_collections", branchId, limit: size, cursor })
      .then((result) => { if (current) { setRows(result.rows); setNext(result.nextCursor); } })
      .catch((cause) => { if (current) setError(cause instanceof Error ? cause.message : "Collections could not be loaded."); });
    return () => { current = false; };
  }, [open, branchId, online, size, cursor, revision, handover?.saleId]);

  const select = useCallback(async (saleId: string, saved?: CollectionRequest) => {
    if (flight.current || retry.current && retry.current.saleId !== saleId) return;
    const request = ++selection.current;
    setOpen(true); setBusy(true); setError(null); setMessage(null); setDocument(null); setPrint(false);
    try {
      const result = await callAdministration<{ saleId: string }, SaleDocument>("getSaleDocument", { saleId });
      if (!active.current || request !== selection.current) return;
      if (result.branch.id !== branchId || result.sale.id !== saleId) throw new Error("This invoice does not belong to the selected branch. Refresh the correct store before recording handover.");
      setDocument(result);
      setQuantities(Object.fromEntries((saved?.lines ?? []).map(line => [line.saleItemId, String(line.quantity)])));
      setSerialText(Object.fromEntries((saved?.lines ?? []).map(line => [line.saleItemId, line.serialNumbers?.join("\n") ?? ""])));
      setCollector(saved?.collector ?? ""); setNotes(saved?.notes ?? "");
      setDispatch({ dispatcherPhone: saved?.dispatcherPhone ?? "", vehiclePlate: saved?.vehiclePlate ?? "", deliveryRecipientName: saved?.deliveryRecipientName ?? "" });
      setPhotos([]); setConfirmedHandover(Boolean(saved));
    } catch (cause) { if (active.current && request === selection.current) setError(cause instanceof Error ? cause.message : "Invoice could not be loaded. Try opening this handover again."); }
    finally { if (active.current && request === selection.current) setBusy(false); }
  }, [branchId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const raw = sessionStorage.getItem(storageKey);
        const saved: CollectionRequest | null = raw ? JSON.parse(raw) : null;
        if (saved && (saved.action !== "collect" || typeof saved.saleId !== "string" || !Array.isArray(saved.lines) || !saved.lines.length || typeof saved.collector !== "string" || typeof saved.idempotencyKey !== "string" || !/^[0-9a-f-]{36}$/i.test(saved.idempotencyKey))) throw new Error("Invalid saved collection");
        retry.current = saved; setUncertain(Boolean(saved)); setStorageReady(true);
        if (saved && online) void select(saved.saleId, saved);
      } catch { setError("Saved collection instructions could not be read. Check the collection history and restore browser storage before recording another handover."); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey, select, online]);
  useEffect(() => {
    if (!handover || !online || !storageReady || retry.current || handledHandover.current === handover.saleId) return;
    const timer = window.setTimeout(() => { handledHandover.current = handover.saleId; setCursors([undefined]); void select(handover.saleId); }, 0);
    return () => window.clearTimeout(timer);
  }, [handover, online, storageReady, select]);

  const selectedLines = document?.items.filter(item => item.itemKind !== "service").flatMap((item) => {
    const quantity = Number(quantities[item.id] || 0);
    return quantity > 0 ? [{ saleItemId: item.id, quantity, ...(item.trackingType === "serial" ? { serialNumbers: parseSaleSerials(serialText[item.id] ?? "") } : {}) }] : [];
  }) ?? [];
  const invalid = document?.items.filter(item => item.itemKind !== "service").some((item) => {
    const quantity = Number(quantities[item.id] || 0);
    const eligible = (item.serialNumbers ?? []).filter(serial => !item.collectedSerialNumbers?.includes(serial) && !item.cancelledSerialNumbers?.includes(serial));
    return !Number.isInteger(quantity) || quantity < 0 || quantity > item.quantity - (item.collectedQuantity ?? item.quantity) - (item.cancelledQuantity ?? 0) || (item.trackingType === "serial" && quantity > 0 && !validSaleSerials(parseSaleSerials(serialText[item.id] ?? ""), quantity, eligible));
  });
  const remainingItems = document?.items.filter(item => item.itemKind !== "service" && item.quantity > (item.collectedQuantity ?? item.quantity) + (item.cancelledQuantity ?? 0)) ?? [];
  function closeReview() {
    if (busy || uncertain || uploadBusy) return;
    selection.current++; setDocument(null); setPrint(false); setConfirmedHandover(false); onDismissHandover?.();
    setMessage("Review closed. Closing does not cancel the sale or record a handover. Any uncollected goods stay reserved; reopen the invoice below when the handover happens.");
  }
  async function collect() {
    if (!document || !canRelease || !online || !storageReady || flight.current || busy || uploadBusy || (!retry.current && (!confirmedHandover || !selectedLines.length || invalid || collector.trim().length < 2 || photos.some(photo => !selectedLines.some(line => line.saleItemId === photo.saleItemId))))) return;
    flight.current = true; setBusy(true); setError(null);
    const wasUncertain = Boolean(retry.current);
    const payload: CollectionRequest = retry.current ?? { action: "collect", saleId: document.sale.id, lines: selectedLines, collector, ...dispatch, notes: notes || undefined, ...(photos.length ? { evidenceIds: photos.map(photo => photo.evidenceId) } : {}), idempotencyKey: crypto.randomUUID() };
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(payload)); retry.current = payload;
      await callAdministration("confirmPosSaleOrder", payload);
      sessionStorage.removeItem(storageKey); retry.current = null;
      if (!active.current) return;
      setUncertain(false); setConfirmedHandover(false);
      setQuantities({}); setSerialText({}); setPhotos([]); setRevision((value) => value + 1);
      setMessage("Physical handover recorded. Stock and cost accounting were updated together. Review any remaining quantities below.");
      // A failed invoice refresh must not suggest that the successful handover failed.
      try {
        const result = await callAdministration<{ saleId: string }, SaleDocument>("getSaleDocument", { saleId: payload.saleId });
        if (active.current) setDocument(result);
      } catch { if (active.current) { setDocument(null); setError("Handover was recorded, but the updated invoice could not be loaded. Reopen it below; do not record the same goods again."); } }
    } catch (cause) {
      const diagnostic = cause as { diagnosticCode?: string; code?: string };
      const definitive = !wasUncertain && ["functions/invalid-argument", "functions/permission-denied", "functions/failed-precondition", "functions/not-found"].includes(diagnostic?.diagnosticCode ?? diagnostic?.code ?? "");
      if (definitive) {
        try { sessionStorage.removeItem(storageKey); retry.current = null; } catch { /* Keep the original reference. */ }
      }
      if (active.current) { setUncertain(Boolean(retry.current)); setError(cause instanceof Error ? cause.message : "Collection could not be verified. Retry its original reference."); }
    } finally { flight.current = false; if (active.current) setBusy(false); }
  }
  return <section id="pos-collections" className="surface scroll-mt-40 border-2 border-violet-200 p-4 sm:p-5">
    <h2 className="mb-2 text-xl font-semibold">Physical goods handover</h2>
    <p className="mb-3 text-sm">Finish this step when the customer takes the goods. A payment receipt is not proof of physical handover.</p>
    <Button variant="outline" disabled={busy || uncertain || uploadBusy} aria-expanded={open} onClick={() => { setOpen(!open); setCursors([undefined]); }}>Goods awaiting collection</Button>
    <Button className="ml-2" variant="outline" disabled={busy || uncertain || uploadBusy || !online || !storageReady} onClick={() => { setOpen(true); setCursors([undefined]); setRevision(value => value + 1); }}>Refresh handovers</Button>
    {open && <div className="mt-4 space-y-4">
      {handover && (!document || remainingItems.length > 0) && <div className="rounded-xl bg-violet-50 p-3 text-sm"><strong>{handover.choice === "later" ? "Collect later selected" : canRelease ? "Next: confirm the actual handover" : "Next: authorized store handover"}</strong><p>{handover.choice === "later" ? "Leave these goods reserved. Record collection only when the customer actually takes them." : canRelease ? "Review the invoice, enter actual quantities and collector, then confirm physical handover." : "Give the receipt to authorized stock-release staff at this branch. They must open this invoice and record the actual quantities and collector."}</p>{!document && <Button className="mt-2" variant="outline" disabled={busy || uncertain || !online || !storageReady} onClick={() => void select(handover.saleId)}>Open this handover</Button>}</div>}
      {uncertain && !document && <Button disabled={busy || !online || !storageReady} onClick={() => { if (retry.current) void select(retry.current.saleId, retry.current); }}>Recover pending collection</Button>}
      <p className="text-sm text-[var(--muted)]">Payment and physical collection are separate. Reserved goods remain in the store until a release is recorded. This list shows the selected store only.</p>
      {!online && <p>Connect to the internet to review and record collections.</p>}
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {message && <p role="status" className="text-emerald-700">{message}</p>}
      <p className="text-sm text-[var(--muted)]">After seven days, responsible stock-release staff receive a weekly reminder. Goods remain reserved until an authorized collection or cancellation.</p>
      {uncertain && <p role="status" className="text-amber-900">Confirmation was not received. Do not hand over the same goods twice. Retry the saved collection before changing details or starting another release; its original reference is kept on this device after reload.</p>}
      {document && <div className="space-y-3 rounded-xl border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{document.sale.saleNumber} · {(document.sale.collectionStatus ?? "collected").replaceAll("_", " ")}</h3><Button variant="outline" onClick={() => setPrint(true)}>View invoice and collection record</Button><Button variant="outline" disabled={busy || uncertain || uploadBusy} onClick={closeReview}>Close handover review</Button></div>
        {!remainingItems.length && !uncertain && <p role="status" className="rounded-lg bg-emerald-50 p-3">No goods remain awaiting collection on this invoice. No further physical handover is required.</p>}
        {canRelease && remainingItems.length > 0 && <Button variant="outline" disabled={busy || uncertain || uploadBusy || !online} onClick={() => { setQuantities(Object.fromEntries(remainingItems.map(item => [item.id, String(item.quantity - (item.collectedQuantity ?? item.quantity) - (item.cancelledQuantity ?? 0))]))); setConfirmedHandover(false); }}>Use all remaining quantities</Button>}
        {document.items.filter(item => item.itemKind !== "service").map((item) => {
          const remaining = item.quantity - (item.collectedQuantity ?? item.quantity) - (item.cancelledQuantity ?? 0);
          const eligible = (item.serialNumbers ?? []).filter(serial => !item.collectedSerialNumbers?.includes(serial) && !item.cancelledSerialNumbers?.includes(serial));
          return <div key={item.id} className="space-y-2 rounded-lg border p-3">
            {remaining === 0 && <p className="text-xs text-[var(--muted)]">No uncollected, uncancelled units remain for this line. Review recorded collections/cancellations with authorized stock-release staff if the evidence is incorrect.</p>}
            <label className="grid items-center gap-2 sm:grid-cols-[1fr_8rem]"><span>{item.productName} · sold {item.quantity}, collected {item.collectedQuantity ?? item.quantity}, cancelled {item.cancelledQuantity ?? 0}, remaining {remaining}</span><input aria-label={`Collect quantity for ${item.productName}`} type="number" min="0" max={remaining} step="1" value={quantities[item.id] ?? "0"} disabled={!canRelease || busy || uncertain || uploadBusy || !online || !remaining} onChange={(event) => { setConfirmedHandover(false); setQuantities((values) => ({ ...values, [item.id]: event.target.value })); }} className="rounded-lg border p-3" /></label>
            {item.trackingType === "serial" && remaining > 0 && <label className="block text-sm">Serials handed over for {item.productName}<textarea rows={3} disabled={!canRelease || busy || uncertain || !online} value={serialText[item.id] ?? ""} onChange={event => { setConfirmedHandover(false); setSerialText(values => ({ ...values, [item.id]: event.target.value })); }} className="mt-1 w-full rounded-lg border p-3" /><span className="block break-all text-xs text-[var(--muted)]">One per collected unit, one per line. Still reserved: {eligible.join(", ") || "None"}</span></label>}
          </div>;
        })}
        {canRelease && (remainingItems.length > 0 || uncertain) ? <><CollectionPhotoUpload key={document.sale.id + ':' + revision} saleId={document.sale.id} items={document.items.filter(item => item.itemKind !== "service" && item.quantity > (item.collectedQuantity ?? item.quantity) + (item.cancelledQuantity ?? 0))} photos={photos} onChange={setPhotos} locked={busy || uncertain || !online} onBusy={setUploadBusy} />{photos.some(photo => !selectedLines.some(line => line.saleItemId === photo.saleItemId)) && <p className="text-sm text-amber-900">Enter a collection quantity for every photographed product, or remove its photo.</p>}<label className="block text-sm">Collector name<input disabled={busy || uncertain || uploadBusy} maxLength={120} value={collector} onChange={(event) => { setConfirmedHandover(false); setCollector(event.target.value); }} className="mt-1 w-full rounded-lg border p-3" /></label><div className="grid gap-3 sm:grid-cols-2">{([{ key: "dispatcherPhone", label: "Dispatcher phone (optional)", max: 60 }, { key: "vehiclePlate", label: "Vehicle plate (optional)", max: 40 }, { key: "deliveryRecipientName", label: "Delivery recipient name (optional)", max: 120 }] as const).map(field => <label key={field.key} className="block text-sm">{field.label}<input disabled={busy || uncertain || uploadBusy} maxLength={field.max} value={dispatch[field.key]} onChange={event => setDispatch(previous => ({ ...previous, [field.key]: event.target.value }))} className="mt-1 w-full rounded-lg border p-3" /></label>)}</div><label className="block text-sm">Collection notes<textarea disabled={busy || uncertain || uploadBusy} maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1 w-full rounded-lg border p-3" /></label><label className="flex items-start gap-2 rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm"><input type="checkbox" checked={confirmedHandover} disabled={busy || uncertain || uploadBusy || !online} onChange={event => setConfirmedHandover(event.target.checked)} />I confirm these quantities and serials have physically been handed to the named collector.</label><Button aria-busy={busy || uploadBusy} disabledReason={!online ? "Reconnect before recording physical collection." : photos.some(photo => !selectedLines.some(line => line.saleItemId === photo.saleItemId)) ? "Enter the actual collection quantity for every photographed product, or remove its photo." : !uncertain && !selectedLines.length ? "Select the actual units handed over. Ask stock-release staff to review remaining reserved quantities if none are eligible." : !uncertain && invalid ? "Review actual whole quantities and exact still-reserved serials: one unique serial per collected unit. Do not record more goods than are reserved." : !uncertain && collector.trim().length < 2 ? "Enter the actual collector name, at least 2 characters, before recording handover." : !uncertain && !confirmedHandover ? "Confirm that these actual goods have physically been handed to the named collector." : undefined} disabled={busy || uploadBusy || !online || !storageReady || photos.some(photo => !selectedLines.some(line => line.saleItemId === photo.saleItemId)) || (!uncertain && (!confirmedHandover || !selectedLines.length || invalid || collector.trim().length < 2))} onClick={() => void collect()}>{uncertain ? "Retry same collection" : "Record physical collection"}</Button></> : !canRelease ? <p className="rounded-lg bg-amber-50 p-3">A user with stock-release permission must record the physical collection. Give them this invoice at the selected branch; payment alone does not release goods.</p> : null}
      </div>}
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Invoice / customer</th><th>Sold</th><th>Collected</th><th>Still reserved</th><th>Reserved on</th><th /></tr></thead>
        <tbody>{rows.map((sale) => <tr key={sale.id} className="border-t"><td className="p-2"><strong>{sale.saleNumber}</strong><p>{sale.customerName}</p>{Boolean(sale.cancelledQuantity) && <p>{sale.cancelledQuantity} cancelled</p>}</td><td>{sale.totalQuantity}</td><td>{sale.collectedQuantity}</td><td>{sale.totalQuantity - sale.collectedQuantity - (sale.cancelledQuantity ?? 0)}</td><td>{sale.reservedAt ? <>{new Date(sale.reservedAt).toLocaleDateString("en-NG")}<p className="text-xs text-[var(--muted)]">{Math.max(0, Math.floor((new Date().getTime() - new Date(sale.reservedAt).getTime()) / 86400000))} days waiting</p></> : "Date not recorded"}</td><td><Button variant="outline" disabled={busy || uncertain || uploadBusy || !online || !storageReady} onClick={() => void select(sale.id)}>Review collection</Button></td></tr>)}</tbody></table></div>
      {!rows.length && online && <p>No goods awaiting collection on this page.</p>}
      <div className="flex flex-wrap items-center gap-3"><label>Rows per page <select disabled={busy || uncertain || uploadBusy} value={size} onChange={(event) => { setSize(Number(event.target.value)); setCursors([undefined]); }} className="rounded border p-2">{[25, 50, 100].map((value) => <option key={value}>{value}</option>)}</select></label><Button variant="outline" disabled={cursors.length === 1 || busy || uncertain || uploadBusy} onClick={() => setCursors((values) => values.slice(0, -1))}>Previous</Button><span>Page {cursors.length}</span><Button variant="outline" disabled={!next || busy || uncertain || uploadBusy} onClick={() => setCursors((values) => [...values, next!])}>Next</Button></div>

    </div>}
    {print && document && <SaleDocumentDialog document={document} onClose={() => setPrint(false)} />}
  </section>;
}
