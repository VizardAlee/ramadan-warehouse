"use client";
import { AmountInput } from "@/components/ui/amount-input";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { FinancialAction, FinancialActionScope, FinancialInput, FinancialMessage, FinancialText, FinancialValue } from "@/features/finance/financial-privacy";
import { formatNaira } from "@/features/inventory/format";
import type { BankAccount } from "@/types/domain";

export interface BankLifecyclePreview {
  bankAccountId: string;
  lifecycleStatus: "active" | "archived" | "removed";
  hasDependencies: boolean;
  removalMode: "archive" | "remove";
}
interface LedgerAccount { id: string; code: string; name: string; active: boolean; billingControlPurpose?: string; systemManaged?: boolean }
interface SavedInstruction { accountLabel?: string; name: "saveBankAccount" | "accountingJournals"; input: Record<string, unknown> & { action: string; bankAccountId: string; idempotencyKey: string } }
interface Result { bankAccountId?: string; lifecycleStatus?: BankLifecyclePreview["lifecycleStatus"]; journalNumber?: string }
const fieldClass = "mt-1 w-full rounded-lg border bg-white p-2.5";
export function openingAmountMinor(value: string) {
  const clean = value.trim();
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(clean) || clean.length > 32) return null;
  const [whole = "0", fraction = ""] = clean.replace(/^-/, "").split(".");
  const absolute = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (absolute === 0n || absolute > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(absolute) * (clean.startsWith("-") ? -1 : 1);
}
export function bankLifecycleLabel(account: Pick<BankAccount, "active" | "lifecycleStatus">) {
  return account.lifecycleStatus === "removed" ? "Deleted (recoverable)" : !account.active ? "Archived" : "Active";
}

export function BankAccountManagement({ account, branchId, ownerKey, canManage, canPostOpening, managementScopeReady = true, onSaved }: {
  account?: BankAccount; branchId?: string; ownerKey: string; canManage: boolean; canPostOpening: boolean; managementScopeReady?: boolean; onSaved(bankAccountId: string): void;
}) {
  const storageKey = `abr-pending-bank-account:${ownerKey}`;
  const [pending, setPending] = useState<SavedInstruction | null>(null);
  const pendingRef = useRef<SavedInstruction | null>(null), inFlight = useRef(false);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const raw = sessionStorage.getItem(storageKey);
        const saved: unknown = raw ? JSON.parse(raw) : null;
        if (saved && (typeof saved !== "object" || !("name" in saved) || !["saveBankAccount", "accountingJournals"].includes(String(saved.name)) || !("input" in saved) || !saved.input || typeof saved.input !== "object" || !("idempotencyKey" in saved.input) || typeof saved.input.idempotencyKey !== "string" || !("bankAccountId" in saved.input) || typeof saved.input.bankAccountId !== "string" || !("action" in saved.input) || typeof saved.input.action !== "string")) throw new Error("Invalid saved instructions");
        pendingRef.current = saved as SavedInstruction | null; setPending(pendingRef.current); setReady(true);
      } catch { setError("Saved bank instructions could not be read. Check the account and journal history before attempting another change."); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey]);
  async function submit(name?: SavedInstruction["name"], instructions?: Record<string, unknown>) {
    if (inFlight.current || !ready) return;
    const retry = pendingRef.current;
    if (!retry && (!name || !instructions || !account)) return;
    if (!navigator.onLine) { setError("Reconnect before recording or checking bank account instructions."); return; }
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const input = retry ?? { accountLabel: `${account!.bankName} · ${account!.accountName} · ••••${account!.accountNumberLast4}`, name: name!, input: { ...instructions, bankAccountId: account!.id, idempotencyKey: crypto.randomUUID() } } as SavedInstruction;
      sessionStorage.setItem(storageKey, JSON.stringify(input)); pendingRef.current = input; setPending(input);
      const result = await callAdministration<object, Result>(input.name, input.input);
      sessionStorage.removeItem(storageKey); pendingRef.current = null; setPending(null);
      setMessage(result.journalNumber ? `${result.journalNumber} posted as the opening balance. Existing transactions are unchanged.` : result.lifecycleStatus === "removed" ? "Account deleted recoverably. Restore it from the archived / deleted accounts list when needed." : result.lifecycleStatus === "archived" ? "Account archived. Historical records and reconciliation remain available." : "Account restored for new transactions.");
      onSaved(input.input.bankAccountId);
    } catch (cause) {
      const diagnostic = cause as { diagnosticCode?: string; code?: string };
      if (!retry && ["functions/invalid-argument", "functions/permission-denied", "functions/failed-precondition", "functions/already-exists", "ACCOUNTING_PERIOD_LOCKED", "OPERATIONAL_EVIDENCE_ACTION_REQUIRED"].includes(diagnostic.diagnosticCode ?? diagnostic.code ?? "")) {
        sessionStorage.removeItem(storageKey); pendingRef.current = null; setPending(null);
      }
      setError(cause instanceof Error ? cause.message : "The result could not be confirmed. Retry the saved bank instructions before starting another change.");
    } finally { inFlight.current = false; setBusy(false); }
  }
  if (!canManage && !canPostOpening && !pending) return null;
  return <section className="space-y-3" aria-label="Bank account management">
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800"><FinancialMessage>{error}</FinancialMessage></p>}
    {message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-emerald-900"><FinancialMessage>{message}</FinancialMessage></p>}
    {pending && <FinancialActionScope><div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
      <p>Unconfirmed bank instructions: <FinancialText>{pending.input.action.replaceAll("_", " ")}</FinancialText>. Retry the same saved account, amount, date and reference before making another change. Switching accounts does not change this saved instruction.</p>
      <p>Saved account: <FinancialText>{typeof pending.accountLabel === "string" ? pending.accountLabel : pending.input.bankAccountId}</FinancialText></p>
      {typeof pending.input.amountMinor === "number" && <p>Opening amount: <FinancialValue>{formatNaira(pending.input.amountMinor)}</FinancialValue></p>}
      <FinancialAction retry><Button disabled={busy || !ready} onClick={() => void submit()}>Retry saved bank instructions</Button></FinancialAction>
    </div></FinancialActionScope>}
    {account && <AccountActions key={`${account.id}:${account.active}:${account.lifecycleStatus ?? "active"}:${account.openingJournalEntryId ?? ""}:${account.branchId ?? ""}:${branchId ?? ""}`} account={account} branchId={branchId} canManage={canManage} canPostOpening={canPostOpening} managementScopeReady={managementScopeReady} locked={busy || !ready || Boolean(pending)} submit={submit} />}
  </section>;
}

