"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { HeldSupplierCredit } from "./held-supplier-credit";

export interface HeldReturnCase {
  id: string;
  returnId?: string;
  returnItemId?: string;
  productId?: string;
  quantity?: number;
  serialNumber?: string;
  status: string;
  heldDisposedQuantity?: number;
  recentDispositions?: Array<{ transactionId: string; transactionNumber: string; outcome: string; quantity: number; supplierName?: string }>;
}
export function HeldReturnDisposition({ record, suppliers, canDispose, canHandover, canReadHistory = false, canReadSettlement = false, canSettle = false, canReceiveReplacement = false, onComplete }: {
  record: HeldReturnCase; suppliers: Array<{ id: string; name: string }>;
  canDispose: boolean; canHandover: boolean; canReadHistory?: boolean; canReadSettlement?: boolean; canSettle?: boolean; canReceiveReplacement?: boolean; onComplete: () => void;
}) {
  const [outcome, setOutcome] = useState("restock"), [quantity, setQuantity] = useState("1"), [reason, setReason] = useState("");
  const [resellable, setResellable] = useState(false), [supplierId, setSupplierId] = useState(""), [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState("");
  const pending = useRef<Record<string, unknown> | null>(null);
  if (!record.returnId || !record.returnItemId) return null;
  const remaining = (record.quantity ?? 0) - (record.heldDisposedQuantity ?? 0);
  const amount = Number(quantity);
  const valid = Number.isSafeInteger(amount) && amount > 0 && amount <= remaining && (!record.serialNumber || amount === 1) && reason.trim().length >= 5 && (outcome !== "restock" || resellable) && (outcome !== "supplier_handover" || (canHandover && supplierId && reference.trim().length >= 3));
  async function submit() {
    if (!pending.current && !valid) return;
    pending.current ??= { returnId: record.returnId, action: "dispose_held", idempotencyKey: crypto.randomUUID(), disposition: { caseId: record.id, outcome, quantity: amount, reason, confirmedResellable: resellable, ...(outcome === "supplier_handover" ? { supplierId, handoverReference: reference } : {}) } };
    setBusy(true); setError("");
    try {
      await callAdministration("approveSaleReturn", pending.current);
      pending.current = null; setUncertain(false); setReason(""); setResellable(false); onComplete();
    } catch (cause) {
      const code = (cause as { diagnosticCode?: string; code?: string }).diagnosticCode ?? (cause as { code?: string }).code;
      const definitive = ["functions/invalid-argument", "functions/failed-precondition", "functions/not-found", "functions/permission-denied", "functions/already-exists", "SALE_RETURN_ACTION_REQUIRED"].includes(code ?? "");
      if (definitive) pending.current = null;
      setUncertain(!definitive); setError(cause instanceof Error ? cause.message : "Unable to confirm disposition. Retry the same request.");
    } finally { setBusy(false); }
  }
  return <details className="mt-3 rounded-lg border p-3">
    <summary className="cursor-pointer font-medium">Held returned goods · {remaining} remaining</summary>
    <p className="mt-2 text-sm text-[var(--muted)]">Service completion alone does not release stock. Record each final destination here. Restock restores stock and its original cost; scrap and supplier handover do not expense goods twice. A supplier handover is custody only, not a supplier credit note or refund.</p>
    {record.recentDispositions?.map(item => <div key={item.transactionId}><p className="mt-2 text-sm">{item.transactionNumber} · {item.quantity} unit(s) · {item.outcome === "restock" ? "Restocked" : item.outcome === "scrap" ? "Scrapped" : `Handed to ${item.supplierName ?? "supplier"}`}</p>{item.outcome === "supplier_handover" && canReadSettlement && record.productId && <HeldSupplierCredit handoverId={item.transactionId} productId={record.productId} serialNumber={record.serialNumber} canPost={canSettle} returnId={record.returnId} canReceiveReplacement={canReceiveReplacement} />}</div>)}
    {record.productId && canReadHistory && <a className="mt-2 inline-block text-sm underline" href={`/products/${encodeURIComponent(record.productId)}`}>View full product stock history</a>}
    {remaining > 0 && !["completed", "cancelled"].includes(record.status) && <p className="mt-2 text-sm text-amber-800">Finish or cancel the service case first.</p>}
    {remaining > 0 && canDispose && ["completed", "cancelled"].includes(record.status) && <>
      <fieldset disabled={busy || uncertain} className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Final destination<select className="mt-1 w-full rounded-lg border p-3" value={outcome} onChange={event => { setOutcome(event.target.value); setResellable(false); }}><option value="restock">Restock — safe for sale</option><option value="scrap">Scrap — permanently unusable</option>{canHandover && <option value="supplier_handover">Hand over to supplier</option>}</select></label>
        <label className="text-sm">Quantity{record.serialNumber && ` · ${record.serialNumber}`}<input type="number" min="1" max={remaining} step="1" readOnly={Boolean(record.serialNumber)} className="mt-1 w-full rounded-lg border p-3" value={quantity} onChange={event => setQuantity(event.target.value)} /></label>
        <label className="text-sm sm:col-span-2">Inspection / disposition reason<textarea maxLength={1000} className="mt-1 w-full rounded-lg border p-3" value={reason} onChange={event => setReason(event.target.value)} /></label>
        {outcome === "restock" && <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={resellable} onChange={event => setResellable(event.target.checked)} />I inspected these goods and confirm they are resellable.</label>}
        {outcome === "supplier_handover" && <><label className="text-sm">Supplier<select className="mt-1 w-full rounded-lg border p-3" value={supplierId} onChange={event => setSupplierId(event.target.value)}><option value="">Select supplier</option>{suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label><label className="text-sm">Physical handover reference<input maxLength={160} className="mt-1 w-full rounded-lg border p-3" value={reference} onChange={event => setReference(event.target.value)} /></label></>}
      </fieldset>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      <Button className="mt-3" disabled={busy || (!uncertain && !valid)} onClick={() => void submit()}>{uncertain ? "Retry same disposition" : busy ? "Recording…" : "Record final destination"}</Button>
    </>}
  </details>;
}
