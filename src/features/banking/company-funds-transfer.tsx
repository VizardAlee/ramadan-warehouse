"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { formatDateTime, formatNaira, nairaToKobo } from "@/features/inventory/format";
import type { BankAccount } from "@/types/domain";

interface TransferRequest {
  sourceBankAccountId: string; destinationBankAccountId: string; branchId: string;
  amountMinor: number; transferredAt: string; reference: string; reason: string;
  confirmedCompleted: true; idempotencyKey: string;
}
export function CompanyFundsTransfer({ accounts, branchId, ownerKey, onComplete }: {
  accounts: BankAccount[]; branchId?: string; ownerKey: string; onComplete(): void;
}) {
  const storageKey = `abr-pending-company-transfer:${ownerKey}`;
  const [form, setForm] = useState({ source: "", destination: "", amount: "", date: "", reference: "", reason: "", confirmed: false });
  const [pending, setPending] = useState<TransferRequest | null>(null);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => {
    try {
      const stored = sessionStorage.getItem(storageKey);
      setPending(stored ? JSON.parse(stored) as TransferRequest : null);
      setReady(true);
    } catch { setError("The saved transfer could not be read. Do not submit another transfer until its result is checked."); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey]);
  const active = accounts.filter(account => account.active);
  const accountLabel = (id: string) => {
    const account = accounts.find(value => value.id === id);
    return account ? `${account.bankName} · ${account.accountName} · ${account.accountNumberLast4}` : "Previously selected company account";
  };
  const locked = busy || Boolean(pending);
  async function submit() {
    const retry = pending;
    setError(""); setMessage("");
    if (!navigator.onLine) { setError("Reconnect before recording or checking a company-account transfer."); return; }
    setBusy(true);
    try {
      if (!retry && (!branchId || !form.confirmed)) throw new Error("Select a store and confirm the money has already moved.");
      const input: TransferRequest = retry ?? {
        sourceBankAccountId: form.source, destinationBankAccountId: form.destination, branchId: branchId!,
        amountMinor: nairaToKobo(Number(form.amount)), transferredAt: new Date(form.date).toISOString(),
        reference: form.reference.trim(), reason: form.reason.trim(), confirmedCompleted: true, idempotencyKey: crypto.randomUUID(),
      };
      // Persist before sending, so a reload cannot accidentally allocate a new retry key.
      sessionStorage.setItem(storageKey, JSON.stringify(input)); setPending(input);
      const result = await callAdministration<TransferRequest, { journalNumber: string; referenceNumber: string }>("recordCompanyFundsTransfer", input);
      sessionStorage.removeItem(storageKey); setPending(null);
      setForm({ source: "", destination: "", amount: "", date: "", reference: "", reason: "", confirmed: false });
      setMessage(`${result.referenceNumber} recorded. Both sides are posted in ${result.journalNumber}.`);
      onComplete();
    } catch (cause) {
      const code = (cause as { diagnosticCode?: string; code?: string })?.diagnosticCode ?? (cause as { code?: string })?.code;
      if (!retry && ["functions/invalid-argument", "functions/permission-denied", "functions/failed-precondition", "ACCOUNTING_PERIOD_LOCKED"].includes(code ?? "")) {
        sessionStorage.removeItem(storageKey); setPending(null);
      }
      setError(cause instanceof Error ? cause.message : "The transfer result could not be confirmed.");
    } finally { setBusy(false); }
  }
  const valid = form.source && form.destination && form.source !== form.destination && Number(form.amount) > 0 && form.date && form.reference.trim().length >= 2 && form.reason.trim().length >= 5 && form.confirmed && branchId;
  return <details className="rounded-xl border bg-white p-5" open={Boolean(pending) || undefined}>
    <summary className="cursor-pointer text-lg font-semibold">Transfer between company accounts</summary>
    <p className="mt-2 text-sm text-[var(--muted)]">Record money already moved between two company bank accounts. This does not send money through your bank. Both ledger sides post together; it is not sales income or an expense.</p>
    {!branchId && <p className="mt-2 text-sm text-amber-900">Select the responsible store in the top bar before recording a transfer.</p>}
    {error && <p role="alert" className="mt-3 text-red-800">{error}</p>}
    {message && <p role="status" className="mt-3 text-emerald-800">{message}</p>}
    {pending && <p className="mt-3 text-amber-900">Check the saved transfer ({pending.reference}, {formatNaira(pending.amountMinor)}) before recording another. Retry uses the same instructions, including the original store, accounts and date.</p>}
    {pending && <dl className="mt-3 grid gap-2 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-2"><div><dt className="text-[var(--muted)]">From</dt><dd>{accountLabel(pending.sourceBankAccountId)}</dd></div><div><dt className="text-[var(--muted)]">To</dt><dd>{accountLabel(pending.destinationBankAccountId)}</dd></div><div><dt className="text-[var(--muted)]">Date money moved</dt><dd>{formatDateTime(pending.transferredAt)}</dd></div><div><dt className="text-[var(--muted)]">Reason</dt><dd>{pending.reason}</dd></div></dl>}
    <fieldset disabled={locked || !ready} className="mt-4 grid gap-4 sm:grid-cols-2">
      {([ ["source", "From company account"], ["destination", "To company account"] ] as const).map(([field, label]) => <label key={field} className="text-sm">{label}<select className="mt-1 w-full rounded-lg border p-3" value={form[field]} onChange={event => setForm({ ...form, [field]: event.target.value })}><option value="">Choose account</option>{active.map(account => <option key={account.id} value={account.id}>{account.bankName} · {account.accountName} · {account.accountNumberLast4}</option>)}</select></label>)}
      <label className="text-sm">Amount (₦)<input className="mt-1 w-full rounded-lg border p-3" type="number" min="0.01" step="0.01" value={form.amount} onChange={event => setForm({ ...form, amount: event.target.value })} /></label>
      <label className="text-sm">Date money moved<input className="mt-1 w-full rounded-lg border p-3" type="datetime-local" value={form.date} onChange={event => setForm({ ...form, date: event.target.value })} /></label>
      <label className="text-sm">Bank transfer reference<input className="mt-1 w-full rounded-lg border p-3" maxLength={160} value={form.reference} onChange={event => setForm({ ...form, reference: event.target.value })} /></label>
      <label className="text-sm">Reason<input className="mt-1 w-full rounded-lg border p-3" maxLength={500} value={form.reason} onChange={event => setForm({ ...form, reason: event.target.value })} /></label>
      <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={form.confirmed} onChange={event => setForm({ ...form, confirmed: event.target.checked })} />I confirm this transfer has completed between the selected company accounts.</label>
    </fieldset>
    <Button className="mt-4" disabled={busy || !ready || (!pending && !valid)} onClick={() => void submit()}>{busy ? "Checking…" : pending ? "Retry saved transfer" : "Record completed transfer"}</Button>
  </details>;
}
