"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { formatDateTime, formatNaira, nairaToKobo } from "@/features/inventory/format";

interface Account { id: string; code: string; name: string; active: boolean }
interface Budget { id: string; accountId: string; accountCode: string; accountName: string; amountMinor: number; version: number; actualMinor: number; varianceMinor: number; variancePercent: number | null; favorable: boolean; kind: string }
interface Workspace { rows: Budget[]; accounts: Account[]; nextCursorId: string | null }
interface Revision { id: string; version: number; amountMinor: number; reason: string; updatedByName: string; createdAt: string }
const field = "mt-1 w-full rounded-lg border bg-white p-2.5";
const currentMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);

export function BudgetWorkspace({ ownerKey, branchId, canManage }: { ownerKey: string; branchId?: string; canManage: boolean }) {
  const [month, setMonth] = useState(currentMonth), [pageSize, setPageSize] = useState(25), [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [data, setData] = useState<Workspace | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [form, setForm] = useState({ accountId: "", amount: "", expectedVersion: 0, reason: "" });
  const [pending, setPending] = useState<Record<string, unknown> | null>(null), [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(""), [history, setHistory] = useState<{ revisions: Revision[]; nextCursorId: string | null } | null>(null), [historyBusy, setHistoryBusy] = useState(false);
  const sequence = useRef(0), historySequence = useRef(0), storageKey = `abr-pending-budget:${ownerKey}`, cursorId = cursors.at(-1);
  useEffect(() => { const timer = window.setTimeout(() => {
    try { const saved = sessionStorage.getItem(storageKey); setPending(saved ? JSON.parse(saved) : null); setReady(true); }
    catch { setError("Saved budget instructions could not be read. Review the register before saving again."); }
  }, 0); return () => window.clearTimeout(timer); }, [storageKey]);
  const load = useCallback(async () => {
    const current = ++sequence.current; setLoading(true); setError("");
    try { const result = await callAdministration<object, Workspace>("budgetWorkspace", { action: "workspace", month, branchId, pageSize, cursorId });
      if (current === sequence.current) { setData(result); setExpanded(""); setHistory(null); historySequence.current++; }
    } catch (cause) { if (current === sequence.current) { setData(null); setError(cause instanceof Error ? cause.message : "Budgets could not be loaded."); } }
    finally { if (current === sequence.current) setLoading(false); }
  }, [month, branchId, pageSize, cursorId]);
  const invalidate = useCallback(() => { sequence.current++; historySequence.current++; }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 200); return () => { window.clearTimeout(timer); invalidate(); }; }, [load, invalidate]);
  async function save() {
    if (!navigator.onLine) { setError("Reconnect before saving or checking budget instructions."); return; }
    const retry = pending; setBusy(true); setError(""); setMessage("");
    try {
      const input = retry ?? { action: "save", month, branchId, accountId: form.accountId, amountMinor: nairaToKobo(Number(form.amount)), expectedVersion: form.expectedVersion, reason: form.reason, idempotencyKey: crypto.randomUUID() };
      sessionStorage.setItem(storageKey, JSON.stringify(input)); setPending(input);
      await callAdministration("budgetWorkspace", input);
      sessionStorage.removeItem(storageKey); setPending(null); setForm({ accountId: "", amount: "", expectedVersion: 0, reason: "" });
      setMessage("Budget saved. Previous versions remain available; no accounting journal was posted."); await load();
    } catch (cause) {
      const diagnostic = cause as { diagnosticCode?: string; code?: string };
      if (!retry && ["functions/invalid-argument", "functions/permission-denied", "functions/failed-precondition"].includes(diagnostic.diagnosticCode ?? diagnostic.code ?? "")) { sessionStorage.removeItem(storageKey); setPending(null); }
      setError(cause instanceof Error ? cause.message : "The result is uncertain. Retry the saved budget instructions.");
    } finally { setBusy(false); }
  }
  async function viewHistory(id: string, cursor?: string) {
    const current = ++historySequence.current;
    if (expanded === id && !cursor) { setExpanded(""); setHistory(null); return; }
    setExpanded(id); setHistoryBusy(true);
    if (!cursor) setHistory(null);
    try { const result = await callAdministration<object, { revisions: Revision[]; nextCursorId: string | null }>("budgetWorkspace", { action: "history", budgetId: id, cursorId: cursor });
      if (current === historySequence.current) setHistory(result);
    } catch (cause) { if (current === historySequence.current) setError(cause instanceof Error ? cause.message : "Budget history could not be loaded."); }
    finally { if (current === historySequence.current) setHistoryBusy(false); }
  }
  const locked = busy || !!pending || !ready;
  return <section className="space-y-4" aria-label="Budgets versus actuals">
    <header><h2 className="text-2xl font-semibold">Budgets versus actuals</h2><p className="text-sm text-[var(--muted)]">Monthly income and expense targets compared with posted journals, using Nigerian business dates. {branchId ? "Selected store only." : "Consolidated organization targets; store budgets are not added a second time."} Only accounts with a saved target appear here. Actuals are not cash balances or tax assessments.</p></header>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}{message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-emerald-800">{message}</p>}
    {pending && <div className="rounded-lg border bg-amber-50 p-3"><p>A budget result is unconfirmed. Retry the original instructions before making another change.</p><Button disabled={busy || !ready} onClick={() => void save()}>Retry saved budget instructions</Button></div>}
    <div className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-3">
      <label>Budget month<input className={field} type="month" value={month} disabled={locked} onChange={event => { setMonth(event.target.value); setCursors([undefined]); setForm({ accountId: "", amount: "", expectedVersion: 0, reason: "" }); }} /></label>
      <label>Rows per page<select className={field} value={pageSize} disabled={locked} onChange={event => { setPageSize(Number(event.target.value)); setCursors([undefined]); }}>{[25, 50, 100].map(size => <option key={size}>{size}</option>)}</select></label>
      <Button variant="outline" disabled={loading || busy} onClick={() => void load()}>Refresh actuals</Button>
    </div>
    <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-left text-sm"><thead><tr>{["Account", "Budget", "Actual", "Favorable / (unfavorable)", "Variance %", "Actions"].map(label => <th className="p-3" key={label}>{label}</th>)}</tr></thead><tbody>
      {data?.rows.map(budget => <BudgetRows key={budget.id} budget={budget} expanded={expanded === budget.id} canManage={canManage} locked={locked || loading} edit={() => setForm({ accountId: budget.accountId, amount: String(budget.amountMinor / 100), expectedVersion: budget.version, reason: "" })} expand={() => void viewHistory(budget.id)}>
        {historyBusy ? <p>Loading revision history…</p> : <><ol className="space-y-2">{history?.revisions.map(revision => <li key={revision.id} className="rounded-lg border bg-white p-3"><strong>Version {revision.version} · {formatNaira(revision.amountMinor)}</strong><p>{revision.reason}</p><small>{formatDateTime(revision.createdAt)} · {revision.updatedByName}</small></li>)}</ol>{history?.nextCursorId && <Button disabled={historyBusy} variant="outline" onClick={() => void viewHistory(budget.id, history.nextCursorId!)}>Next 25 revisions</Button>}</>}
      </BudgetRows>)}
      {!data?.rows.length && <tr><td colSpan={6} className="p-5 text-center">{loading ? "Loading budget comparisons…" : error ? "Budget data is unavailable." : "No targets saved for this month and scope."}</td></tr>}
    </tbody></table></div>
    <div className="flex flex-wrap justify-between gap-3"><Button variant="outline" disabled={loading || locked || cursors.length < 2} onClick={() => setCursors(cursors.slice(0, -1))}>Previous</Button><span>Page {cursors.length}{loading ? " · Refreshing…" : ""}</span><Button variant="outline" disabled={loading || locked || !data?.nextCursorId} onClick={() => setCursors([...cursors, data!.nextCursorId!])}>Next</Button></div>
    {canManage && <details className="rounded-xl border bg-white p-4" open><summary className="cursor-pointer font-semibold">Create or revise a monthly target</summary><p className="my-3 text-sm text-[var(--muted)]">Targets are not accounting postings. To revise an existing target, choose Revise in its row. Saving a changed target preserves the old version and your reason. Positive variance is favorable: higher income or lower expenses.</p>
      <fieldset disabled={locked || loading || !data} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label>Income or expense account<select className={field} value={form.accountId} disabled={form.expectedVersion > 0} onChange={event => { const existing = data?.rows.find(row => row.accountId === event.target.value); setForm({ ...form, accountId: event.target.value, amount: existing ? String(existing.amountMinor / 100) : "", expectedVersion: existing?.version ?? 0 }); }}><option value="">Choose ledger account</option>{data?.accounts.filter(account => account.active).map(account => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label>
        <label>Budget amount (₦)<input className={field} type="number" min="0" step="0.01" value={form.amount} onChange={event => setForm({ ...form, amount: event.target.value })} /></label>
        <label className="sm:col-span-2">Reason<input className={field} maxLength={1000} value={form.reason} onChange={event => setForm({ ...form, reason: event.target.value })} /></label>
        <Button disabled={!form.accountId || !form.amount || !Number.isFinite(Number(form.amount)) || Number(form.amount) < 0 || form.reason.trim().length < 10} onClick={() => void save()}>Save budget target</Button>
        <Button variant="outline" onClick={() => setForm({ accountId: "", amount: "", expectedVersion: 0, reason: "" })}>Clear form</Button>
      </fieldset>
    </details>}
  </section>;
}
function BudgetRows({ budget, expanded, canManage, locked, edit, expand, children }: { budget: Budget; expanded: boolean; canManage: boolean; locked: boolean; edit(): void; expand(): void; children: React.ReactNode }) {
  return <><tr className="border-t"><td className="p-3"><strong>{budget.accountCode} · {budget.accountName}</strong><small className="block">{budget.kind} · Version {budget.version}</small></td><td className="whitespace-nowrap p-3">{formatNaira(budget.amountMinor)}</td><td className="whitespace-nowrap p-3">{formatNaira(budget.actualMinor)}</td><td className={`whitespace-nowrap p-3 ${budget.favorable ? "text-emerald-700" : "text-red-700"}`}>{formatNaira(budget.varianceMinor)}<small className="block">{budget.favorable ? "Favorable" : "Unfavorable"}</small></td><td className="p-3">{budget.variancePercent === null ? "Not applicable (zero target)" : `${budget.variancePercent.toFixed(1)}%`}</td><td className="p-3"><div className="flex flex-wrap gap-3"><button disabled={locked} className="text-[var(--brand)] underline" aria-expanded={expanded} onClick={expand}>{expanded ? "Hide revisions" : "View revisions"}</button>{canManage && <button disabled={locked} className="text-[var(--brand)] underline" onClick={edit}>Revise</button>}</div></td></tr>{expanded && <tr className="border-t bg-slate-50"><td colSpan={6} className="p-4">{children}</td></tr>}</>;
}
