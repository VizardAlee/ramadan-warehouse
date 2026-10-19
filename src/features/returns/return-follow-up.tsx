"use client";
import { FinancialAction, FinancialActionScope, FinancialAttributes, FinancialInput, FinancialMessage, FinancialText, FinancialValue  } from "@/features/finance/financial-privacy";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { firstBlocker } from "@/features/guidance/first-blocker";
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
  return <FinancialActionScope><details className="mt-3 w-full rounded-lg border p-3">
    <summary className="cursor-pointer font-medium"><FinancialValue>{inspection ? "Inspect returned goods" : `Unused exchange credit: ${formatNaira(credit!.remainingAmountMinor)} — refund or keep`}</FinancialValue></summary>
    <p className="mt-2 text-sm text-[var(--muted)]"><FinancialText>{inspection ? "Physically inspect every item. Nothing becomes available until inspection is recorded and the return is approved. Keep all other dispositions separate from saleable stock." : "For a cheaper replacement, refund only the remaining credit after the replacement sale is confirmed. Keeping the balance for a later sale is also allowed. Record a refund only when money is actually paid."}</FinancialText></p>
    {credit?.lastRedeemedSaleId && <p className="mt-2 break-all text-xs">Latest linked replacement sale: <FinancialText>{credit.lastRedeemedSaleNumber ?? "Recorded replacement (see sales register)"}</FinancialText></p>}
    <fieldset disabled={busy || uncertain} className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
      {inspection ? record.items?.map(item => <label key={item.id} className="text-sm"><FinancialText>{item.productName}</FinancialText> · <FinancialText>{item.quantity}</FinancialText> returned<FinancialAttributes><select aria-label={`Disposition for ${item.productName}`} value={decisions[item.id] ?? ""} onChange={e => setDecisions(current => ({ ...current, [item.id]: e.target.value as Disposition }))} className="mt-1 w-full rounded-lg border p-3"><option value="">Choose after inspection</option>{Object.entries(dispositions).map(([value, label]) => <option key={value} value={value}><FinancialText>{label}</FinancialText></option>)}</select></FinancialAttributes></label>) : <>
        <label className="text-sm">Refund amount (₦)<FinancialInput><input type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className="mt-1 w-full rounded-lg border p-3" /></FinancialInput></label>
        <label className="text-sm">Refund method<select value={method} onChange={e => { setMethod(e.target.value); setAccountId(""); }} className="mt-1 w-full rounded-lg border p-3"><option value="bank_transfer">Bank transfer</option><option value="card">Card/POS</option><option value="cash">Cash</option></select></label>
        <label className="text-sm"><FinancialText>{method === "cash" ? "Funding till" : "Funding company account"}</FinancialText><select value={accountId} onChange={e => setAccountId(e.target.value)} className="mt-1 w-full rounded-lg border p-3"><option value="">Select funding source</option>{method === "cash" ? shifts.map(s => <option key={s.id} value={s.id}><FinancialText>{s.deviceName}</FinancialText></option>) : accounts.map(a => <option key={a.id} value={a.id}><FinancialText>{a.bankName}</FinancialText> · <FinancialText>{a.accountName}</FinancialText> · ••••<FinancialText>{a.accountNumberLast4}</FinancialText></option>)}</select></label>
      </>}
      <label className="text-sm"><FinancialText>{inspection ? "Inspection findings" : "Refund reason / payment reference"}</FinancialText><textarea value={notes} onChange={e => setNotes(e.target.value)} className="mt-1 w-full rounded-lg border p-3" /></label>
    </fieldset>
    {error && <p role="alert" className="mt-2 text-sm text-red-800"><FinancialMessage>{error}</FinancialMessage></p>}
    {uncertain && <p className="mt-2 text-sm text-amber-900">Confirmation was not received. Retry this same request; do not record another payment.</p>}
    <FinancialAction retry={uncertain} financial={!inspection}><Button className="mt-3" aria-busy={busy} disabledReason={firstBlocker([
      [inspection && !record.items?.every(item => decisions[item.id]), "Physically inspect and select a disposition for every returned item before recording inspection."],
      [notes.trim().length < 5, inspection ? "Enter inspection findings, at least 5 characters." : "Enter the refund reason/payment reference, at least 5 characters."],
      [!inspection && (!Number.isSafeInteger(amountMinor) || amountMinor <= 0), "Enter a positive refund amount with no more than two decimal places."],
      [!inspection && amountMinor > (credit?.remainingAmountMinor ?? 0), `Only ${formatNaira(credit?.remainingAmountMinor ?? 0)} unused exchange credit remains; refund only the amount actually returned.`],
      [!inspection && !accountId, method === "cash" ? shifts.length ? "Select the actual open paying till." : "No open paying till is available. Ask the assigned original-store shift staff to open it." : accounts.length ? "Select the actual paying company account." : "No active paying account is available. Ask authorized finance staff to configure it, then refresh."]
    ])} disabled={busy || (!uncertain && !valid)} onClick={() => void submit()}><FinancialText>{busy ? "Recording…" : uncertain ? "Retry same request" : inspection ? "Record inspection" : "Record credit refund"}</FinancialText></Button></FinancialAction>
  </details></FinancialActionScope>;
}
