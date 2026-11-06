"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { FinancialMessage, FinancialText, FinancialValue } from "@/features/finance/financial-privacy";
import { formatNaira } from "./format";
import type { InventoryEntry } from "@/types/domain";
export function OpeningStockCorrection({ entry, productName, onClose, onReversed }: { entry: InventoryEntry; productName: string; onClose: () => void; onReversed: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false), [attempted, setAttempted] = useState(false), [complete, setComplete] = useState(false), [error, setError] = useState("");
  const retryKey = useRef<string | null>(null);
  const dialog = useDialogFocus<HTMLElement>(true, () => { if (!busy) onClose(); });
  async function reverse() {
    if (reason.trim().length < 5 || busy) return;
    setBusy(true); setError(""); setAttempted(true);
    retryKey.current ??= crypto.randomUUID();
    try {
      await callAdministration("reverseInventoryTransaction", { transactionId: entry.transactionId, reason: reason.trim(), idempotencyKey: retryKey.current });
      setComplete(true); onReversed();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The reversal could not be confirmed. Retry the same reversal or review movement history."); }
    finally { setBusy(false); }
  }
  const replacement = `/inventory/opening-stock?productId=${encodeURIComponent(entry.productId)}&locationId=${encodeURIComponent(entry.locationId ?? "")}&referenceNumber=${encodeURIComponent(entry.transactionNumber)}`;
  return <AppDialog role="dialog" aria-modal="true" aria-labelledby="opening-correction-title"><section ref={dialog} className="app-dialog-panel max-w-xl bg-white p-6">
    <h2 id="opening-correction-title" className="text-xl font-semibold">Correct opening stock</h2>
    <p className="mt-2 font-semibold"><FinancialText>{productName}</FinancialText></p>
    <p className="mt-2 text-sm">Original reference: <FinancialText>{entry.transactionNumber}</FinancialText> · quantity <FinancialText>{entry.quantityDelta}</FinancialText> · unit cost <FinancialValue>{formatNaira(entry.unitCostMinor)}</FinancialValue></p>
    {complete ? <><p role="status" className="mt-4">The original entry has been reversed. Enter the replacement quantity and cost next. The original and its reversal remain in history.</p><Link href={replacement} className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-[var(--brand)] px-4 text-white">Enter replacement opening stock</Link></> : <>
      <p className="mt-4 text-sm">First reverse this entry, then enter a separate replacement. This temporarily removes this opening quantity until the replacement is posted. Later stock activity or a locked accounting period can prevent reversal.</p>
      <p className="mt-2 text-sm">If goods have already moved, use a controlled stock adjustment for a quantity correction. Ask authorized accounting staff to review a cost correction.</p>
      <label className="mt-4 block text-sm">Correction reason<textarea value={reason} onChange={event => setReason(event.target.value)} disabled={attempted} minLength={5} maxLength={500} className="mt-1 w-full rounded-lg border p-2" /></label>
      {error && <p role="alert" className="mt-3 text-sm text-red-700"><FinancialMessage>{error}</FinancialMessage></p>}
      <Button className="mt-4" disabled={busy || reason.trim().length < 5} onClick={() => void reverse()}>{busy ? "Reversing…" : attempted ? "Retry same reversal" : "Reverse opening entry"}</Button>
    </>}
    <Button className="ml-2 mt-4" variant="outline" disabled={busy} onClick={onClose}>Close</Button>
  </section></AppDialog>;
}
