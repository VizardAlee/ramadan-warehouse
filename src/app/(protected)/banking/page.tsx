"use client";

import { CheckCircle2, Landmark, Link2, RefreshCw, Unlink, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { useAuth } from "@/features/auth/auth-context";
import { formatNaira, nairaToKobo } from "@/features/inventory/format";
import { hasPermission } from "@/lib/permissions/roles";
import type { BankAccount, BankReconciliation, BankStatementTransaction } from "@/types/domain";

interface JournalLine {
  id: string;
  journalEntryId: string;
  journalNumber: string;
  accountCode: string;
  accountName: string;
  debitMinor: number;
  creditMinor: number;
  effectiveAt: unknown;
  bankStatementTransactionId?: string;
  bankReconciliationId?: string;
}
interface Workspace {
  accounts: BankAccount[];
  statementTransactions: BankStatementTransaction[];
  journalLines: JournalLine[];
  reconciliations: BankReconciliation[];
}
function localDate() {
  const date = new Date(), offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}
function signedNairaToKobo(value: string) {
  const naira = Number(value), kobo = Math.round(naira * 100);
  if (!Number.isFinite(naira) || !Number.isSafeInteger(kobo) || Math.abs(naira * 100 - kobo) > 1e-6)
    throw new Error("Enter a valid naira balance with no more than two decimal places.");
  return kobo;
}
function parseStatementRows(value: string) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line, index) => {
    const [transactionDate, description, amountNaira, reference, externalId] = line.split(/\t|,/).map((part) => part.trim());
    if (!transactionDate || !/^\d{4}-\d{2}-\d{2}$/.test(transactionDate) || !description || !amountNaira)
      throw new Error(`Statement row ${index + 1} must contain date, description and amount.`);
    const numeric = Number(amountNaira.replaceAll("₦", "").replaceAll(" ", ""));
    if (!Number.isFinite(numeric) || numeric === 0) throw new Error(`Statement row ${index + 1} has an invalid amount.`);
    return { transactionDate, description, amountMinor: numeric < 0 ? -nairaToKobo(Math.abs(numeric)) : nairaToKobo(numeric), reference: reference || undefined, externalId: externalId || undefined };
  });
}

