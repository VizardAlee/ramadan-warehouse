"use client";
import { useEffect, useRef, useState } from "react";
import { callAdministration } from "@/features/administration/api";
import { Button } from "@/components/ui/button";
interface Row { id: string; saleNumber: string; customerName: string; remaining: number; collectionStatus: string }
interface Detail extends Row { items: { id: string; productName: string; remaining: number; unitOfMeasure: string; trackingType: string; serialNumbers: string[] }[] }
interface Request { action: "collect"; saleId: string; lines: { saleItemId: string; quantity: number; serialNumbers?: string[] }[]; collector: string; notes: string; idempotencyKey: string }
export function StockHandoverQueue({ branchId, scope }: { branchId: string; scope: string }) {
  const [loaded, setLoaded] = useState(false);
  const [rows, setRows] = useState<Row[]>([]), [detail, setDetail] = useState<Detail | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({}), [serials, setSerials] = useState<Record<string, string>>({});
  const [collector, setCollector] = useState(""), [notes, setNotes] = useState(""), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [ready, setReady] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [pending, setPending] = useState<Request | null>(null), [revision, setRevision] = useState(0), [cursor, setCursor] = useState<string | undefined>(), [next, setNext] = useState<string | null>(null);
  const flight = useRef(false), active = useRef(true);
  const key = `abr-stock-handover:${scope}:${branchId}`;
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { let current = true; queueMicrotask(() => { if (!current) return; try { const saved = sessionStorage.getItem(key); if (saved) setPending(JSON.parse(saved)); setReady(true); } catch { setError("Retry storage is unavailable. Do not record handover on this device until it is restored."); } }); return () => { current = false; }; }, [key]);
  useEffect(() => {
    let current = true;
    callAdministration<object, { rows: Row[]; nextCursor: string | null }>("getSaleDocument", { action: "stock_collections", branchId, cursor }).then(result => { if (current) { setRows(result.rows); setNext(result.nextCursor); setLoaded(true); } }).catch(cause => { if (current) setError(cause instanceof Error ? cause.message : "Queue could not be loaded."); });
    return () => { current = false; };
  }, [branchId, cursor, revision]);
  async function open(id: string) {
    if (flight.current || pending) return;
    flight.current = true; setBusy(true); setError(""); setDetail(null); setQuantities({}); setSerials({}); setCollector(""); setNotes(""); setConfirmed(false);
    try { const result = await callAdministration<object, Detail>("getSaleDocument", { action: "stock_collection_detail", branchId, saleId: id }); if (active.current) setDetail(result); }
    catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "Handover could not be loaded."); }
    finally { flight.current = false; if (active.current) setBusy(false); }
  }
  const lines = (detail?.items ?? []).filter(item => Number(quantities[item.id]) > 0).map(item => ({ saleItemId: item.id, quantity: Number(quantities[item.id]), ...(item.trackingType === "serial" ? { serialNumbers: (serials[item.id] ?? "").split(/\n/).map(s => s.trim()).filter(Boolean) } : {}) }));
  const invalid = lines.some(line => { const item = detail!.items.find(item => item.id === line.saleItemId)!; return !Number.isSafeInteger(line.quantity) || line.quantity > item.remaining || (item.trackingType === "serial" && (line.serialNumbers?.length !== line.quantity || new Set(line.serialNumbers).size !== line.quantity || line.serialNumbers!.some(serial => !item.serialNumbers.includes(serial)))); });
  async function collect() {
    if (flight.current || !ready || !navigator.onLine || (!pending && (!detail || !confirmed || !lines.length || invalid || collector.trim().length < 2))) return;
    const request = pending ?? { action: "collect" as const, saleId: detail!.id, lines, collector: collector.trim(), notes, idempotencyKey: crypto.randomUUID() };
    flight.current = true; setBusy(true); setError("");
    try {
      sessionStorage.setItem(key, JSON.stringify(request)); setPending(request);
      await callAdministration("confirmPosSaleOrder", request);
      sessionStorage.removeItem(key);
      if (active.current) { setPending(null); setDetail(null); setConfirmed(false); setMessage("Physical handover recorded. Stock and cost accounting updated together."); setRevision(n => n + 1); }
    } catch (cause) {
      // Preserve the exact request after any uncertainty; repeated calls use one idempotency key.
      if (active.current) setError((cause instanceof Error ? cause.message : "Handover outcome is unconfirmed.") + " Retry the saved request; do not create a second handover.");
    } finally { flight.current = false; if (active.current) setBusy(false); }
  }
  return <section className="surface space-y-4 p-5" data-unsaved-work={Boolean(pending || detail)}>
    <h2 className="text-xl font-semibold">Goods awaiting collection</h2><p>Only hand over goods from this selected branch. Payment does not prove collection.</p>
    {error && <p role="alert" className="text-red-800">{error}</p>}{message && <p role="status">{message}</p>}
    {pending ? <div className="rounded border border-amber-400 p-4"><p>A saved handover needs confirmation. Retry this exact request before starting another.</p><Button disabled={busy || !ready} onClick={() => void collect()}>Retry saved handover</Button></div> : <>
      <div className="flex gap-2"><Button variant="secondary" disabled={busy} onClick={() => setRevision(n => n + 1)}>Refresh</Button><Button variant="secondary" disabled={busy || !cursor} onClick={() => setCursor(undefined)}>First page</Button><Button variant="secondary" disabled={busy || !next} onClick={() => setCursor(next ?? undefined)}>Next page</Button></div>
      {!loaded && !error && <p>Loading the current branch queue…</p>}
      {loaded && !rows.length && !error && <p>No pending goods are shown in this branch.</p>}
      {rows.map(row => <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded border p-3"><div><strong>{row.saleNumber}</strong><p>{row.customerName} · {row.collectionStatus === "partially_collected" ? "Partially collected" : "Awaiting collection"}</p></div><Button disabled={busy} onClick={() => void open(row.id)}>Review handover</Button></div>)}
      {detail && <div className="space-y-4 rounded border-2 p-4"><h3 className="font-semibold">{detail.saleNumber} · {detail.customerName}</h3>
        {!detail.items.length && <p>No outstanding units remain. Refresh the queue; do not release again.</p>}
        {detail.items.map(item => <div key={item.id}><label className="block">{item.productName} · {item.remaining} {item.unitOfMeasure} remaining<input aria-label={`Quantity for ${item.productName}`} type="number" min="0" max={item.remaining} step="1" disabled={busy} value={quantities[item.id] ?? ""} onChange={e => { setConfirmed(false); setQuantities(q => ({ ...q, [item.id]: e.target.value })); }} className="block w-full rounded border p-2" /></label>{item.trackingType === "serial" && <label className="block">Exact reserved serials being handed over, one per line<textarea disabled={busy} value={serials[item.id] ?? ""} onChange={e => { setConfirmed(false); setSerials(q => ({ ...q, [item.id]: e.target.value })); }} className="block w-full rounded border p-2" /><span>Available reserved serials: {item.serialNumbers.join(", ")}</span></label>}</div>)}
        <label className="block">Collector name<input maxLength={120} disabled={busy} value={collector} onChange={e => { setConfirmed(false); setCollector(e.target.value); }} className="block w-full rounded border p-2" /></label>
        <label className="block">Notes<textarea maxLength={500} disabled={busy} value={notes} onChange={e => setNotes(e.target.value)} className="block w-full rounded border p-2" /></label>
        <label className="flex gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />These exact goods have physically been handed to the named collector.</label>
        <div className="flex gap-2"><Button variant="secondary" disabled={busy} onClick={() => setDetail(null)}>Close without releasing</Button><Button disabled={busy || !ready || !confirmed || !lines.length || invalid || collector.trim().length < 2} onClick={() => void collect()}>Record physical handover</Button></div>
      </div>}
    </>}
  </section>;
}
