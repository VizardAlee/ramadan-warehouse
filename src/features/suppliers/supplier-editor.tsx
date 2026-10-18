"use client";
import { useRef, useState } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import type { Supplier } from "@/types/domain";
export function SupplierEditor({ supplier, onClose, onSaved }: { supplier?: Supplier; onClose: () => void; onSaved: (id: string) => void }) {
  const [form, setForm] = useState({ name: supplier?.name ?? "", supplierType: supplier?.supplierType ?? "goods", phone: supplier?.phone ?? "", email: supplier?.email ?? "", address: supplier?.address ?? "", taxId: supplier?.taxId ?? "", paymentTermsDays: supplier?.paymentTermsDays ?? 0, active: supplier?.active ?? true });
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState<string>();
  const pending = useRef<Record<string, unknown> | null>(null), flight = useRef(false);
  const ref = useDialogFocus<HTMLElement>(true, busy || uncertain ? undefined : onClose);
  async function save() {
    if (flight.current) return; flight.current = true; setBusy(true); setError(undefined);
    pending.current ??= { ...form, supplierId: supplier?.id, phone: form.phone || undefined, email: form.email || undefined, idempotencyKey: crypto.randomUUID() };
    try { const result = await callAdministration<object, { supplierId: string }>("saveSupplier", pending.current); pending.current = null; onSaved(result.supplierId); }
    catch (cause) { const code = (cause as { diagnosticCode?: string })?.diagnosticCode; if (["functions/invalid-argument", "functions/failed-precondition", "functions/permission-denied", "functions/already-exists"].includes(code ?? "")) pending.current = null; setUncertain(Boolean(pending.current)); setError(cause instanceof Error ? cause.message : "Supplier could not be saved."); }
    finally { flight.current = false; setBusy(false); }
  }
  return <AppDialog role="dialog" aria-modal="true" aria-label={supplier ? "Edit supplier" : "Add supplier"}><section ref={ref} className="app-dialog-panel max-w-xl space-y-4 rounded-2xl bg-white p-5"><h2 className="text-xl font-semibold">{supplier ? "Edit supplier" : "Add dealer / supplier"}</h2><p className="text-sm">Use this party for goods or services bought by the company. A party buying from the company remains a separate customer account.</p>{error && <p role="alert">{error}</p>}{uncertain && <p role="status">Retry the same saved details before creating another supplier.</p>}<fieldset disabled={busy || uncertain} className="space-y-3">
    <label className="block text-sm">Supplier name<input className="input mt-1 block w-full" maxLength={160} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
    <label className="block text-sm">Supplier type<select className="input mt-1 block w-full" value={form.supplierType} onChange={event => setForm({ ...form, supplierType: event.target.value as typeof form.supplierType })}>{["goods", "service", "logistics", "mixed"].map(type => <option key={type}>{type}</option>)}</select></label>
    {([{ key: "phone", label: "Phone", max: 40 }, { key: "email", label: "Email", max: 254 }, { key: "address", label: "Address", max: 500 }, { key: "taxId", label: "Tax ID", max: 80 }] as const).map(field => <label className="block text-sm" key={field.key}>{field.label}<input className="input mt-1 block w-full" maxLength={field.max} value={form[field.key]} onChange={event => setForm({ ...form, [field.key]: event.target.value })} /></label>)}
    <label className="block text-sm">Payment terms (days)<input className="input mt-1 block w-full" type="number" min="0" max="365" step="1" value={form.paymentTermsDays} onChange={event => setForm({ ...form, paymentTermsDays: Number(event.target.value) })} /></label><label className="flex items-center gap-2"><input type="checkbox" checked={form.active} onChange={event => setForm({ ...form, active: event.target.checked })} />Active supplier</label></fieldset><div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={busy || uncertain} onClick={onClose}>Cancel</Button><Button disabled={busy || (!uncertain && (form.name.trim().length < 2 || (!form.phone.trim() && !form.email.trim())))} onClick={() => void save()}>{uncertain ? "Retry same supplier" : "Save supplier"}</Button></div></section></AppDialog>;
}
