"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";

interface Evidence { evidenceId: string; stage: string; serialNumber: string | null; note: string; uploadedAt: string | null; recordedStatus: string }
export function OperationalPhotos({ kind, recordId, stage, serials, canUpload, serialRequired = false }: {
  kind: "supplier_return" | "aftersales" | "purchase_receipt" | "customer_return"; recordId: string;
  stage: "intake" | "diagnosis" | "handover" | "receiving" | "inspection"; serials: string[]; canUpload: boolean; serialRequired?: boolean;
}) {
  const endpoint = kind === "aftersales" ? "getAftersalesWorkspace" : kind === "customer_return" ? "getSaleReturnWorkspace" : "getProcurementWorkspace";
  const context = kind === "purchase_receipt" ? { evidenceKind: kind } : {};
  const serialLabel = kind === "purchase_receipt" ? "Confirm received serial" : "Confirm returned serial";
  const [open, setOpen] = useState(false), [records, setRecords] = useState<Evidence[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [serialNumber, setSerialNumber] = useState(serials[0] ?? ""), [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null), [uncertain, setUncertain] = useState(false);
  const [photo, setPhoto] = useState<{ contentType: string; base64: string; evidence: Evidence } | null>(null);
  const pending = useRef<Record<string, unknown> | null>(null), input = useRef<HTMLInputElement>(null);
  async function load() {
    const result = await callAdministration<object, { evidence: Evidence[] }>(endpoint, { action: "list_evidence", recordId, ...context });
    setRecords(result.evidence);
  }
  async function toggle() {
    if (open) { setOpen(false); setPhoto(null); return; }
    setOpen(true); setBusy(true); setError("");
    try { await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Photos could not be loaded."); }
    finally { setBusy(false); }
  }
  async function upload() {
    if (busy || (!pending.current && (!file || note.trim().length < 3 || (serialRequired && !serialNumber.trim())))) return;
    setBusy(true); setError("");
    try {
      if (!pending.current && file) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]!);
          reader.onerror = () => reject(new Error("Photo could not be read.")); reader.readAsDataURL(file);
        });
        pending.current = { action: "upload_evidence", recordId, ...context, stage, serialNumber: serialNumber || undefined, note: note.trim(), contentType: file.type, base64, idempotencyKey: crypto.randomUUID() };
      }
      await callAdministration(endpoint, pending.current!);
      pending.current = null; setUncertain(false); setFile(null); setNote("");
      if (input.current) input.current.value = "";
      await load();
    } catch (cause) {
      const code = (cause as { diagnosticCode?: string; code?: string })?.diagnosticCode ?? (cause as { code?: string })?.code;
      if (["OPERATIONAL_EVIDENCE_ACTION_REQUIRED", "functions/invalid-argument", "functions/failed-precondition", "functions/permission-denied", "functions/not-found"].includes(code ?? "")) pending.current = null;
      setUncertain(Boolean(pending.current)); setError(cause instanceof Error ? cause.message : "Photo upload failed.");
    } finally { setBusy(false); }
  }
  async function view(record: Evidence) {
    setBusy(true); setError(""); setPhoto(null);
    try { const result = await callAdministration<object, { contentType: string; base64: string }>(endpoint, { action: "read_evidence", recordId, ...context, evidenceId: record.evidenceId }); setPhoto({ ...result, evidence: record }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Photo could not be loaded."); }
    finally { setBusy(false); }
  }
  return <div className="mt-3 min-w-0 space-y-3 text-sm" data-no-print>
    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void toggle()} aria-expanded={open}>{open ? "Hide photos & serial evidence" : "Photos & serial evidence"}</Button>
    {open && <section className="min-w-0 space-y-3 rounded-xl border p-3">
      <p className="text-[var(--muted)]">Private photos stay linked to this record, serial, staff member and upload time. They cannot be edited or removed here. Uploading never changes stock or payments. Confirm serials yourself; no OCR is used.</p>
      {busy && <p role="status">Loading / saving secure evidence…</p>}
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <ul className="space-y-2">{records.map(record => <li key={record.evidenceId} className="flex flex-wrap items-start justify-between gap-2 rounded-lg bg-slate-50 p-2"><div className="min-w-0 break-words"><strong className="capitalize">{record.stage}</strong>{record.serialNumber && <span> · Serial {record.serialNumber}</span>}<p>{record.note}</p><small>{record.uploadedAt ? new Date(record.uploadedAt).toLocaleString("en-NG") : "Time not recorded"} · Status when recorded: {record.recordedStatus.replaceAll("_", " ")}</small></div><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void view(record)}>View photo</Button></li>)}</ul>
      {!records.length && !busy && <p>No photos recorded yet.</p>}
      {photo && <figure className="space-y-2"><Image unoptimized src={`data:${photo.contentType};base64,${photo.base64}`} width={800} height={600} alt={`${photo.evidence.stage} evidence${photo.evidence.serialNumber ? ` for serial ${photo.evidence.serialNumber}` : ""}`} className="max-h-[45dvh] w-full object-contain" /><figcaption>{photo.evidence.note}</figcaption><Button type="button" variant="outline" size="sm" onClick={() => setPhoto(null)}>Close photo</Button></figure>}
      {canUpload && <fieldset disabled={busy || uncertain} className="grid min-w-0 gap-3 border-t pt-3 sm:grid-cols-2">
        <legend className="pt-2 font-medium capitalize">Add {stage} photo (optional, up to 20 per record)</legend>
        {serials.length > 0 && <label>Confirm recorded serial<select className="mt-1 w-full rounded border p-2" value={serialNumber} onChange={event => setSerialNumber(event.target.value)}>{serials.map(serial => <option key={serial} value={serial}>{serial}</option>)}</select></label>}
        {serialRequired && !serials.length && <label>{serialLabel}<input aria-label={serialLabel} className="mt-1 w-full rounded border p-2" maxLength={160} value={serialNumber} onChange={event => setSerialNumber(event.target.value)} placeholder="Read the serial label on the physical unit" /><small>The server checks this against the original record. No full serial register is downloaded for photo selection.</small></label>}
        <label>Photo description<input className="mt-1 w-full rounded border p-2" maxLength={500} value={note} onChange={event => setNote(event.target.value)} placeholder="Condition, serial label or handover details" /></label>
        <label className="min-w-0 sm:col-span-2">Choose photo / use camera<input ref={input} className="mt-1 block w-full min-w-0" type="file" accept="image/jpeg,image/png" capture="environment" onChange={event => { const chosen = event.target.files?.[0] ?? null; setError(""); if (chosen && (!["image/jpeg", "image/png"].includes(chosen.type) || !chosen.size || chosen.size > 2 * 1024 * 1024)) { setFile(null); setError("Choose a JPEG or PNG no larger than 2 MB."); } else setFile(chosen); }} /><small>JPEG/PNG, 2 MB maximum. Camera availability depends on your device.</small></label>
      </fieldset>}
      {uncertain && <p className="text-amber-800">Confirmation was not received. Retry the same photo without changing it.</p>}
      {(canUpload || uncertain) && <Button type="button" variant="outline" disabled={busy || (!uncertain && (!file || note.trim().length < 3 || records.length >= 20 || (serialRequired && !serialNumber.trim())))} onClick={() => void upload()}>{uncertain ? "Retry same photo" : "Save photo evidence"}</Button>}
    </section>}
  </div>;
}
