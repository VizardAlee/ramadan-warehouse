"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import type { SaleDocument } from "./types";

type Collection = NonNullable<SaleDocument["collections"]>[number];
export type DispatchDetails = Pick<Collection, "dispatcherPhone" | "vehiclePlate" | "deliveryRecipientName" | "dispatchDetailsVersion">;
export function DispatchDetailsForm({ saleId, collection, onSaved, onCancel }: { saleId: string; collection: Collection; onSaved: (value: DispatchDetails) => void; onCancel: () => void }) {
  const firstField = useRef<HTMLInputElement>(null);
  useEffect(() => { firstField.current?.focus(); }, []);
  const [details, setDetails] = useState({ dispatcherPhone: collection.dispatcherPhone ?? "", vehiclePlate: collection.vehiclePlate ?? "", deliveryRecipientName: collection.deliveryRecipientName ?? "" });
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState<string>();
  const request = useRef<Record<string, unknown> | null>(null), flight = useRef(false);
  async function save() {
    if (flight.current) return;
    flight.current = true; setBusy(true); setError(undefined);
    request.current ??= { action: "update_dispatch_details", saleId, collectionId: collection.id, expectedVersion: collection.dispatchDetailsVersion ?? 0, ...details, idempotencyKey: crypto.randomUUID() };
    try {
      const result = await callAdministration<Record<string, unknown>, DispatchDetails>("confirmPosSaleOrder", request.current);
      if (result.dispatchDetailsVersion !== (collection.dispatchDetailsVersion ?? 0) + 1 || [result.dispatcherPhone, result.vehiclePlate, result.deliveryRecipientName].some(value => value !== null && typeof value !== "string"))
        throw new Error("Save confirmation was incomplete. Retry the same details to confirm the recorded result.");
      request.current = null; setUncertain(false); onSaved(result);
    } catch (cause) {
      const code = (cause as { code?: string; diagnosticCode?: string })?.diagnosticCode ?? (cause as { code?: string })?.code;
      const definitive = ["functions/invalid-argument", "functions/permission-denied", "functions/failed-precondition", "functions/not-found"].includes(code ?? "");
      if (definitive) request.current = null;
      setUncertain(!definitive);
      setError(cause instanceof Error ? cause.message : "Dispatch details could not be saved.");
    } finally { flight.current = false; setBusy(false); }
  }
  return <form onSubmit={event => { event.preventDefault(); void save(); }} className="space-y-3 rounded-xl border p-4" data-no-print aria-label="Edit dispatch details">
    <h3 className="font-semibold">Enter dispatch details</h3>
    <p className="text-sm">These optional details belong to this handover only. Saving does not release goods or change payment records.</p>
    {([{ key: "dispatcherPhone", label: "Dispatcher phone", max: 60 }, { key: "vehiclePlate", label: "Vehicle plate", max: 40 }, { key: "deliveryRecipientName", label: "Delivery recipient name", max: 120 }] as const).map(field => <label key={field.key} className="block text-sm">{field.label}<input ref={field.key === "dispatcherPhone" ? firstField : undefined} type="text" className="input mt-1 block w-full" maxLength={field.max} disabled={busy || uncertain} value={details[field.key]} onChange={event => setDetails(previous => ({ ...previous, [field.key]: event.target.value }))} /></label>)}
    {error && <p role="alert" className="text-sm">{error}</p>}
    {uncertain && <p role="status" className="text-sm">Confirmation was interrupted. Retry the same details before closing or editing.</p>}
    <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy || uncertain} onClick={onCancel}>Cancel editing</Button><Button type="submit" disabled={busy} aria-busy={busy}>{busy ? "Saving dispatch details…" : uncertain ? "Retry same dispatch details" : "Save dispatch details"}</Button></div>
  </form>;
}