export default function BankingPage() {
  const { user, profile } = useAuth();
  const can = (permission: Parameters<typeof hasPermission>[1]) => Boolean(profile && hasPermission(profile, permission));
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [message, setMessage] = useState<string | null>(null);
  const [matches, setMatches] = useState<Record<string, string>>({});
  const [statementText, setStatementText] = useState("");
  const [accountForm, setAccountForm] = useState({ bankName: "", accountName: "ABR operating account", accountNumberLast4: "", ledgerAccountCode: "1030", openingBalanceNaira: "0.00", openingDate: localDate() });
  const monthStart = `${localDate().slice(0, 8)}01`;
  const [reconciliationForm, setReconciliationForm] = useState({ periodStart: monthStart, periodEnd: localDate(), openingBalanceNaira: "", closingBalanceNaira: "", notes: "" });

  const load = useCallback(async (accountId: string) => {
    if (!profile) return;
    setBusy(true); setError(null);
    try {
      const result = await callAdministration<{ bankAccountId?: string }, Workspace>("getBankReconciliationWorkspace", { bankAccountId: accountId || undefined });
      setWorkspace(result);
      if (!accountId && result.accounts.length) setSelectedAccountId(result.accounts[0]!.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Bank reconciliation could not be loaded."); }
    finally { setBusy(false); }
  }, [profile]);
  useEffect(() => { const timer = window.setTimeout(() => void load(selectedAccountId), 0); return () => window.clearTimeout(timer); }, [load, selectedAccountId]);
  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true); setError(null); setMessage(null);
    try { await action(); setMessage(success); await load(selectedAccountId); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The bank operation could not be completed."); }
    finally { setBusy(false); }
  }
  const selectedAccount = workspace?.accounts.find((account) => account.id === selectedAccountId);
  const availableLines = useMemo(() => workspace?.journalLines.filter((line) => !line.bankStatementTransactionId) ?? [], [workspace?.journalLines]);
  const matchedCount = workspace?.statementTransactions.filter((transaction) => transaction.status !== "unmatched").length ?? 0;

  if (!profile || !can("banking.read")) return <div className="rounded-xl border bg-white p-6">Your roles do not include bank-reconciliation access.</div>;
  return <div className="space-y-5">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[.16em] text-[var(--brand)]">Statement to ledger</p><h1 className="text-3xl font-semibold">Bank reconciliation</h1><p className="text-[var(--muted)]">Import the statement, match every deposit and withdrawal to account 1030, then have another authorized person close the period.</p></div><Button variant="outline" disabled={busy} onClick={() => void load(selectedAccountId)}><RefreshCw className="mr-2 size-4" /> Refresh</Button></header>
    {error && <div role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</div>}
    {message && <div role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">{message}</div>}

    {can("banking.manage") && <details open={!workspace?.accounts.length} className="rounded-xl border bg-white p-5"><summary className="cursor-pointer text-lg font-semibold">1. Add a bank account</summary><p className="mt-1 text-sm text-[var(--muted)]">Only the last four digits are stored. Ledger code 1030 is the existing bank-transfer clearing account; use a separate 10xx code for each additional real bank account.</p><div className="mt-4 grid gap-3 md:grid-cols-3">
      <label className="text-sm">Bank name<input className="mt-1 w-full rounded-lg border p-3" value={accountForm.bankName} onChange={(event) => setAccountForm({ ...accountForm, bankName: event.target.value })} placeholder="e.g. Access Bank" /></label>
      <label className="text-sm">Account name<input className="mt-1 w-full rounded-lg border p-3" value={accountForm.accountName} onChange={(event) => setAccountForm({ ...accountForm, accountName: event.target.value })} /></label>
      <label className="text-sm">Account number — last 4 digits<input inputMode="numeric" maxLength={4} className="mt-1 w-full rounded-lg border p-3" value={accountForm.accountNumberLast4} onChange={(event) => setAccountForm({ ...accountForm, accountNumberLast4: event.target.value.replaceAll(/\D/g, "") })} placeholder="1234" /></label>
      <label className="text-sm">Ledger account code<input className="mt-1 w-full rounded-lg border p-3" value={accountForm.ledgerAccountCode} onChange={(event) => setAccountForm({ ...accountForm, ledgerAccountCode: event.target.value })} /></label>
      <label className="text-sm">Opening balance (₦)<input type="number" step="0.01" className="mt-1 w-full rounded-lg border p-3" value={accountForm.openingBalanceNaira} onChange={(event) => setAccountForm({ ...accountForm, openingBalanceNaira: event.target.value })} /></label>
      <label className="text-sm">Opening balance date<input type="date" className="mt-1 w-full rounded-lg border p-3" value={accountForm.openingDate} onChange={(event) => setAccountForm({ ...accountForm, openingDate: event.target.value })} /></label>
    </div><Button className="mt-4" disabled={busy || accountForm.bankName.trim().length < 2 || accountForm.accountName.trim().length < 2 || accountForm.accountNumberLast4.length !== 4 || !/^10\d{2}$/.test(accountForm.ledgerAccountCode)} onClick={() => void run(async () => { const result = await callAdministration<typeof accountForm & { openingBalanceMinor: number; active: boolean }, { bankAccountId: string }>("saveBankAccount", { ...accountForm, openingBalanceMinor: signedNairaToKobo(accountForm.openingBalanceNaira), active: true }); setSelectedAccountId(result.bankAccountId); }, "Bank account added securely.")}><Landmark className="mr-2 size-4" /> Add bank account</Button></details>}

    <section className="rounded-xl border bg-white p-5"><div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between"><label className="text-sm md:min-w-80">Bank account<select className="mt-1 w-full rounded-lg border p-3" value={selectedAccountId} onChange={(event) => setSelectedAccountId(event.target.value)}><option value="">Select bank account</option>{workspace?.accounts.map((account) => <option key={account.id} value={account.id}>{account.bankName} · {account.accountName} ·•••• {account.accountNumberLast4}</option>)}</select></label>{selectedAccount && <div className="grid grid-cols-2 gap-3 text-sm"><span className="rounded-lg bg-slate-50 p-3">Statement rows <strong className="block text-lg">{workspace?.statementTransactions.length ?? 0}</strong></span><span className="rounded-lg bg-emerald-50 p-3">Matched <strong className="block text-lg">{matchedCount}</strong></span></div>}</div></section>

    {selectedAccount && can("banking.reconcile") && <details open={!workspace?.statementTransactions.length} className="rounded-xl border bg-white p-5"><summary className="cursor-pointer text-lg font-semibold">2. Import statement transactions</summary><p className="mt-1 text-sm text-[var(--muted)]">Paste one CSV or tab-separated row per transaction: <code>YYYY-MM-DD, description, amount, reference, bank ID</code>. Deposits are positive; withdrawals are negative. Reference and bank ID are optional. Re-imported rows are safely skipped.</p><textarea className="mt-4 min-h-32 w-full rounded-lg border p-3 font-mono text-sm" value={statementText} onChange={(event) => setStatementText(event.target.value)} placeholder={"2026-08-01,Customer transfer,250000.00,TRF-001\n2026-08-02,Supplier payment,-87500.00,PAY-002"} /><Button className="mt-3" disabled={busy || !statementText.trim()} onClick={() => void run(() => callAdministration("importBankStatement", { bankAccountId: selectedAccountId, rows: parseStatementRows(statementText), idempotencyKey: crypto.randomUUID() }), "Statement imported; duplicate rows were skipped.")}><Upload className="mr-2 size-4" /> Import statement</Button></details>}

    {selectedAccount && <section className="rounded-xl border bg-white p-5"><h2 className="text-xl font-semibold">3. Match statement to ledger</h2><p className="text-sm text-[var(--muted)]">The app only accepts an equal debit for a deposit or equal credit for a withdrawal, dated within 31 days. Matches remain reversible until the reconciliation is closed.</p><div className="mt-4 space-y-3">{workspace?.statementTransactions.map((transaction) => {
      const candidates = availableLines.filter((line) => transaction.amountMinor > 0 ? line.debitMinor === transaction.amountMinor && line.creditMinor === 0 : line.creditMinor === Math.abs(transaction.amountMinor) && line.debitMinor === 0);
      return <article key={transaction.id} className="grid gap-3 rounded-xl border p-4 lg:grid-cols-[8rem_minmax(0,1fr)_9rem_minmax(14rem,1fr)_auto] lg:items-center"><div className="text-sm">{transaction.transactionDate}</div><div><strong>{transaction.description}</strong><p className="text-xs text-[var(--muted)]">{transaction.reference || "No bank reference"}</p></div><div className={transaction.amountMinor < 0 ? "font-semibold text-red-700" : "font-semibold text-emerald-700"}>{formatNaira(transaction.amountMinor)}</div><div>{transaction.status === "unmatched" ? <select aria-label={`Ledger match for ${transaction.description}`} className="w-full rounded-lg border p-3" value={matches[transaction.id] ?? ""} onChange={(event) => setMatches({ ...matches, [transaction.id]: event.target.value })}><option value="">Select equal ledger line</option>{candidates.map((line) => <option key={line.id} value={line.id}>{line.journalNumber} · {formatNaira(line.debitMinor || line.creditMinor)} · {line.debitMinor ? "deposit" : "withdrawal"}</option>)}</select> : <span className="rounded-full bg-emerald-50 px-3 py-2 text-sm capitalize text-emerald-800">{transaction.status} · {transaction.journalNumber}</span>}</div><div>{transaction.status === "unmatched" && can("banking.reconcile") ? <Button disabled={busy || !matches[transaction.id]} onClick={() => void run(() => callAdministration("matchBankTransaction", { statementTransactionId: transaction.id, journalLineId: matches[transaction.id], idempotencyKey: crypto.randomUUID() }), "Statement transaction matched to the ledger.")}><Link2 className="mr-2 size-4" /> Match</Button> : transaction.status === "matched" && can("banking.reconcile") ? <Button variant="outline" disabled={busy} onClick={() => void run(() => callAdministration("unmatchBankTransaction", { statementTransactionId: transaction.id, idempotencyKey: crypto.randomUUID() }), "Open match removed.")}><Unlink className="mr-2 size-4" /> Unmatch</Button> : null}</div></article>;
    })}{!workspace?.statementTransactions.length && <p className="rounded-lg bg-slate-50 p-6 text-center text-sm text-[var(--muted)]">Import a bank statement to begin matching.</p>}</div></section>}

    {selectedAccount && can("banking.reconcile") && <details open className="rounded-xl border bg-white p-5"><summary className="cursor-pointer text-lg font-semibold">4. Prepare period reconciliation</summary><p className="mt-1 text-sm text-[var(--muted)]">Enter the exact statement opening and closing balances. Preparation succeeds only when every statement row and every bank-ledger line in the period is matched and the difference is ₦0.00.</p><div className="mt-4 grid gap-3 md:grid-cols-4"><label className="text-sm">Period start<input type="date" className="mt-1 w-full rounded-lg border p-3" value={reconciliationForm.periodStart} onChange={(event) => setReconciliationForm({ ...reconciliationForm, periodStart: event.target.value })} /></label><label className="text-sm">Period end<input type="date" className="mt-1 w-full rounded-lg border p-3" value={reconciliationForm.periodEnd} onChange={(event) => setReconciliationForm({ ...reconciliationForm, periodEnd: event.target.value })} /></label><label className="text-sm">Opening balance (₦)<input type="number" step="0.01" className="mt-1 w-full rounded-lg border p-3" value={reconciliationForm.openingBalanceNaira} onChange={(event) => setReconciliationForm({ ...reconciliationForm, openingBalanceNaira: event.target.value })} /></label><label className="text-sm">Closing balance (₦)<input type="number" step="0.01" className="mt-1 w-full rounded-lg border p-3" value={reconciliationForm.closingBalanceNaira} onChange={(event) => setReconciliationForm({ ...reconciliationForm, closingBalanceNaira: event.target.value })} /></label></div><Button className="mt-4" disabled={busy || !reconciliationForm.openingBalanceNaira || !reconciliationForm.closingBalanceNaira} onClick={() => void run(() => callAdministration("prepareBankReconciliation", { bankAccountId: selectedAccountId, periodStart: reconciliationForm.periodStart, periodEnd: reconciliationForm.periodEnd, openingBalanceMinor: signedNairaToKobo(reconciliationForm.openingBalanceNaira), closingBalanceMinor: signedNairaToKobo(reconciliationForm.closingBalanceNaira), notes: reconciliationForm.notes || undefined, idempotencyKey: crypto.randomUUID() }), "Reconciliation prepared for independent completion.")}><CheckCircle2 className="mr-2 size-4" /> Prepare reconciliation</Button></details>}

    {selectedAccount && <section className="rounded-xl border bg-white p-5"><h2 className="text-xl font-semibold">Reconciliation history</h2><div className="mt-4 space-y-3">{workspace?.reconciliations.map((reconciliation) => <article key={reconciliation.id} className="flex flex-col justify-between gap-3 rounded-xl border p-4 md:flex-row md:items-center"><div><strong>{reconciliation.reconciliationNumber}</strong><p className="text-sm text-[var(--muted)]">{reconciliation.periodStart} to {reconciliation.periodEnd} · {reconciliation.statementTransactionCount} statement rows · difference {formatNaira(reconciliation.differenceMinor)}</p><span className="text-sm capitalize">{reconciliation.status}</span></div>{reconciliation.status === "prepared" && reconciliation.preparedBy === user?.uid ? <span className="text-xs text-amber-800">Another authorized user must complete</span> : reconciliation.status === "prepared" && can("banking.approve") ? <Button disabled={busy} onClick={() => void run(() => callAdministration("completeBankReconciliation", { reconciliationId: reconciliation.id, idempotencyKey: crypto.randomUUID() }), `${reconciliation.reconciliationNumber} closed.`)}><CheckCircle2 className="mr-2 size-4" /> Complete independently</Button> : null}</article>)}{!workspace?.reconciliations.length && <p className="text-sm text-[var(--muted)]">No reconciliation periods prepared yet.</p>}</div></section>}
  </div>;
}
