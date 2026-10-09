"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { formatDateTime, formatNaira, nairaToKobo } from "@/features/inventory/format";

interface Account { id: string; code: string; name: string; active: boolean; systemManaged?: boolean }
interface Bank { id: string; accountName: string; bankName: string; ledgerAccountCode: string; active: boolean }
interface Entry { id: string; journalNumber: string; journalType: string; description: string; effectiveAt: string; totalDebitMinor: number; totalCreditMinor: number; reversalJournalEntryId?: string; referenceType?: string; referenceNumber?: string; cashFlowActivity?: string; details?: { reason?: string; originalJournalNumber?: string } }
interface Line { id: string; accountCode: string; accountName: string; debitMinor: number; creditMinor: number }
interface Workspace { entries: Entry[]; accounts: Account[]; bankAccounts: Bank[]; nextCursorId: string | null }
interface DraftLine { accountId: string; debit: string; credit: string; bankAccountId: string }
const blankLine = (): DraftLine => ({ accountId: "", debit: "", credit: "", bankAccountId: "" });
const control = (code: string) => /^(11|12|13|20|21|22|23)\d{2}$/.test(code) || code === "3999";
const fieldClass = "mt-1 w-full rounded-lg border bg-white p-2.5";
function today() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }

export function JournalWorkspace({ branchId, ownerKey, canCreate, canReverse, canManageAccounts }: {
  branchId?: string; ownerKey: string; canCreate: boolean; canReverse: boolean; canManageAccounts: boolean;
}) {
  const [filters, setFilters] = useState({ fromDate: `${today().slice(0, 7)}-01`, toDate: today(), pageSize: 25 });
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null), [loading, setLoading] = useState(false);
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  const [expanded, setExpanded] = useState(""), [detail, setDetail] = useState<{ entry: Entry; lines: Line[]; truncated: boolean } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([blankLine(), blankLine()]);
  const [form, setForm] = useState({ date: "", reference: "", reason: "", purpose: "accountant_adjustment", cashFlowActivity: "operating" });
  const [accountForm, setAccountForm] = useState({ code: "", name: "", active: true, reason: "" });
  const [reverseForm, setReverseForm] = useState({ date: "", reference: "", reason: "", confirmed: false });
  const [pending, setPending] = useState<Record<string, unknown> | null>(null), [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const sequence = useRef(0), detailSequence = useRef(0);
  const storageKey = `abr-pending-journal:${ownerKey}`;
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { const saved = sessionStorage.getItem(storageKey); setPending(saved ? JSON.parse(saved) : null); setReady(true); }
      catch { setError("Saved accounting instructions could not be read. Check the journal register before attempting another posting."); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey]);
  const cursorId = cursors.at(-1);
  const load = useCallback(async () => {
    const current = ++sequence.current;
    setLoading(true); setError("");
    try {
      const result = await callAdministration<object, Workspace>("accountingJournals", { action: "workspace", branchId, ...filters, cursorId });
      if (sequence.current === current) { setWorkspace(result); setExpanded(""); setDetail(null); detailSequence.current++; }
    } catch (cause) { if (sequence.current === current) { setWorkspace(null); setError(cause instanceof Error ? cause.message : "Journals could not be loaded."); } }
    finally { if (sequence.current === current) setLoading(false); }
  }, [branchId, filters, cursorId]);
  const invalidate = useCallback(() => { sequence.current++; detailSequence.current++; }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 200); return () => { window.clearTimeout(timer); invalidate(); }; }, [load, invalidate]);
  function changeFilters(change: Partial<typeof filters>) { setCursors([undefined]); setFilters({ ...filters, ...change }); }
  async function expand(id: string) {
    const current = ++detailSequence.current;
    if (expanded === id) { setExpanded(""); setDetail(null); return; }
    setExpanded(id); setDetail(null); setDetailLoading(true); setError("");
    setReverseForm({ date: "", reference: "", reason: "", confirmed: false });
    try { const result = await callAdministration<object, { entry: Entry; lines: Line[]; truncated: boolean }>("accountingJournals", { action: "detail", journalEntryId: id }); if (detailSequence.current === current) setDetail(result); }
    catch (cause) { if (detailSequence.current === current) setError(cause instanceof Error ? cause.message : "Journal detail could not be loaded."); }
    finally { if (detailSequence.current === current) setDetailLoading(false); }
  }
  async function mutate(instructions?: Record<string, unknown>) {
    const retry = pending;
    if (!navigator.onLine) { setError("Reconnect before posting or checking accounting instructions."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const input = retry ?? { ...instructions, idempotencyKey: crypto.randomUUID() };
      sessionStorage.setItem(storageKey, JSON.stringify(input)); setPending(input);
      const result = await callAdministration<object, { journalNumber?: string; saved?: boolean }>("accountingJournals", input);
      sessionStorage.removeItem(storageKey); setPending(null);
      setMessage(result.saved ? "Ledger account saved. Existing postings remain unchanged." : `${result.journalNumber} posted. The original history remains available.`);
      setLines([blankLine(), blankLine()]); setForm({ date: "", reference: "", reason: "", purpose: "accountant_adjustment", cashFlowActivity: "operating" });
      setAccountForm({ code: "", name: "", active: true, reason: "" }); await load();
    } catch (cause) {
      const diagnostic = cause as { diagnosticCode?: string; code?: string };
      if (!retry && ["functions/invalid-argument", "functions/permission-denied", "functions/failed-precondition", "ACCOUNTING_PERIOD_LOCKED"].includes(diagnostic.diagnosticCode ?? diagnostic.code ?? "")) {
        sessionStorage.removeItem(storageKey); setPending(null);
      }
      setError(cause instanceof Error ? cause.message : "The accounting result could not be confirmed. Retry the saved instructions.");
    } finally { setBusy(false); }
  }
  function post() {
    try { void mutate({ action: "post", branchId, effectiveAt: new Date(form.date).toISOString(), reference: form.reference, reason: form.reason,
      purpose: form.purpose, cashFlowActivity: form.cashFlowActivity,
      lines: lines.map(line => ({ accountId: line.accountId, debitMinor: nairaToKobo(Number(line.debit || 0)), creditMinor: nairaToKobo(Number(line.credit || 0)), ...(line.bankAccountId ? { bankAccountId: line.bankAccountId } : {}) })) }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Check the journal date and amounts."); }
  }
  function reverse() {
    try { void mutate({ action: "reverse", branchId, journalEntryId: expanded, effectiveAt: new Date(reverseForm.date).toISOString(), reference: reverseForm.reference, reason: reverseForm.reason }); }
    catch { setError("Enter a valid reversal date."); }
  }
  const locked = busy || !ready || Boolean(pending), accounts = workspace?.accounts ?? [];
  const debits = lines.reduce((sum, line) => sum + Number(line.debit || 0), 0), credits = lines.reduce((sum, line) => sum + Number(line.credit || 0), 0);
  return <section className="space-y-4" aria-label="Journal entries">
    <header><h2 className="text-xl font-semibold">Journal entries & ledger accounts</h2><p className="text-sm text-[var(--muted)]">Business activities generate journals automatically. Accountant adjustments are separate, balanced postings; never overwrite a sale, payment or stock entry.</p></header>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
    {message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-emerald-800">{message}</p>}
    {pending && <div className="rounded-lg border border-amber-300 bg-amber-50 p-3"><p>Unconfirmed accounting instructions: {String(pending.action)} · {String(pending.reference ?? pending.code ?? "")}. Retry the exact saved request before starting another.</p><Button disabled={busy || !ready} onClick={() => void mutate()}>Retry saved accounting instructions</Button></div>}
    <div className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-3">
      <label className="text-sm">From date<input className={fieldClass} type="date" value={filters.fromDate} onChange={event => changeFilters({ fromDate: event.target.value })} /></label>
      <label className="text-sm">To date<input className={fieldClass} type="date" value={filters.toDate} onChange={event => changeFilters({ toDate: event.target.value })} /></label>
      <label className="text-sm">Rows per page<select className={fieldClass} value={filters.pageSize} onChange={event => changeFilters({ pageSize: Number(event.target.value) })}>{[25, 50, 100].map(value => <option key={value}>{value}</option>)}</select></label>
    </div>
    <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-left text-sm"><thead><tr className="border-b bg-slate-50">{["Date", "Journal / reference", "Description", "Debit", "Credit", ""].map((label, index) => <th key={index} className="p-3">{label}</th>)}</tr></thead><tbody>
      {workspace?.entries.map(entry => <JournalRows key={entry.id} entry={entry} expanded={expanded === entry.id} onExpand={() => void expand(entry.id)}>
        {detailLoading ? <p>Loading journal lines…</p> : detail?.entry.id === entry.id && <div className="space-y-3">
          <p>{detail.entry.details?.reason ?? "Automatically generated from the linked business transaction."} {detail.entry.details?.originalJournalNumber && `Reverses ${detail.entry.details.originalJournalNumber}.`}</p>
          <table className="w-full text-sm"><thead><tr><th className="p-2 text-left">Account</th><th className="p-2 text-right">Debit</th><th className="p-2 text-right">Credit</th></tr></thead><tbody>{detail.lines.map(line => <tr key={line.id} className="border-t"><td className="p-2">{line.accountCode} · {line.accountName}</td><td className="p-2 text-right">{formatNaira(line.debitMinor)}</td><td className="p-2 text-right">{formatNaira(line.creditMinor)}</td></tr>)}</tbody></table>
          {detail.truncated && <p className="text-amber-900">Only the first 200 lines are shown. This journal needs an accountant’s detailed ledger export.</p>}
          {canReverse && detail.entry.journalType === "manual_adjustment" && !detail.entry.reversalJournalEntryId && <details><summary className="cursor-pointer font-semibold">Reverse this manual journal</summary><fieldset disabled={locked || !branchId} className="mt-3 grid gap-3 sm:grid-cols-3">
            <label>Reversal date<input className={fieldClass} type="datetime-local" value={reverseForm.date} onChange={event => setReverseForm({ ...reverseForm, date: event.target.value })} /></label>
            <label>Reference<input className={fieldClass} value={reverseForm.reference} onChange={event => setReverseForm({ ...reverseForm, reference: event.target.value })} /></label>
            <label>Reason<input className={fieldClass} value={reverseForm.reason} onChange={event => setReverseForm({ ...reverseForm, reason: event.target.value })} /></label>
            <label className="flex gap-2 sm:col-span-3"><input type="checkbox" checked={reverseForm.confirmed} onChange={event => setReverseForm({ ...reverseForm, confirmed: event.target.checked })} />Post an opposite journal; preserve the original history.</label>
            <Button disabled={!reverseForm.confirmed || !reverseForm.date || reverseForm.reference.trim().length < 2 || reverseForm.reason.trim().length < 5} onClick={reverse}>Post reversal</Button>
          </fieldset></details>}
        </div>}
      </JournalRows>)}
      {!workspace?.entries.length && <tr><td colSpan={6} className="p-5 text-center">{loading ? "Loading journals…" : error ? "Journal data is unavailable." : "No journals in this period."}</td></tr>}
    </tbody></table></div>
    <div className="flex flex-wrap items-center justify-between gap-3"><Button variant="outline" disabled={loading || cursors.length < 2} onClick={() => setCursors(cursors.slice(0, -1))}>Previous</Button><span>Page {cursors.length}{loading ? " · Refreshing…" : ""}</span><Button variant="outline" disabled={loading || !workspace?.nextCursorId} onClick={() => setCursors([...cursors, workspace!.nextCursorId!])}>Next</Button></div>
    {canCreate && <details className="rounded-xl border bg-white p-4"><summary className="cursor-pointer font-semibold">Post an accountant adjustment</summary>
      <p className="my-3 text-sm text-[var(--muted)]">Use for opening balances, accruals, depreciation or accountant adjustments. Customer/supplier debt, inventory and tax balances must use their operational workflow. Choose the responsible store above.</p>
      <fieldset disabled={locked || !branchId || !workspace} className="space-y-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label>Date<input className={fieldClass} type="datetime-local" value={form.date} onChange={event => setForm({ ...form, date: event.target.value })} /></label>
        <label>Reference<input className={fieldClass} maxLength={160} value={form.reference} onChange={event => setForm({ ...form, reference: event.target.value })} /></label>
        <label>Reason<input className={fieldClass} maxLength={500} value={form.reason} onChange={event => setForm({ ...form, reason: event.target.value })} /></label>
        <label>Purpose<select className={fieldClass} value={form.purpose} onChange={event => setForm({ ...form, purpose: event.target.value })}>{["opening_balance", "accrual", "depreciation", "year_end", "accountant_adjustment"].map(value => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
        <label>Cash-flow classification<select className={fieldClass} value={form.cashFlowActivity} onChange={event => setForm({ ...form, cashFlowActivity: event.target.value })}><option value="operating">Operating</option><option value="investing">Investing</option><option value="financing">Financing</option></select></label>
      </div>
      {lines.map((line, index) => { const code = accounts.find(account => account.id === line.accountId)?.code ?? ""; const update = (change: Partial<DraftLine>) => setLines(lines.map((current, i) => i === index ? { ...current, ...change } : current)); return <div key={index} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-4">
        <label>Ledger account<select className={fieldClass} value={line.accountId} onChange={event => update({ accountId: event.target.value, bankAccountId: "" })}><option value="">Choose account</option>{accounts.filter(account => account.active && !control(account.code)).map(account => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label>
        <label>Debit (₦)<input className={fieldClass} type="number" min="0" step="0.01" value={line.debit} onChange={event => update({ debit: event.target.value })} /></label>
        <label>Credit (₦)<input className={fieldClass} type="number" min="0" step="0.01" value={line.credit} onChange={event => update({ credit: event.target.value })} /></label>
        {/^10\d{2}$/.test(code) && code !== "1010" ? <label>Company financial account<select className={fieldClass} value={line.bankAccountId} onChange={event => update({ bankAccountId: event.target.value })}><option value="">Choose account</option>{workspace?.bankAccounts.filter(bank => bank.active && bank.ledgerAccountCode === code).map(bank => <option key={bank.id} value={bank.id}>{bank.bankName} · {bank.accountName}</option>)}</select></label> : <Button variant="outline" disabled={lines.length < 3} onClick={() => setLines(lines.filter((_, i) => i !== index))}>Remove line {index + 1}</Button>}
      </div>; })}
      <div className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={lines.length >= 40} onClick={() => setLines([...lines, blankLine()])}>Add line</Button><span>Debit ₦{debits.toLocaleString()} · Credit ₦{credits.toLocaleString()}</span><Button disabled={!form.date || form.reference.trim().length < 2 || form.reason.trim().length < 5 || !debits || Math.abs(debits - credits) > .001 || lines.some(line => !line.accountId)} onClick={post}>Post balanced journal</Button></div>
      </fieldset>
    </details>}
    {canManageAccounts && <details className="rounded-xl border bg-white p-4"><summary className="cursor-pointer font-semibold">Create or edit an accountant ledger account</summary><p className="my-3 text-sm text-[var(--muted)]">Enter an existing non-system account code to edit it. Deactivation prevents new postings; historical lines are retained. Banking and operational control codes are managed elsewhere.</p><fieldset disabled={locked || !workspace} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label>Account code<input className={fieldClass} value={accountForm.code} maxLength={4} onChange={event => { const code = event.target.value, existing = accounts.find(account => account.code === code); setAccountForm({ ...accountForm, code, name: existing?.name ?? "", active: existing?.active ?? true }); }} /></label>
      <label>Account name<input className={fieldClass} value={accountForm.name} maxLength={160} onChange={event => setAccountForm({ ...accountForm, name: event.target.value })} /></label>
      <label>Reason<input className={fieldClass} value={accountForm.reason} maxLength={500} onChange={event => setAccountForm({ ...accountForm, reason: event.target.value })} /></label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={accountForm.active} onChange={event => setAccountForm({ ...accountForm, active: event.target.checked })} />Active for new postings</label>
      <Button disabled={!/^[1-9]\d{3}$/.test(accountForm.code) || accountForm.name.trim().length < 2 || accountForm.reason.trim().length < 5} onClick={() => void mutate({ action: "save_account", ...accountForm })}>Save ledger account</Button>
    </fieldset></details>}
  </section>;
}

function JournalRows({ entry, expanded, onExpand, children }: { entry: Entry; expanded: boolean; onExpand(): void; children: React.ReactNode }) {
  return <><tr className="border-b"><td className="p-3 whitespace-nowrap">{formatDateTime(entry.effectiveAt)}</td><td className="p-3"><strong>{entry.journalNumber}</strong><span className="block text-xs text-[var(--muted)]">{entry.referenceNumber}</span></td><td className="p-3">{entry.description}<span className="block text-xs text-[var(--muted)]">{entry.journalType.replaceAll("_", " ")}{entry.reversalJournalEntryId ? " · Reversed by a linked journal" : ""}</span></td><td className="p-3 whitespace-nowrap">{formatNaira(entry.totalDebitMinor)}</td><td className="p-3 whitespace-nowrap">{formatNaira(entry.totalCreditMinor)}</td><td className="p-3"><button className="text-[var(--brand)] underline" aria-expanded={expanded} onClick={onExpand}>{expanded ? "Hide lines" : "View lines"}</button></td></tr>{expanded && <tr className="border-b bg-slate-50"><td colSpan={6} className="p-4">{children}</td></tr>}</>;
}
