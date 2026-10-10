"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { formatNaira, nairaToKobo } from "@/features/inventory/format";
import type { SaleReturn } from "@/types/domain";

const dispositions = { resellable: "Resellable — return to saleable stock on approval", damaged: "Damaged — keep separate", defective: "Defective — keep separate", warranty: "Warranty — route to aftersales", repair: "Repair — keep separate", scrap: "Scrap — do not restock", return_to_supplier: "Return to supplier — keep separate" };
type Disposition = keyof typeof dispositions;
export function ReturnFollowUp({ record, accounts, shifts, onComplete }: { record: SaleReturn; accounts: Array<{ id: string; bankName: string; accountName: string; accountNumberLast4: string }>; shifts: Array<{ id: string; deviceName: string }>; onComplete: () => void }) {
  const [decisions, setDecisions] = useState<Record<string, Disposition>>({});
  const [notes, setNotes] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("bank_transfer");
  const [accountId, setAccountId] = useState("");
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState("");
  const pending = useRef<Record<string, unknown> | null>(null);
  const inspection = record.status === "submitted" && record.kind !== "reservation_cancellation" && record.kind !== "service_credit" && record.inspectionStatus !== "completed";
  const credit = record.exchangeCredit;
  const refund = record.status === "approved" && credit?.status === "active" && credit.remainingAmountMinor > 0;
  const amountMinor = (() => { try { return nairaToKobo(Number(amount)); } catch { return NaN; } })();
  const valid = notes.trim().length >= 5 && (inspection ? Boolean(record.items?.length && record.items.every(item => decisions[item.id])) : Boolean(refund && accountId && Number.isSafeInteger(amountMinor) && amountMinor > 0 && amountMinor <= credit!.remainingAmountMinor));
  if (!inspection && !refund) return null;
  async function submit() {
    if (!pending.current && !valid) return;
    pending.current ??= { returnId: record.id, idempotencyKey: crypto.randomUUID(), action: inspection ? "inspect" : "refund_exchange_credit", ...(inspection ? { inspection: { notes, lines: record.items!.map(item => ({ returnItemId: item.id, disposition: decisions[item.id] })) } } : { refund: { reason: notes, amountMinor, method, ...(method === "cash" ? { shiftId: accountId } : { bankAccountId: accountId }) } }) };
    setBusy(true); setError("");
    try {
      await callAdministration("approveSaleReturn", pending.current);
      pending.current = null; setUncertain(false); onComplete();
    } catch (cause) {
      const code = (cause as { diagnosticCode?: string; code?: string })?.diagnosticCode ?? (cause as { code?: string })?.code;
      const definitive = ["functions/invalid-argument", "functions/failed-precondition", "functions/permission-denied", "functions/not-found", "functions/already-exists", "ACCOUNTING_PERIOD_LOCKED", "SALE_RETURN_ACTION_REQUIRED"].includes(code ?? "");
      if (definitive) pending.current = null;
      setUncertain(!definitive);
      setError(cause instanceof Error ? cause.message : "The request could not be confirmed.");
    } finally { setBusy(false); }
  }
  return <details className="mt-3 w-full rounded-lg border p-3">
    <summary className="cursor-pointer font-medium">{inspection ? "Inspect returned goods" : `Unused exchange credit: ${formatNaira(credit!.remainingAmountMinor)} — refund or keep`}</summary>
    <p className="mt-2 text-sm text-[var(--muted)]">{inspection ? "Physically inspect every item. Nothing becomes available until inspection is recorded and the return is approved. Keep all other dispositions separate from saleable stock." : "For a cheaper replacement, refund only the remaining credit after the replacement sale is confirmed. Keeping the balance for a later sale is also allowed. Record a refund only when money is actually paid."}</p>
    {credit?.lastRedeemedSaleId && <p className="mt-2 break-all text-xs">Latest linked replacement sale: {credit.lastRedeemedSaleNumber ?? "Recorded replacement (see sales register)"}</p>}
    <fieldset disabled={busy || uncertain} className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
      {inspection ? record.items?.map(item => <label key={item.id} className="text-sm">{item.productName} · {item.quantity} returned<select aria-label={`Disposition for ${item.productName}`} value={decisions[item.id] ?? ""} onChange={e => setDecisions(current => ({ ...current, [item.id]: e.target.value as Disposition }))} className="mt-1 w-full rounded-lg border p-3"><option value="">Choose after inspection</option>{Object.entries(dispositions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>) : <>
        <label className="text-sm">Refund amount (₦)<input type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className="mt-1 w-full rounded-lg border p-3" /></label>
        <label className="text-sm">Refund method<select value={method} onChange={e => { setMethod(e.target.value); setAccountId(""); }} className="mt-1 w-full rounded-lg border p-3"><option value="bank_transfer">Bank transfer</option><option value="card">Card/POS</option><option value="cash">Cash</option></select></label>
        <label className="text-sm">{method === "cash" ? "Funding till" : "Funding company account"}<select value={accountId} onChange={e => setAccountId(e.target.value)} className="mt-1 w-full rounded-lg border p-3"><option value="">Select funding source</option>{method === "cash" ? shifts.map(s => <option key={s.id} value={s.id}>{s.deviceName}</option>) : accounts.map(a => <option key={a.id} value={a.id}>{a.bankName} · {a.accountName} · ••••{a.accountNumberLast4}</option>)}</select></label>
      </>}
      <label className="text-sm">{inspection ? "Inspection findings" : "Refund reason / payment reference"}<textarea value={notes} onChange={e => setNotes(e.target.value)} className="mt-1 w-full rounded-lg border p-3" /></label>
    </fieldset>
    {error && <p role="alert" className="mt-2 text-sm text-red-800">{error}</p>}
    {uncertain && <p className="mt-2 text-sm text-amber-900">Confirmation was not received. Retry this same request; do not record another payment.</p>}
    <Button className="mt-3" disabled={busy || (!uncertain && !valid)} onClick={() => void submit()}>{busy ? "Recording…" : uncertain ? "Retry same request" : inspection ? "Record inspection" : "Record credit refund"}</Button>
  </details>;
}
