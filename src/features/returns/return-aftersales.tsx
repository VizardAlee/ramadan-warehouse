"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import type { SaleReturn } from "@/types/domain";

export function ReturnAftersales({ record, canRoute, onComplete }: { record: SaleReturn; canRoute: boolean; onComplete: () => void }) {
  const [selection, setSelection] = useState("");
  const [complaint, setComplaint] = useState("");
  const [contactName, setContactName] = useState(""), [contactPhone, setContactPhone] = useState("");
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState("");
  const pending = useRef<Record<string, unknown> | null>(null);
  if (record.status !== "approved" || record.inspectionStatus !== "completed" || record.kind === "reservation_cancellation") return null;
  const eligible = (record.items ?? []).filter(item => ["warranty", "repair"].includes(item.disposition ?? ""));
  const options = eligible.flatMap(item => (item.serialNumbers?.length ? item.serialNumbers : [null]).map(serial => ({ item, serial, key: JSON.stringify([item.id, serial]), link: item.aftersalesCaseLinks?.find(link => link.serialNumber === serial) })));
  if (!options.length) return null;
  const selected = options.find(option => option.key === selection);
  const valid = selected && !selected.link && complaint.trim().length >= 5 && (record.customerId || (contactName.trim().length >= 2 && contactPhone.trim().length >= 5));
  async function submit() {
    if (!pending.current && (!valid || !selected)) return;
    pending.current ??= { returnId: record.id, action: "route_aftersales", idempotencyKey: crypto.randomUUID(), aftersales: { returnItemId: selected!.item.id, serialNumber: selected!.serial ?? undefined, complaint, ...(!record.customerId ? { contactName, contactPhone } : {}) } };
    setBusy(true); setError("");
    try {
      await callAdministration("approveSaleReturn", pending.current);
      pending.current = null; setUncertain(false); onComplete();
    } catch (cause) {
      const code = (cause as { code?: string; diagnosticCode?: string }).diagnosticCode ?? (cause as { code?: string }).code;
      const definitive = ["functions/invalid-argument", "functions/failed-precondition", "functions/not-found", "functions/permission-denied", "functions/already-exists", "SALE_RETURN_ACTION_REQUIRED"].includes(code ?? "");
      if (definitive) pending.current = null;
      setUncertain(!definitive); setError(cause instanceof Error ? cause.message : "Unable to confirm routing. Retry the same request.");
    } finally { setBusy(false); }
  }
  return <details className="mt-3 rounded-lg border p-3">
    <summary className="cursor-pointer font-medium">Warranty / repair follow-up</summary>
    <p className="mt-2 text-sm text-[var(--muted)]">Sending goods to aftersales does not release held stock, issue another refund, or approve a free service. Warranty eligibility and charges are decided in aftersales.</p>
    {options.filter(option => option.link).map(option => <p key={option.key} className="mt-2 text-sm"><a className="underline" href={`/aftersales?caseId=${encodeURIComponent(option.link!.caseId)}`}>Open service case: {option.item.productName} · {option.serial ?? `${option.item.quantity} units`}</a></p>)}
    {canRoute && options.some(option => !option.link) && <>
      <fieldset disabled={busy || uncertain} className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Returned item<select aria-label="Returned item for aftersales" className="mt-1 w-full rounded-lg border p-3" value={selection} onChange={event => setSelection(event.target.value)}><option value="">Select held goods</option>{options.filter(option => !option.link).map(option => <option key={option.key} value={option.key}>{option.item.productName} · {option.serial ?? `${option.item.quantity} units`}</option>)}</select></label>
        <label className="text-sm">Service request<textarea className="mt-1 w-full rounded-lg border p-3" value={complaint} onChange={event => setComplaint(event.target.value)} maxLength={1000} /></label>
        {!record.customerId && <><label className="text-sm">Customer name<input className="mt-1 w-full rounded-lg border p-3" value={contactName} onChange={event => setContactName(event.target.value)} maxLength={160} /></label><label className="text-sm">Customer phone<input className="mt-1 w-full rounded-lg border p-3" value={contactPhone} onChange={event => setContactPhone(event.target.value)} maxLength={50} /></label></>}
      </fieldset>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      <Button className="mt-3" disabled={busy || (!uncertain && !valid)} onClick={() => void submit()}>{uncertain ? "Retry same service request" : busy ? "Sending…" : "Send to aftersales"}</Button>
    </>}
  </details>;
}
