"use client";
import { FinancialAction, FinancialActionScope, FinancialDetails, FinancialInput, FinancialMessage, FinancialText, FinancialValue  } from "@/features/finance/financial-privacy";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { firstBlocker } from "@/features/guidance/first-blocker";
import { callAdministration } from "@/features/administration/api";
import { formatDateTime, formatNaira, nairaToKobo } from "@/features/inventory/format";
import type { BankAccount } from "@/types/domain";

interface TransferRequest {
  sourceBankAccountId: string; destinationBankAccountId: string; branchId: string;
  sourceBranchId?: string; destinationBranchId?: string; amountMinor: number; transferredAt: string; reference: string; reason: string;
  confirmedCompleted: true; idempotencyKey: string;
}
export function CompanyFundsTransfer({ accounts, branchId, ownerKey, onComplete, branches = [] }: {
  branches?: Array<{ id: string; name: string }>; accounts: BankAccount[]; branchId?: string; ownerKey: string; onComplete(): void;
}) {
  const storageKey = `abr-pending-company-transfer:${ownerKey}`;
  const [form, setForm] = useState({ source: "", destination: "", sourceBranchId: "", destinationBranchId: "", amount: "", date: "", reference: "", reason: "", confirmed: false });
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
  const sourceStore = accounts.find(row => row.id === form.source)?.branchId || form.sourceBranchId || branchId || "";
  const destinationStore = accounts.find(row => row.id === form.destination)?.branchId || form.destinationBranchId || branchId || "";
  const locked = busy || Boolean(pending);
  async function submit() {
    const retry = pending;
    setError(""); setMessage("");
    if (!navigator.onLine) { setError("Reconnect before recording or checking a company-account transfer."); return; }
    setBusy(true);
    try {
      if (!retry && (!sourceStore || !destinationStore || !form.confirmed)) throw new Error("Select a store and confirm the money has already moved.");
      const input: TransferRequest = retry ?? {
        sourceBankAccountId: form.source, destinationBankAccountId: form.destination, branchId: sourceStore, sourceBranchId: sourceStore, destinationBranchId: destinationStore,
        amountMinor: nairaToKobo(Number(form.amount)), transferredAt: new Date(form.date).toISOString(),
        reference: form.reference.trim(), reason: form.reason.trim(), confirmedCompleted: true, idempotencyKey: crypto.randomUUID(),
      };
      // Persist before sending, so a reload cannot accidentally allocate a new retry key.
      sessionStorage.setItem(storageKey, JSON.stringify(input)); setPending(input);
      const result = await callAdministration<TransferRequest, { journalNumber: string; destinationJournalNumber?: string; referenceNumber: string }>("recordCompanyFundsTransfer", input);
      sessionStorage.removeItem(storageKey); setPending(null);
      setForm({ source: "", destination: "", sourceBranchId: "", destinationBranchId: "", amount: "", date: "", reference: "", reason: "", confirmed: false });
      setMessage(`${result.referenceNumber} recorded. Both sides are posted in ${[result.journalNumber, result.destinationJournalNumber].filter(Boolean).join(" / ")}.`);
      onComplete();
    } catch (cause) {
      const code = (cause as { diagnosticCode?: string; code?: string })?.diagnosticCode ?? (cause as { code?: string })?.code;
      if (!retry && ["functions/invalid-argument", "functions/permission-denied", "functions/failed-precondition", "ACCOUNTING_PERIOD_LOCKED"].includes(code ?? "")) {
        sessionStorage.removeItem(storageKey); setPending(null);
      }
      setError(cause instanceof Error ? cause.message : "The transfer result could not be confirmed.");
    } finally { setBusy(false); }
  }
  const valid = form.source && form.destination && form.source !== form.destination && Number(form.amount) > 0 && form.date && form.reference.trim().length >= 2 && form.reason.trim().length >= 5 && form.confirmed && sourceStore && destinationStore;
  return <FinancialActionScope><details className="rounded-xl border bg-white p-5" open={Boolean(pending) || undefined}>
    <summary className="cursor-pointer text-lg font-semibold">Transfer between company accounts</summary>
    <p className="mt-2 text-sm text-[var(--muted)]">Record money already moved between two company bank accounts. This does not send money through your bank. Both ledger sides post together; it is not sales income or an expense.</p>
    {(!sourceStore || !destinationStore) && <p className="mt-2 text-sm text-amber-900">Select the responsible store in the top bar before recording a transfer.</p>}
    {error && <p role="alert" className="mt-3 text-red-800"><FinancialMessage>{error}</FinancialMessage></p>}
    {message && <p role="status" className="mt-3 text-emerald-800"><FinancialMessage>{message}</FinancialMessage></p>}
    {pending && <p className="mt-3 text-amber-900">Check the saved transfer (<FinancialText>{pending.reference}</FinancialText>, <FinancialValue>{formatNaira(pending.amountMinor)}</FinancialValue>) before recording another. Retry uses the same instructions, including the original store, accounts and date.</p>}
    {pending && <dl className="mt-3 grid gap-2 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-2"><div><dt className="text-[var(--muted)]">From</dt><dd><FinancialText>{accountLabel(pending.sourceBankAccountId)}</FinancialText></dd></div><div><dt className="text-[var(--muted)]">To</dt><dd><FinancialText>{accountLabel(pending.destinationBankAccountId)}</FinancialText></dd></div><div><dt className="text-[var(--muted)]">Date money moved</dt><dd><FinancialText>{formatDateTime(pending.transferredAt)}</FinancialText></dd></div><div><dt className="text-[var(--muted)]">Reason</dt><dd><FinancialDetails>{pending.reason}</FinancialDetails></dd></div></dl>}
    <fieldset disabled={locked || !ready} className="mt-4 grid gap-4 sm:grid-cols-2"><div className="grid gap-3 sm:grid-cols-2">{([{ key: "sourceBranchId", account: form.source, label: "Source store" }, { key: "destinationBranchId", account: form.destination, label: "Destination store" }] as const).map(field => { const owner = accounts.find(row => row.id === field.account)?.branchId; return <label key={field.key} className="block text-sm"><FinancialText>{field.label}</FinancialText>{owner ? <p className="mt-1 rounded-lg border p-3"><FinancialText>{branches.find(row => row.id === owner)?.name ?? owner}</FinancialText> (account owner)</p> : <select className="input mt-1 block w-full" value={form[field.key] || branchId || ""} onChange={event => setForm({ ...form, [field.key]: event.target.value })}><option value="">Choose attribution for company-wide account</option>{branches.map(row => <option key={row.id} value={row.id}><FinancialText>{row.name}</FinancialText></option>)}</select>}</label>; })}</div>
      {([ ["source", "From company account"], ["destination", "To company account"] ] as const).map(([field, label]) => <label key={field} className="text-sm"><FinancialText>{label}</FinancialText><select className="mt-1 w-full rounded-lg border p-3" value={form[field]} onChange={event => setForm({ ...form, [field]: event.target.value })}><option value="">Choose account</option>{active.map(account => <option key={account.id} value={account.id}><FinancialText>{account.bankName}</FinancialText> · <FinancialText>{account.accountName}</FinancialText> · <FinancialText>{account.accountNumberLast4}</FinancialText></option>)}</select></label>)}
      <label className="text-sm">Amount (₦)<FinancialInput><input className="mt-1 w-full rounded-lg border p-3" type="number" min="0.01" step="0.01" value={form.amount} onChange={event => setForm({ ...form, amount: event.target.value })} /></FinancialInput></label>
      <label className="text-sm">Date money moved<input className="mt-1 w-full rounded-lg border p-3" type="datetime-local" value={form.date} onChange={event => setForm({ ...form, date: event.target.value })} /></label>
      <label className="text-sm">Bank transfer reference<input className="mt-1 w-full rounded-lg border p-3" maxLength={160} value={form.reference} onChange={event => setForm({ ...form, reference: event.target.value })} /></label>
      <label className="text-sm">Reason<input className="mt-1 w-full rounded-lg border p-3" maxLength={500} value={form.reason} onChange={event => setForm({ ...form, reason: event.target.value })} /></label>
      <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={form.confirmed} onChange={event => setForm({ ...form, confirmed: event.target.checked })} />I confirm this transfer has completed between the selected company accounts.</label>
    </fieldset>
    <FinancialAction retry={Boolean(pending)}><Button className="mt-4" aria-busy={busy} disabledReason={firstBlocker([
      [!ready, "Wait for the saved transfer check. If storage cannot be read, verify transfer history before recording another."],
      [!sourceStore || !destinationStore, "Select the responsible authorized store in Working location."],
      [active.length < 2, "Two distinct active company accounts are required. Ask authorized finance staff to configure the real accounts, then refresh."],
      [!form.source || !form.destination, "Select the actual source and destination company accounts."],
      [form.source === form.destination, "Source and destination must be different company accounts."],
      [Number(form.amount) <= 0 || !form.amount, "Enter the positive amount that actually moved."],
      [!form.date, "Enter the actual date and time the bank transfer completed."],
      [form.reference.trim().length < 2, "Enter the actual bank reference, at least 2 characters."],
      [form.reason.trim().length < 5, "Enter the business reason, at least 5 characters."],
      [!form.confirmed, "Confirm only after money has actually moved through the bank. This app records the completed movement; it does not transfer money."]
    ])} disabled={busy || !ready || (!pending && !valid)} onClick={() => void submit()}><FinancialText>{busy ? "Checking…" : pending ? "Retry saved transfer" : "Record completed transfer"}</FinancialText></Button></FinancialAction>
    <p className="mt-3 text-sm">Principal is an internal movement, not income or expense. Different stores receive separate balanced journals through interbranch clearing. Record any bank fee separately through <Link className="underline" href={sourceStore ? `/expenses?branchId=${encodeURIComponent(sourceStore)}` : "/expenses"}>Expenses</Link> with its existing approvals.</p>
  </details></FinancialActionScope>;
}
