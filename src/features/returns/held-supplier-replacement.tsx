"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";

export function HeldSupplierReplacement({ returnId, handoverId, remaining, serialized, onComplete }: { returnId: string; handoverId: string; remaining: number; serialized: boolean; onComplete: () => void }) {
  const [quantity, setQuantity] = useState("1"), [serial, setSerial] = useState(""), [reference, setReference] = useState(""), [reason, setReason] = useState("");
  const [inspected, setInspected] = useState(false), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState("");
  const pending = useRef<Record<string, unknown> | null>(null);
  const count = Number(quantity), valid = Number.isSafeInteger(count) && count > 0 && count <= remaining && (!serialized || (count === 1 && serial.trim().length > 0)) && reference.trim().length >= 3 && reason.trim().length >= 5 && inspected;
  async function submit() {
    if (!pending.current && !valid) return;
    pending.current ??= { returnId, action: "receive_supplier_replacement", idempotencyKey: crypto.randomUUID(), replacement: { handoverId, quantity: count, supplierReference: reference.trim(), reason: reason.trim(), confirmedResellable: true, ...(serialized ? { serialNumber: serial.trim() } : {}) } };
    setBusy(true); setError("");
    try { await callAdministration("approveSaleReturn", pending.current); pending.current = null; setUncertain(false); setReference(""); setReason(""); setInspected(false); onComplete(); }
    catch (cause) {
      const value = cause as { diagnosticCode?: string; code?: string };
      const definitive = ["functions/invalid-argument", "functions/failed-precondition", "functions/not-found", "functions/permission-denied", "functions/already-exists", "SALE_RETURN_ACTION_REQUIRED"].includes(value.diagnosticCode ?? value.code ?? "");
      if (definitive) pending.current = null;
      setUncertain(!definitive); setError(cause instanceof Error ? cause.message : "Unable to confirm receipt. Retry the same request.");
    } finally { setBusy(false); }
  }
  return <details className="mt-3 rounded-lg border p-3">
    <summary className="cursor-pointer text-sm font-medium">Receive supplier replacement goods</summary>
    <p className="mt-2 text-sm text-[var(--muted)]">Same-product replacements restore original stock cost. No new purchase, supplier debt, cash or VAT is posted. Do not use this for a different product or a negotiated cash settlement. Customer collection remains a separate recorded action.</p>
    <fieldset disabled={busy || uncertain} className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="text-sm">Replacement quantity<input className="mt-1 w-full rounded-lg border p-3" type="number" min="1" max={remaining} step="1" readOnly={serialized} value={quantity} onChange={event => setQuantity(event.target.value)} /></label>
      <label className="text-sm">Supplier replacement reference<input className="mt-1 w-full rounded-lg border p-3" maxLength={160} value={reference} onChange={event => setReference(event.target.value)} /></label>
      {serialized && <label className="text-sm sm:col-span-2">Replacement serial number<input className="mt-1 w-full rounded-lg border p-3" maxLength={160} value={serial} onChange={event => setSerial(event.target.value)} /><span className="text-xs text-[var(--muted)]">Read the physical unit. A new serial must not already exist; the original serial is allowed only if the supplier returned that same unit.</span></label>}
      <label className="text-sm sm:col-span-2">Replacement inspection notes<textarea className="mt-1 w-full rounded-lg border p-3" maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label>
      <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={inspected} onChange={event => setInspected(event.target.checked)} />I physically received and inspected these same-product goods and confirm they are resellable.</label>
    </fieldset>
    {error && <p role="alert" className="mt-2 text-sm text-red-800">{error}</p>}
    <Button className="mt-3" disabled={busy || (!uncertain && !valid)} onClick={() => void submit()}>{uncertain ? "Retry same replacement receipt" : busy ? "Receiving…" : "Confirm replacement receipt"}</Button>
  </details>;
}
