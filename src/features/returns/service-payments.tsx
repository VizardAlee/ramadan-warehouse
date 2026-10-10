"use client";

import { useState } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { formatDateTime, formatNaira, nairaToKobo } from "@/features/inventory/format";
import type { DateTimeValue } from "@/types/domain";

interface Receipt {
  id: string; entryType?: "receipt" | "refund"; amountMinor: number; refundedAmountMinor?: number;
  recordedAt: DateTimeValue; method: string; reference?: string; reason?: string;
  bankName?: string; accountNumberLast4?: string; journalEntryId: string; journalNumber?: string; originalPaymentId?: string;
}
interface Page { payments: Receipt[]; nextCursor: string | null }
interface Props {
  caseId: string; canRefund: boolean; disabled: boolean;
  mutationError?: string | null;
  accounts: Array<{ id: string; bankName: string; accountName: string; accountNumberLast4: string }>;
  onRefund: (input: Record<string, unknown>) => Promise<boolean>;
}

/** Lazy, bounded history reuses the service workspace and its trusted mutation. */
export function ServicePayments({ caseId, canRefund, disabled, mutationError, accounts, onRefund }: Props) {
  const [page, setPage] = useState<Page | null>(null);
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const [size, setSize] = useState(25);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Receipt | null>(null);
  const [draft, setDraft] = useState({ amount: "", reason: "", method: "cash", bankAccountId: "", reference: "" });
  let minor = Number.NaN;
  try { if (draft.amount.trim()) minor = nairaToKobo(Number(draft.amount)); } catch { /* Keep invalid input visible. */ }
  async function load(nextCursors = cursors, limit = size) {
    if (loading) return;
    setLoading(true); setError(null);
    try {
      const result = await callAdministration<Record<string, unknown>, Page>("getAftersalesWorkspace", { action: "list_payments", caseId, paymentCursor: nextCursors.at(-1) || undefined, paymentLimit: limit });
      setPage(result); setCursors(nextCursors); setSize(limit);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Service receipts could not be loaded."); }
    finally { setLoading(false); }
  }
  return <details className="mt-4 rounded-lg border p-3" onToggle={event => { if (event.currentTarget.open && !page) void load(); }}>
    <summary className="cursor-pointer font-semibold">Receipts &amp; refunds</summary>
    <p className="mt-2 text-sm text-[var(--muted)]">Original receipts remain unchanged. A receipt refund returns money and restores the amount due; it does not waive the service charge, cancel work or restock goods.</p>
    {error && <p role="alert" className="mt-2 text-red-700">{error} <button type="button" className="underline" onClick={() => void load()}>Retry history</button></p>}
    {loading && <p role="status" className="mt-2">Loading receipts…</p>}
    {page && <>
      <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Date / reference</th><th className="p-2">Payment account</th><th className="p-2 text-right">Received / refunded</th><th className="p-2">Action</th></tr></thead><tbody>
        {page.payments.map(row => <tr key={row.id} className="border-t">
          <td className="p-2">{formatDateTime(row.recordedAt)}<div className="text-xs text-[var(--muted)]">{row.reference || "No payment reference entered"}</div>{row.reason && <div>{row.reason}</div>}<details className="mt-1 text-xs text-[var(--muted)]"><summary className="cursor-pointer">Accounting references</summary><p className="break-all">Journal: {row.journalNumber || row.journalEntryId}</p>{row.originalPaymentId && <p className="break-all">Original receipt: {row.originalPaymentId}</p>}</details></td>
          <td className="p-2">{row.method.replaceAll("_", " ")}{row.bankName && <div>{row.bankName} · ••••{row.accountNumberLast4}</div>}</td>
          <td className={`p-2 text-right font-semibold ${row.entryType === "refund" ? "text-red-700" : "text-emerald-700"}`}>{row.entryType === "refund" ? "Refunded " : "Received "}{formatNaira(row.amountMinor)}{(row.refundedAmountMinor ?? 0) > 0 && <div className="text-xs text-red-700">Already refunded {formatNaira(row.refundedAmountMinor)}</div>}</td>
          <td className="p-2">{canRefund && row.entryType !== "refund" && row.amountMinor > (row.refundedAmountMinor ?? 0) && <Button variant="secondary" disabled={disabled || loading} onClick={() => { setSelected(row); setDraft({ amount: ((row.amountMinor - (row.refundedAmountMinor ?? 0)) / 100).toFixed(2), reason: "", method: "cash", bankAccountId: "", reference: "" }); }}>Refund receipt</Button>}</td>
        </tr>)}
        {!page.payments.length && <tr><td colSpan={4} className="p-4">No service receipts or refunds recorded.</td></tr>}
      </tbody></table></div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <label className="text-sm">Receipts per page <select aria-label="Service receipts per page" className="rounded border p-2" value={size} disabled={loading || disabled} onChange={event => void load([null], Number(event.target.value))}>{[25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
        <div className="flex items-center gap-2"><Button variant="secondary" disabled={loading || disabled || cursors.length === 1} onClick={() => void load(cursors.slice(0, -1))}>Previous receipts</Button><span>Page {cursors.length}</span><Button variant="secondary" disabled={loading || disabled || !page.nextCursor} onClick={() => void load([...cursors, page.nextCursor])}>Next receipts</Button></div>
      </div>
    </>}
    {selected && <AppDialog role="dialog" aria-modal="true" aria-labelledby={`refund-title-${caseId}`}>
      <section className="app-dialog-panel w-full max-w-lg rounded-2xl bg-white p-6">
        <h3 id={`refund-title-${caseId}`} className="text-xl font-semibold">Refund service receipt</h3>
        <p className="mt-2 text-sm">Remaining refundable: {formatNaira(selected.amountMinor - (selected.refundedAmountMinor ?? 0))}. The original charge stays due after this payment correction.</p>
        {mutationError && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{mutationError} Close this form to use Retry saved service instructions if the result is unconfirmed. Closing does not cancel a submitted refund.</p>}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Refund amount (₦)<input disabled={disabled} className="mt-1 w-full rounded-lg border p-3" type="number" min="0.01" step="0.01" value={draft.amount} onChange={event => setDraft({ ...draft, amount: event.target.value })} /></label>
          <label className="text-sm">Refund method<select disabled={disabled} className="mt-1 w-full rounded-lg border p-3" value={draft.method} onChange={event => setDraft({ ...draft, method: event.target.value, bankAccountId: "" })}><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="card">Card / POS reversal</option></select></label>
          <label className="text-sm sm:col-span-2">Payout account<select disabled={disabled || draft.method === "cash"} className="mt-1 w-full rounded-lg border p-3" value={draft.bankAccountId} onChange={event => setDraft({ ...draft, bankAccountId: event.target.value })}><option value="">{draft.method === "cash" ? "Cash on hand" : "Choose the company account paying"}</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.bankName} · {account.accountName} · ••••{account.accountNumberLast4}</option>)}</select></label>
          <label className="text-sm sm:col-span-2">Refund reason<textarea disabled={disabled} maxLength={500} className="mt-1 w-full rounded-lg border p-3" value={draft.reason} onChange={event => setDraft({ ...draft, reason: event.target.value })} /></label>
          <label className="text-sm sm:col-span-2">Payout reference (optional)<input disabled={disabled} maxLength={160} className="mt-1 w-full rounded-lg border p-3" value={draft.reference} onChange={event => setDraft({ ...draft, reference: event.target.value })} /></label>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-3"><Button variant="secondary" onClick={() => setSelected(null)}>Close refund form</Button><Button disabled={disabled || loading || !Number.isSafeInteger(minor) || minor <= 0 || minor > selected.amountMinor - (selected.refundedAmountMinor ?? 0) || draft.reason.trim().length < 5 || (draft.method !== "cash" && !draft.bankAccountId)} onClick={async () => {
          const saved = await onRefund({ action: "refund", caseId, originalPaymentId: selected.id, amountMinor: minor, method: draft.method, bankAccountId: draft.bankAccountId || undefined, reason: draft.reason, reference: draft.reference || undefined, idempotencyKey: crypto.randomUUID() });
          if (saved) { setSelected(null); await load([null]); }
        }}>Confirm receipt refund</Button></div>
      </section>
    </AppDialog>}
  </details>;
}
