"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";

export interface CollectionPhotoReference { evidenceId: string; saleItemId: string }

export function CollectionPhotoUpload({ saleId, items, photos, onChange, locked, onBusy }: {
  saleId: string; items: Array<{ id: string; productName: string }>; photos: CollectionPhotoReference[];
  onChange: (photos: CollectionPhotoReference[]) => void; locked: boolean; onBusy: (busy: boolean) => void;
}) {
  const [itemId, setItemId] = useState(items[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef<Record<string, unknown> | null>(null);
  async function upload() {
    if (!file || !itemId || locked || busy) return;
    setBusy(true); onBusy(true); setError(null);
    try {
      if (!pending.current) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]!);
          reader.onerror = () => reject(new Error("Photo could not be read. Choose it again."));
          reader.readAsDataURL(file);
        });
        pending.current = { action: "upload_collection_photo", saleId, saleItemId: itemId, contentType: file.type, base64, idempotencyKey: crypto.randomUUID() };
      }
      const result = await callAdministration<object, CollectionPhotoReference>("confirmPosSaleOrder", pending.current);
      onChange([...photos, result]); pending.current = null; setFile(null);
      if (input.current) input.current.value = "";
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Photo upload failed. Retry the same photo."); }
    finally { setBusy(false); onBusy(false); }
  }
  return <fieldset disabled={locked || busy} className="space-y-2 rounded-lg border p-3">
    <legend className="px-1 font-medium">Collection photos (optional)</legend>
    <p className="text-sm text-[var(--muted)]">Up to five JPEG/PNG photos, 2 MB each. Use a camera where supported. Uploading does not release stock; photos attach when you record collection.</p>
    <label className="block text-sm">Photo product<select className="mt-1 w-full rounded border p-2" value={itemId} onChange={event => { setItemId(event.target.value); pending.current = null; }}>{items.map(item => <option key={item.id} value={item.id}>{item.productName}</option>)}</select></label>
    <label className="block text-sm">Choose collection photo<input ref={input} className="mt-1 block w-full min-w-0 text-sm" type="file" accept="image/jpeg,image/png" capture="environment" onChange={event => {
      pending.current = null; setError(null);
      const chosen = event.target.files?.[0] ?? null;
      if (chosen && (!["image/jpeg", "image/png"].includes(chosen.type) || chosen.size > 2 * 1024 * 1024 || !chosen.size)) { setFile(null); setError("Choose a JPEG or PNG no larger than 2 MB."); return; }
      setFile(chosen);
    }} /></label>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <Button type="button" variant="outline" disabled={!file || !itemId || busy || locked || photos.length >= 5} onClick={() => void upload()}>{busy ? "Uploading photo…" : error && file ? "Retry photo upload" : "Upload collection photo"}</Button>
    {photos.map((photo, index) => <div key={photo.evidenceId} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>Photo {index + 1} · {items.find(item => item.id === photo.saleItemId)?.productName ?? "Product"} · ready to attach</span><Button type="button" variant="outline" size="sm" onClick={() => onChange(photos.filter(value => value.evidenceId !== photo.evidenceId))}>Remove photo {index + 1}</Button></div>)}
  </fieldset>;
}

export function CollectionPhotoViewer({ saleId, evidenceIds }: { saleId: string; evidenceIds: string[] }) {
  const [photo, setPhoto] = useState<{ contentType: string; base64: string; uploadedAt: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function view(evidenceId: string) {
    setBusy(true); setError(null); setPhoto(null);
    try { setPhoto(await callAdministration("getSaleDocument", { action: "collection_photo", saleId, evidenceId })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Photo could not be loaded."); }
    finally { setBusy(false); }
  }
  if (!evidenceIds.length) return null;
  return <div data-no-print className="w-full space-y-2"><div className="flex flex-wrap gap-2">{evidenceIds.map((id, index) => <Button key={id} type="button" variant="outline" size="sm" disabled={busy} onClick={() => void view(id)}>View collection photo {index + 1}</Button>)}</div>
    {busy && <p role="status">Loading secure photo…</p>}{error && <p role="alert" className="text-red-700">{error}</p>}
    {photo && <figure className="rounded-lg border p-3"><Image unoptimized src={`data:${photo.contentType};base64,${photo.base64}`} width={800} height={600} alt="Recorded collection evidence" className="max-h-[50dvh] w-full object-contain" /><figcaption className="my-2 text-sm">{photo.uploadedAt ? `Captured ${new Date(photo.uploadedAt).toLocaleString("en-NG")}` : "Collection evidence"}</figcaption><Button variant="outline" size="sm" onClick={() => setPhoto(null)}>Close photo</Button></figure>}
  </div>;
}
