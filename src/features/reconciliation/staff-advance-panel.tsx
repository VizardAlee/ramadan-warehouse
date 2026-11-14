"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AmountInput } from "@/components/ui/amount-input";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/auth-context";
import { callAdministration } from "@/features/administration/api";
import { FinancialActionScope, FinancialInput, FinancialMessage, FinancialText, FinancialValue } from "@/features/finance/financial-privacy";
import { formatNaira } from "@/features/inventory/format";
import { hasPermission } from "@/lib/permissions/roles";

type Advance = { id: string; branchId: string; recipientName: string; recipientType: "staff" | "driver"; purpose: string; issuedMinor: number; retiredMinor: number; returnedMinor: number; outstandingMinor: number; status: "open" | "closed"; issuedAt: string };
type AdvanceEvent = { id: string; kind: string; amountMinor: number; reference: string; reason: string; createdAt: string; journalNumber: string };
type Account = { id: string; bankName: string; accountName: string; accountNumberLast4: string };
type Branch = { id: string; name: string };
type Action = "issue" | "return" | "retire";
const inputClass = "mt-1 block min-h-11 w-full rounded-lg border bg-white p-2.5";
const call = <T,>(input: object) => callAdministration<object, T>("staffAdvances", input);
const message = (cause: unknown) => cause instanceof Error ? cause.message : "Unable to load staff advances. Please retry.";
export function advanceAmountMinor(value: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

export function StaffAdvancePanel() {
  const { profile, operatingContext } = useAuth();
  if (!profile || !hasPermission(profile, "cash.advances.read")) return null;
  return <AdvanceWorkspace key={`${profile.organizationId}:${profile.id}:${operatingContext?.type}:${operatingContext?.id}:${profile.effectivePermissions?.join(",")}`} />;
}

function AdvanceWorkspace() {
  const { profile, operatingContext } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]), [branchCursor, setBranchCursor] = useState<string | null>(null);
  const [branchId, setBranchId] = useState(operatingContext?.type === "branch" ? operatingContext.id : profile?.branchIds[0] ?? "");
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    if (!locked) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [locked]);
  const alive = useRef(true), locationBusy = useRef(false);
  const locations = useCallback(async (cursorId?: string) => {
    if (locationBusy.current) return;
    locationBusy.current = true; setBusy(true); setError(null);
    try {
      const result = await call<{ branches: Branch[]; nextCursorId: string | null }>({ action: "locations", cursorId });
      if (alive.current) { setBranches(previous => cursorId ? [...previous, ...result.branches] : result.branches); setBranchCursor(result.nextCursorId); }
    } catch (cause) { if (alive.current) setError(message(cause)); }
    finally { locationBusy.current = false; if (alive.current) setBusy(false); }
  }, []);
  useEffect(() => { let active = true; alive.current = true; queueMicrotask(() => { if (active) void locations(); }); return () => { active = false; alive.current = false; }; }, [locations]);
  return <section className="space-y-4 rounded-2xl border bg-white p-5" aria-label="Staff and driver advances">
    <header><h2 className="text-xl font-semibold">Staff & driver advances</h2><p className="mt-1 text-sm text-[var(--muted)]">Track money issued, documented spending and unused money returned. These records do not send money through a bank or create a sale.</p></header>
    {error && <p role="alert"><FinancialMessage>{error}</FinancialMessage></p>}
    {locked && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">A money record is pending confirmation. Stay on this page until it is confirmed; do not change the app location or use another menu.</p>}
    <label className="block max-w-md text-sm">Advance store<select className={inputClass} value={branchId} disabled={busy || locked || operatingContext?.type === "branch"} onChange={event => setBranchId(event.target.value)}><option value="">Choose store</option>{branchId && !branches.some(row => row.id === branchId) && <option value={branchId}>Assigned store</option>}{branches.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
    {branchCursor && <Button variant="outline" disabled={busy} onClick={() => void locations(branchCursor)}>Load more stores</Button>}
    {error && <Button variant="outline" disabled={busy} onClick={() => void locations()}>Retry store list</Button>}
    {branchId && <BranchAdvances key={branchId} branchId={branchId} locked={locked} onLock={setLocked} />}
  </section>;
}

function BranchAdvances({ branchId, locked, onLock }: { branchId: string; locked: boolean; onLock: (value: boolean) => void }) {
  const { profile } = useAuth();
  const [rows, setRows] = useState<Advance[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null), [revision, setRevision] = useState(0);
  const [issue, setIssue] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null);
  const alive = useRef(true), sequence = useRef(0);
  const load = useCallback(async (cursorId?: string) => {
    const ticket = ++sequence.current; setLoading(true); setError(null);
    try {
      const result = await call<{ advances: Advance[]; nextCursorId: string | null }>({ action: "workspace", branchId, cursorId });
      if (alive.current && ticket === sequence.current) { setRows(previous => cursorId ? [...previous, ...result.advances] : result.advances); setCursor(result.nextCursorId); }
    } catch (cause) { if (alive.current && ticket === sequence.current) setError(message(cause)); }
    finally { if (alive.current && ticket === sequence.current) setLoading(false); }
  }, [branchId]);
  useEffect(() => { let active = true; alive.current = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; alive.current = false; }; }, [load]);
  function saved(id: string) { onLock(false); setIssue(false); setSelected(id); setRevision(value => value + 1); void load(); }
  return <div className="space-y-4">
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={loading || locked} onClick={() => void load()}>Refresh advances</Button>{profile && hasPermission(profile, "cash.advances.issue") && <Button disabled={locked} onClick={() => { setIssue(true); setSelected(null); }}>Record issued advance</Button>}</div>
    {error && <p role="alert"><FinancialMessage>{error}</FinancialMessage></p>}
    {loading && <p role="status">Loading advances…</p>}
    {!loading && !error && !rows.length && <p>No advances recorded for this store.</p>}
    <div className="grid gap-3 md:grid-cols-2">{rows.map(row => <button key={row.id} type="button" disabled={locked} aria-pressed={selected === row.id} className="rounded-xl border p-4 text-left hover:bg-slate-50" onClick={() => { setSelected(row.id); setIssue(false); }}><strong>{row.recipientName}</strong><p className="text-sm"><FinancialText>{row.purpose}</FinancialText></p><p className="text-sm">{row.status} · Outstanding <FinancialValue>{formatNaira(row.outstandingMinor)}</FinancialValue></p></button>)}</div>
    {cursor && <Button variant="outline" disabled={loading || locked} onClick={() => void load(cursor)}>Load more advances</Button>}
    {issue && <AdvanceForm branchId={branchId} action="issue" onLock={onLock} onSaved={saved} onCancel={() => setIssue(false)} />}
    {selected && <AdvanceDetail key={`${selected}:${revision}`} advanceId={selected} branchId={branchId} locked={locked} onLock={onLock} onSaved={saved} />}
  </div>;
}