function AccountActions({ account, branchId, canManage, canPostOpening, managementScopeReady, locked, submit }: {
  account: BankAccount; branchId?: string; canManage: boolean; canPostOpening: boolean; managementScopeReady: boolean; locked: boolean;
  submit(name: SavedInstruction["name"], input: Record<string, unknown>): Promise<void>;
}) {
  const [preview, setPreview] = useState<BankLifecyclePreview | null>(null), [previewBusy, setPreviewBusy] = useState(false);
  const [lifecycleReason, setLifecycleReason] = useState(""), [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [openingLoaded, setOpeningLoaded] = useState(false), [openingBusy, setOpeningBusy] = useState(false);
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [form, setForm] = useState({ date: "", amount: "", counterpart: "", reference: "", reason: "", confirmed: false });
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const store = account.branchId || branchId;
  const amount = openingAmountMinor(form.amount);
  // Nigeria has a fixed UTC+01 offset; do not reinterpret the cutover in the device timezone.
  const effectiveTime = form.date ? Date.parse(`${form.date}+01:00`) : NaN;
  const counterpart = accounts.find(value => value.id === form.counterpart);
  const updateForm = (values: Partial<typeof form>) => setForm(current => ({ ...current, confirmed: false, ...values }));
  async function inspect() {
    setPreviewBusy(true); setError(""); setPreview(null); setConfirmed(false);
    try { const result = await callAdministration<object, BankLifecyclePreview>("saveBankAccount", { action: "lifecycle_preview", bankAccountId: account.id }); if (live.current) setPreview(result); }
    catch (cause) { if (live.current) setError(cause instanceof Error ? cause.message : "Account dependencies could not be checked. Nothing was changed."); }
    finally { if (live.current) setPreviewBusy(false); }
  }
  async function loadOpening() {
    if (!store) return;
    setOpeningBusy(true); setError(""); setOpeningLoaded(false);
    try {
      const date = new Date().toISOString().slice(0, 10);
      const result = await callAdministration<object, { accounts: LedgerAccount[] }>("accountingJournals", { action: "workspace", branchId: store, fromDate: date, toDate: date, pageSize: 25 });
      if (live.current) { setAccounts(result.accounts.filter(value => value.active && /^3\d{3}$/.test(value.code) && !["3100", "3999"].includes(value.code) && !value.billingControlPurpose && !value.systemManaged)); setOpeningLoaded(true); }
    } catch (cause) { if (live.current) setError(cause instanceof Error ? cause.message : "Opening balance accounts could not be loaded."); }
    finally { if (live.current) setOpeningBusy(false); }
  }
  const openingValid = store && amount !== null && form.date && Number.isFinite(effectiveTime) && counterpart && form.reference.trim().length >= 2 && form.reason.trim().length >= 5 && form.confirmed;
  return <div className="space-y-3">
    <p className="text-sm">Account status: <strong>{bankLifecycleLabel(account)}</strong>. Ledger <FinancialText>{account.ledgerAccountCode}</FinancialText>. {account.active ? "Available for new transactions." : "Unavailable for new receipts, payments and transfers. Existing records are retained."}</p>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800"><FinancialMessage>{error}</FinancialMessage></p>}
    {canPostOpening && account.active && <FinancialActionScope><details className="rounded-xl border bg-white p-5">
      <summary className="cursor-pointer text-lg font-semibold">Post initial account balance</summary>
      <p className="mt-2 text-sm">Post the documented balance brought forward at the start of this account’s ledger. This does not move money or record sales income. The amount entered when adding a bank account is reference information only.</p>
      {!account.openingJournalEntryId && account.openingBalanceMinor !== 0 && <p className="mt-2 rounded-lg bg-slate-50 p-3 text-sm">Saved opening reference: <FinancialValue>{formatNaira(account.openingBalanceMinor)}</FinancialValue> on {account.openingDate}. This is not a posted balance. The reviewed opening must agree with this original reference; conflicting evidence requires accountant review.</p>}
      {account.openingJournalEntryId ? <p className="mt-3 rounded-lg bg-emerald-50 p-3">An opening journal is already recorded{account.openingJournalNumber ? <>: <FinancialText>{account.openingJournalNumber}</FinancialText></> : ""}. Review it in <Link className="underline" href="/finance">Accounting</Link>. Corrections must preserve the original journal.</p> : <>
        <p className="mt-2 text-sm text-[var(--muted)]">Use an accountant-reviewed opening-equity counterpart. Do not assume brought-forward funds are new owner capital. Check historical journals and statements first; never post an opening twice or invent a balancing amount.</p>
        {!store && <p className="mt-2 text-sm text-amber-900">Select the responsible store in Working location before preparing a company-wide account opening.</p>}
        <Button className="mt-3" variant="outline" disabled={locked || openingBusy || !store} onClick={() => void loadOpening()}>{openingBusy ? "Loading opening setup…" : openingLoaded ? "Refresh opening setup" : "Load opening balance setup"}</Button>
        {openingLoaded && !accounts.length && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm">No reviewed opening-equity account is available. An authorized accountant can create the appropriate non-system equity account in <Link className="underline" href="/finance">Accounting</Link>, then refresh this setup. Bank, stock, customer, supplier and tax control accounts are not substitutes.</p>}
        {openingLoaded && <fieldset disabled={locked || openingBusy} className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">Opening effective date and time (Nigeria)<input className={fieldClass} type="datetime-local" value={form.date} onChange={event => updateForm({ date: event.target.value })} /></label>
            <label className="text-sm">Initial balance (₦)<FinancialInput><AmountInput className={fieldClass} type="number" step="0.01" value={form.amount} onValueChange={rawAmount => updateForm({ amount: rawAmount })} /></FinancialInput></label>
            <label className="text-sm">Opening-equity counterpart<select className={fieldClass} value={form.counterpart} onChange={event => updateForm({ counterpart: event.target.value })}><option value="">Choose reviewed equity account</option>{accounts.map(value => <option key={value.id} value={value.id}><FinancialText>{value.code}</FinancialText> · <FinancialText>{value.name}</FinancialText></option>)}</select></label>
            <label className="text-sm">Opening evidence reference<input className={fieldClass} maxLength={160} value={form.reference} onChange={event => updateForm({ reference: event.target.value })} /></label>
            <label className="text-sm sm:col-span-2">Opening balance reason<input className={fieldClass} maxLength={500} value={form.reason} onChange={event => updateForm({ reason: event.target.value })} /></label>
          </div>
          <p className="text-xs text-[var(--muted)]">Use a negative amount for a documented overdraft. The genuine opening date must be in an open accounting period and precede the first bank transaction. Reconcile periods starting after the opening date. An existing reconciliation requires accountant review before adding an opening; do not change dates to bypass these controls.</p>
          {amount !== null && counterpart && <div className="rounded-lg bg-slate-50 p-3 text-sm" aria-label="Opening journal review"><p>{amount > 0 ? "Debit" : "Credit"} bank <FinancialText>{account.ledgerAccountCode}</FinancialText>: <FinancialValue>{formatNaira(Math.abs(amount))}</FinancialValue></p><p>{amount > 0 ? "Credit" : "Debit"} <FinancialText>{counterpart.code}</FinancialText> · <FinancialText>{counterpart.name}</FinancialText>: <FinancialValue>{formatNaira(Math.abs(amount))}</FinancialValue></p><p>This is a brought-forward opening, not current-period cash movement.</p></div>}
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={form.confirmed} onChange={event => updateForm({ confirmed: event.target.checked })} />I reviewed the original balance, date and counterpart, and confirmed no opening balance has already been posted for this bank account.</label>
          <FinancialAction><Button disabled={!openingValid} onClick={() => { if (!openingValid) return; void submit("accountingJournals", { action: "bank_opening", branchId: store, effectiveAt: new Date(effectiveTime).toISOString(), amountMinor: amount, counterpartAccountId: form.counterpart, reference: form.reference.trim(), reason: form.reason.trim(), confirmedNoPreviousOpening: true }); }}>Post reviewed opening balance</Button></FinancialAction>
        </fieldset>}
      </>}
    </details></FinancialActionScope>}
    {canManage && <details className="rounded-xl border bg-white p-5">
      <summary className="cursor-pointer text-lg font-semibold">{account.active ? "Delete or archive account" : "Restore account"}</summary>
      <p className="mt-2 text-sm">Unused accounts can be deleted recoverably. Accounts with financial history are archived instead. No journal, payment, statement or audit record is deleted; ledger codes stay reserved. Archived accounts remain available for reconciliation.</p>
      {!managementScopeReady && <p className="mt-2 text-sm text-amber-900">Select All locations in Working location before reviewing account removal or restoration.</p>}
      <Button className="mt-3" variant="outline" disabled={locked || previewBusy || !managementScopeReady} onClick={() => void inspect()}>{previewBusy ? "Checking account history…" : account.active ? "Review account removal" : "Review account restoration"}</Button>
      {preview && <fieldset disabled={locked || previewBusy || !managementScopeReady} className="mt-4 space-y-3">
        <p className="rounded-lg bg-slate-50 p-3 text-sm">{preview.lifecycleStatus !== "active" ? "Restore this account for new receipts, payments and transfers. All prior history and the original ledger code remain." : preview.removalMode === "archive" ? "This account has financial history or recorded opening evidence. It will be archived, preserving its history and reconciliation access." : "No financial dependencies were found. This account will be deleted recoverably and can be restored here. The server checks again when you confirm."}</p>
        <label className="block text-sm">Account change reason<input className={fieldClass} maxLength={500} value={lifecycleReason} onChange={event => { setLifecycleReason(event.target.value); setConfirmed(false); }} /></label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I reviewed the selected account and the change described above.</label>
        <Button variant={preview.lifecycleStatus === "active" ? "destructive" : "primary"} disabled={!confirmed || lifecycleReason.trim().length < 5} onClick={() => void submit("saveBankAccount", { action: preview.lifecycleStatus === "active" ? "remove" : "restore", reason: lifecycleReason.trim() })}>{preview.lifecycleStatus !== "active" ? "Restore account" : preview.removalMode === "archive" ? "Archive account" : "Delete unused account"}</Button>
      </fieldset>}
    </details>}
  </div>;
}
