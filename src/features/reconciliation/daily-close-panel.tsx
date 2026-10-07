"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/auth-context";
import { callAdministration } from "@/features/administration/api";
import { formatNaira } from "@/features/inventory/format";
import { hasPermission } from "@/lib/permissions/roles";
import type { dailyEvidence } from "../../../functions/src/accounting/daily-close";

type Evidence = Awaited<ReturnType<typeof dailyEvidence>>;
interface Workspace {
  branchId: string;
  date: string;
  branchName: string;
  evidence: Evidence;
  close: null | { id: string; version: number; status: "prepared" | "signed"; countedCashMinor: number; varianceMinor: number; explanation: string; preparedBy: string; signedBy?: string; evidence: Evidence };
}
function businessDate() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }

export function DailyClosePanel() {
  const { profile, operatingContext } = useAuth();
  const allowed = Boolean(profile && hasPermission(profile, "daily.close.read"));
  const [selectedBranch, setSelectedBranch] = useState("");
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [locationCursor, setLocationCursor] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locationsBusy, setLocationsBusy] = useState(false);
  const locationScope = useRef(0);
  const loadLocations = useCallback(async (cursor?: string) => {
    if (!allowed) return;
    const current = locationScope.current;
    setLocationsBusy(true); setLocationError(null);
    try {
      const result = await callAdministration<object, { rows: Array<{ id: string; name: string }>; nextCursor: string | null }>("getDailyCloseWorkspace", { action: "locations", cursor });
      if (current !== locationScope.current) return;
      setBranches((previous) => cursor ? [...previous, ...result.rows] : result.rows); setLocationCursor(result.nextCursor);
    } catch (cause) { if (current === locationScope.current) setLocationError(cause instanceof Error ? cause.message : "Unable to load assigned stores."); }
    finally { if (current === locationScope.current) setLocationsBusy(false); }
  }, [allowed]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) { setSelectedBranch(""); setBranches([]); void loadLocations(); } }); return () => { active = false; locationScope.current += 1; }; }, [loadLocations, operatingContext?.id, profile?.organizationId]);
  const branchId = selectedBranch || (operatingContext?.type === "branch" ? operatingContext.id : profile?.branchIds[0]) || "";
  const [date, setDate] = useState(businessDate);
  const [loadedWorkspace, setWorkspace] = useState<Workspace | null>(null);
  const workspace = loadedWorkspace?.branchId === branchId && loadedWorkspace.date === date ? loadedWorkspace : null;
  const [cash, setCash] = useState("");
  const [explanation, setExplanation] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const sequence = useRef(0);
  const retry = useRef<{ payload: string; key: string } | null>(null);
  const load = useCallback(async () => {
    const current = ++sequence.current;
    setWorkspace(null); setError(null);
    if (!allowed || !branchId) { setLoading(false); return; }
    setLoading(true);
    try {
      const result = await callAdministration<object, Workspace>("getDailyCloseWorkspace", { branchId, date });
      if (current !== sequence.current) return;
      setWorkspace(result);
      setCash(result.close ? (result.close.countedCashMinor / 100).toFixed(2) : "");
      setExplanation(result.close?.explanation ?? "");
      setNotes("");
    } catch (cause) { if (current === sequence.current) setError(cause instanceof Error ? cause.message : "Unable to load daily close."); }
    finally { if (current === sequence.current) setLoading(false); }
  }, [allowed, branchId, date]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; sequence.current += 1; }; }, [load]);
  if (!allowed) return null;
  const countedCashMinor = Math.round(Number(cash) * 100);
  const validCash = /^\d+(\.\d{1,2})?$/.test(cash) && Number.isSafeInteger(countedCashMinor);
  const variance = workspace && validCash ? countedCashMinor - workspace.evidence.cash.closingMinor : null;
  const changed = Boolean(workspace?.close && workspace.close.evidence.hash !== workspace.evidence.hash);
  const locked = workspace?.close?.status === "signed" && !changed;
  const unsaved = Boolean(workspace?.close && (countedCashMinor !== workspace.close.countedCashMinor || explanation.trim() !== workspace.close.explanation));
  async function mutate(name: "prepareDailyClose" | "signDailyClose") {
    if (!workspace || busy) return;
    if (name === "prepareDailyClose" && (variance !== 0 || workspace.evidence.exceptions.length || workspace.close?.status === "signed") && explanation.trim().length < 5) {
      setError("Explain the cash difference, incomplete checks or revision after sign-off before preparing this close."); return;
    }
    if (name === "signDailyClose" && unsaved) { setError("Prepare your changed cash count or explanation before signing this revision."); return; }
    setBusy(true); setError(null);
    const data = name === "prepareDailyClose"
      ? { branchId, date, countedCashMinor, explanation, evidenceHash: workspace.evidence.hash }
      : { branchId, date, version: workspace.close?.version, notes };
    const payload = JSON.stringify({ name, data });
    if (retry.current?.payload !== payload) retry.current = { payload, key: crypto.randomUUID() };
    try {
      await callAdministration(name, { ...data, idempotencyKey: retry.current.key });
      retry.current = null;
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Daily close could not be saved."); }
    finally { setBusy(false); }
  }
  return <section className="surface p-5 sm:p-6" aria-labelledby="daily-close-heading">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="daily-close-heading" className="text-xl font-semibold">Store daily close</h2><p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">Compare all posted store cash with what you counted. Stock counts and shift checks are linked automatically. Dates use Nigerian time.</p></div>
      <Button variant="outline" disabled={busy || loading || !branchId} onClick={() => void load()}>Refresh evidence</Button>
    </div>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <label className="grid gap-1 text-sm">Store<select className="form-input" value={branchId} disabled={busy} onChange={(event) => setSelectedBranch(event.target.value)}><option value="">Select store</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
      <label className="grid gap-1 text-sm">Business date<input className="form-input" type="date" max={businessDate()} value={date} disabled={busy} onChange={(event) => { if (event.target.value) setDate(event.target.value); }} /></label>
    </div>
    {locationError && <p className="mt-3 text-sm text-red-800" role="alert">{locationError} <button className="underline" onClick={() => void loadLocations()}>Retry store list</button></p>}
    {locationCursor && <Button className="mt-3" variant="outline" disabled={locationsBusy} onClick={() => void loadLocations(locationCursor)}>Load more stores</Button>}
    {loading && <p className="mt-4" role="status">Reading ledger and check evidence…</p>}
    {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-red-800" role="alert">{error}</p>}
    {workspace && <>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {([ ["Opening posted cash", workspace.evidence.cash.openingMinor], ["All cash received", workspace.evidence.cash.receiptsMinor], ["All cash paid out", workspace.evidence.cash.paymentsMinor], ["Expected cash on hand", workspace.evidence.cash.closingMinor] ] as const).map(([label, value], index) => <div className="rounded-xl border p-3" key={label}><p className="text-xs text-[var(--muted)]">{label}</p><p className={`mt-1 text-lg font-semibold ${index === 1 ? "text-emerald-700" : index === 2 ? "text-red-700" : "text-[var(--brand)]"}`}>{formatNaira(value)}</p></div>)}
      </div>
      <p className="mt-3 text-xs text-[var(--muted)]">Includes posted customer receipts, supplier payments, expenses, refunds and other cash journals in this store (account 1010). POS opening floats are not additional income. Bank balances are checked separately below.</p>
      <div className="mt-4 rounded-xl border p-4 text-sm">
        <h3 className="font-semibold">Stock and till evidence</h3>
        <p className="mt-1">{workspace.evidence.closedShiftCount} closed shift(s) · {workspace.evidence.openShiftCount} unclosed shift(s) · Till variance: {formatNaira(workspace.evidence.tillVarianceMinor)}</p>
        {workspace.evidence.stockCounts.map((count) => <p key={count.id} className="mt-1">{count.reference} — {count.status === "posted" ? "Completed" : count.status.replaceAll("_", " ")}</p>)}
        {workspace.evidence.exceptions.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-amber-800">{workspace.evidence.exceptions.map((exception) => <li key={exception}>{exception}</li>)}</ul>}
      </div>
      {changed && <p role="status" className="mt-4 rounded-lg bg-amber-50 p-3 text-amber-900">New or changed postings/checks were found after preparation or sign-off. Review the current evidence and prepare a new revision. Previous signed evidence is retained.</p>}
      {workspace.close && <p className="mt-4 text-sm font-semibold">Revision {workspace.close.version} · {workspace.close.status === "signed" ? "Signed off" : "Prepared — ready for sign-off"}</p>}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">Physical store cash counted (₦)<input className="form-input" inputMode="decimal" value={cash} disabled={busy || locked || !hasPermission(profile!, "daily.close.prepare")} onChange={(event) => setCash(event.target.value)} placeholder="0.00" /></label>
        <div><p className="text-sm">Difference from posted cash</p><p className={`mt-2 text-xl font-semibold ${variance ? "text-amber-700" : "text-emerald-700"}`}>{variance === null ? "Enter the cash counted" : formatNaira(variance)}</p></div>
      </div>
      <label className="mt-4 grid gap-1 text-sm">Variance / exception explanation<textarea className="form-input min-h-24" maxLength={1000} value={explanation} disabled={busy || locked || !hasPermission(profile!, "daily.close.prepare")} onChange={(event) => setExplanation(event.target.value)} placeholder="Explain cash differences, incomplete checks or a revision after sign-off." /></label>
      {!locked && hasPermission(profile!, "daily.close.prepare") && <Button className="mt-3" disabled={busy || !validCash} onClick={() => void mutate("prepareDailyClose")}>Prepare daily close</Button>}
      {workspace.close?.status === "prepared" && !changed && hasPermission(profile!, "daily.close.approve") && <div className="mt-4 border-t pt-4"><label className="grid gap-1 text-sm">Sign-off notes<textarea className="form-input" maxLength={1000} value={notes} disabled={busy} onChange={(event) => setNotes(event.target.value)} /></label>{unsaved && <p className="mt-2 text-sm text-amber-800">Prepare your changed cash count or explanation before sign-off.</p>}<Button className="mt-3" disabled={busy || unsaved} onClick={() => void mutate("signDailyClose")}>Sign off this revision</Button></div>}
      <p className="mt-4 text-xs text-[var(--muted)]">Sign-off records an evidence snapshot, not an accounting lock or stock adjustment. Later/backdated postings are flagged for a new revision. The same authorized manager may prepare and sign; both actions remain audited.</p>
    </>}
  </section>;
}