function AdvanceDetail({ advanceId, branchId, locked, onLock, onSaved }: { advanceId: string; branchId: string; locked: boolean; onLock: (value: boolean) => void; onSaved: (id: string) => void }) {
  const { profile } = useAuth();
  const [advance, setAdvance] = useState<Advance | null>(null), [events, setEvents] = useState<AdvanceEvent[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const alive = useRef(true), sequence = useRef(0);
  const load = useCallback(async (cursorId?: string) => {
    const ticket = ++sequence.current; setBusy(true); setError(null);
    try { const result = await call<{ advance: Advance; events: AdvanceEvent[]; nextCursorId: string | null }>({ action: "detail", advanceId, cursorId }); if (alive.current && ticket === sequence.current) { setAdvance(result.advance); setEvents(previous => cursorId ? [...previous, ...result.events] : result.events); setCursor(result.nextCursorId); } }
    catch (cause) { if (alive.current && ticket === sequence.current) setError(message(cause)); }
    finally { if (alive.current && ticket === sequence.current) setBusy(false); }
  }, [advanceId]);
  useEffect(() => { let active = true; alive.current = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; alive.current = false; }; }, [load]);
  return <div className="space-y-3 rounded-xl border bg-slate-50 p-4">
    {error && <><p role="alert"><FinancialMessage>{error}</FinancialMessage></p><Button onClick={() => void load()} disabled={busy}>Retry advance details</Button></>}
    {busy && <p role="status">Loading advance details…</p>}
    {advance && <><h3 className="font-semibold">{advance.recipientName} · {advance.recipientType}</h3><p><FinancialText>{advance.purpose}</FinancialText></p><dl className="grid grid-cols-2 gap-2 text-sm">{[["Issued", advance.issuedMinor], ["Documented spending", advance.retiredMinor], ["Returned", advance.returnedMinor], ["Outstanding", advance.outstandingMinor]].map(([label, amount]) => <div key={label}><dt>{label}</dt><dd><FinancialValue>{formatNaira(Number(amount))}</FinancialValue></dd></div>)}</dl>
      {advance.status === "open" && <div className="flex flex-wrap gap-2">{profile && hasPermission(profile, "cash.advances.return") && <Button disabled={locked} onClick={() => setAction("return")}>Record unused money returned</Button>}{profile && hasPermission(profile, "cash.advances.retire") && <Button disabled={locked} variant="outline" onClick={() => setAction("retire")}>Record documented spending</Button>}</div>}
      {action && <AdvanceForm key={action} branchId={branchId} advance={advance} action={action} onLock={onLock} onSaved={onSaved} onCancel={() => setAction(null)} />}
      <h4 className="font-semibold">Recorded history</h4><ol className="space-y-2">{events.map(event => <li key={event.id} className="rounded-lg border bg-white p-3 text-sm"><p>{event.kind} · <FinancialValue>{formatNaira(event.amountMinor)}</FinancialValue> · {new Date(event.createdAt).toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}</p><p><FinancialText>{event.reference} · {event.reason}</FinancialText></p><p>Journal {event.journalNumber}</p></li>)}</ol>{cursor && <Button variant="outline" disabled={busy} onClick={() => void load(cursor)}>Load more history</Button>}
    </>}
  </div>;
}

