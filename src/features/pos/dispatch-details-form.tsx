"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import type { SaleDocument } from "./types";

type Collection = NonNullable<SaleDocument["collections"]>[number];
export type DispatchDetails = Pick<Collection, "dispatcherPhone" | "vehiclePlate" | "deliveryRecipientName" | "dispatchDetailsVersion">;
export function DispatchDetailsForm({ saleId, collection, onSaved, onCancel }: { saleId: string; collection: Collection; onSaved: (value: DispatchDetails) => void; onCancel: () => void }) {
  const [details, setDetails] = useState({ dispatcherPhone: collection.dispatcherPhone ?? "", vehiclePlate: collection.vehiclePlate ?? "", deliveryRecipientName: collection.deliveryRecipientName ?? "" });
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState<string>();
  const request = useRef<Record<string, unknown> | null>(null), flight = useRef(false);
  async function save() {
    if (flight.current) return;
    flight.current = true; setBusy(true); setError(undefined);
    request.current ??= { action: "update_dispatch_details", saleId, collectionId: collection.id, expectedVersion: collection.dispatchDetailsVersion ?? 0, ...details, idempotencyKey: crypto.randomUUID() };
    try {
      const result = await callAdministration<Record<string, unknown>, DispatchDetails>("confirmPosSaleOrder", request.current);
      request.current = null; setUncertain(false); onSaved(result);
    } catch (cause) {
      const code = (cause as { code?: string; diagnosticCode?: string })?.diagnosticCode ?? (cause as { code?: string })?.code;
      const definitive = ["functions/invalid-argument", "functions/permission-denied", "functions/failed-precondition", "functions/not-found"].includes(code ?? "");
      if (definitive) request.current = null;
      setUncertain(!definitive);
      setError(cause instanceof Error ? cause.message : "Dispatch details could not be saved.");
    } finally { flight.current = false; setBusy(false); }
  }
  return <section className="space-y-3 rounded-xl border p-4" data-no-print aria-label="Edit dispatch details">
    <p className="text-sm">These optional details belong to this handover only. Saving does not release goods or change payment records.</p>
    {([{ key: "dispatcherPhone", label: "Dispatcher phone", max: 60 }, { key: "vehiclePlate", label: "Vehicle plate", max: 40 }, { key: "deliveryRecipientName", label: "Delivery recipient name", max: 120 }] as const).map(field => <label key={field.key} className="block text-sm">{field.label}<input className="input mt-1 block w-full" maxLength={field.max} disabled={busy || uncertain} value={details[field.key]} onChange={event => setDetails(previous => ({ ...previous, [field.key]: event.target.value }))} /></label>)}
    {error && <p role="alert" className="text-sm">{error}</p>}
    {uncertain && <p role="status" className="text-sm">Confirmation was interrupted. Retry the same details before closing or editing.</p>}
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || uncertain} onClick={onCancel}>Cancel editing</Button><Button disabled={busy} onClick={() => void save()}>{uncertain ? "Retry same dispatch details" : "Save dispatch details"}</Button></div>
  </section>;
}