function AdvanceForm({ branchId, advance, action, onLock, onSaved, onCancel }: { branchId: string; advance?: Advance; action: Action; onLock: (value: boolean) => void; onSaved: (id: string) => void; onCancel: () => void }) {
  const [recipientName, setRecipientName] = useState(""), [recipientType, setRecipientType] = useState<"staff" | "driver">("staff"), [purpose, setPurpose] = useState("");
  const [amount, setAmount] = useState(""), [method, setMethod] = useState<"cash" | "bank_transfer">("cash"), [accountId, setAccountId] = useState("");
  const [reference, setReference] = useState(""), [reason, setReason] = useState(""), [confirmed, setConfirmed] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]), [cursor, setCursor] = useState<string | null>(null), [accountError, setAccountError] = useState<string | null>(null), [accountsBusy, setAccountsBusy] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [uncertain, setUncertain] = useState(false);
  const alive = useRef(true), posting = useRef(false), retry = useRef<{ signature: string; key: string } | null>(null);
  const amountMinor = advanceAmountMinor(amount);
  const valid = amountMinor !== null && (!advance || amountMinor <= advance.outstandingMinor) && reference.trim().length >= 3 && reason.trim().length >= 5 && confirmed && (action !== "issue" || (recipientName.trim().length >= 2 && purpose.trim().length >= 5)) && (action === "retire" || method === "cash" || accounts.some(row => row.id === accountId));
  const loadAccounts = useCallback(async (cursorId?: string) => {
    setAccountsBusy(true); setAccountError(null);
    try { const result = await call<{ accounts: Account[]; nextCursorId: string | null }>({ action: "accounts", branchId, cursorId }); if (alive.current) { setAccounts(previous => cursorId ? [...previous, ...result.accounts] : result.accounts); setCursor(result.nextCursorId); } }
    catch (cause) { if (alive.current) setAccountError(message(cause)); }
    finally { if (alive.current) setAccountsBusy(false); }
  }, [branchId]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active && method === "bank_transfer" && action !== "retire") void loadAccounts(); }); return () => { active = false; }; }, [method, action, loadAccounts]);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!valid || posting.current) return;
    const payload = { action, ...(action === "issue" ? { branchId, recipientName: recipientName.trim(), recipientType, purpose: purpose.trim() } : { advanceId: advance!.id }), amountMinor, ...(action === "retire" ? { receiptReference: reference.trim() } : { method, bankAccountId: method === "bank_transfer" ? accountId : undefined, reference: reference.trim() }), reason: reason.trim() };
    const signature = JSON.stringify(payload); if (retry.current?.signature !== signature) retry.current = { signature, key: crypto.randomUUID() };
    posting.current = true; onLock(true); setBusy(true); setError(null);
    try { const result = await call<{ advanceId: string }>({ ...payload, idempotencyKey: retry.current.key }); if (alive.current) onSaved(result.advanceId); }
    catch (cause) { if (alive.current) {
      const code = cause && typeof cause === "object" && "diagnosticCode" in cause ? String(cause.diagnosticCode) : "";
      const rejected = ["functions/invalid-argument", "functions/permission-denied", "functions/failed-precondition", "functions/not-found"].includes(code);
      setUncertain(!rejected); onLock(!rejected);
      setError(`${message(cause)} ${rejected ? "Nothing was recorded by this attempt. Review the details before trying again." : "Outcome is unconfirmed. Keep this page open and retry these unchanged details; do not create a second record."}`);
    } }
    finally { posting.current = false; if (alive.current) setBusy(false); }
  }
  const title = action === "issue" ? "Record issued advance" : action === "return" ? "Record unused money returned" : "Record documented spending";
  return <FinancialActionScope><form onSubmit={event => void submit(event)} className="space-y-3 rounded-xl border bg-white p-4">
    <h4 className="font-semibold">{title}</h4><p className="text-sm">{action === "retire" ? "Record verified operating expenses against this advance with a receipt reference. Do not use this for stock purchases, a VAT claim, or expenses already posted elsewhere." : action === "return" ? "Only record money actually received back. This reduces the advance balance, not sales or income." : "Only record money already handed or transferred to this person. This is an advance, not an expense yet."}</p>
    {error && <p role="alert"><FinancialMessage>{error}</FinancialMessage></p>}
    <fieldset disabled={busy || uncertain} className="space-y-3">
    {action === "issue" && <><label className="block text-sm">Recipient name<input className={inputClass} maxLength={120} value={recipientName} onChange={event => setRecipientName(event.target.value)} /></label><label className="block text-sm">Recipient type<select className={inputClass} value={recipientType} onChange={event => setRecipientType(event.target.value as "staff" | "driver")}><option value="staff">Staff</option><option value="driver">Driver</option></select></label><label className="block text-sm">Purpose<input className={inputClass} maxLength={500} value={purpose} onChange={event => setPurpose(event.target.value)} /></label></>}
    <label className="block text-sm">Amount (₦)<FinancialInput><AmountInput aria-label="Advance amount (₦)" className={inputClass} value={amount} onValueChange={setAmount} /></FinancialInput></label>
    {amount && amountMinor === null && <p className="text-sm text-red-800">Enter a positive amount with at most two decimal places.</p>}
    {advance && amountMinor !== null && amountMinor > advance.outstandingMinor && <p className="text-sm text-red-800">Amount exceeds the outstanding advance.</p>}
    {action !== "retire" && <><label className="block text-sm">Actual payment method<select className={inputClass} value={method} onChange={event => setMethod(event.target.value as "cash" | "bank_transfer")}><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option></select></label>{method === "bank_transfer" && <><label className="block text-sm">{action === "return" ? "Receiving bank account" : "Paying bank account"}<select className={inputClass} value={accountId} onChange={event => setAccountId(event.target.value)} disabled={accountsBusy}><option value="">Choose the actual account</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.bankName} · {account.accountName} · ending {account.accountNumberLast4}</option>)}</select></label>{accountError && <p role="alert"><FinancialMessage>{accountError}</FinancialMessage></p>}{(cursor || accountError) && <Button type="button" variant="outline" disabled={accountsBusy} onClick={() => void loadAccounts(accountError ? undefined : cursor ?? undefined)}>{accountError ? "Retry account list" : "Load more accounts"}</Button>}</>}</>}
    <label className="block text-sm">{action === "retire" ? "Receipt reference" : "Movement / receipt reference"}<input className={inputClass} maxLength={160} value={reference} onChange={event => setReference(event.target.value)} /></label>
    <label className="block text-sm">Explanation<textarea className={inputClass} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />{action === "retire" ? "I verified the spending evidence and it has not been separately posted as an expense." : "I verified that this money movement has already happened and has not been recorded here."}</label>
    </fieldset>
    <div className="flex gap-2"><Button type="submit" data-financial-retry={uncertain ? "true" : undefined} disabled={!valid || busy}>{busy ? "Recording…" : uncertain ? "Retry same record" : title}</Button><Button type="button" variant="outline" disabled={busy || uncertain} onClick={onCancel}>Cancel</Button></div>
  </form></FinancialActionScope>;
}
