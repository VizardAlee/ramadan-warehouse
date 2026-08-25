"use client";

import { CheckCircle2, Download, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { useAuth } from "@/features/auth/auth-context";
import { formatNaira } from "@/features/inventory/format";
import { hasPermission } from "@/lib/permissions/roles";
import type { AccountingPeriod } from "@/types/domain";

interface CloseBlocker {
  code: string;
  message: string;
  count: number;
}

interface CloseEvidence {
  periodKey: string;
  periodStart: string;
  periodEnd: string;
  journalEntryCount: number;
  journalLineCount: number;
  totalDebitMinor: number;
  totalCreditMinor: number;
  trialBalance: NonNullable<AccountingPeriod["trialBalance"]>;
  blockers: CloseBlocker[];
}

interface CloseWorkspace {
  evidence: CloseEvidence;
  periods: AccountingPeriod[];
}

function previousMonth() {
  const date = new Date();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}

export default function AccountingClosePage() {
  const { profile, user } = useAuth();
  const can = (permission: Parameters<typeof hasPermission>[1]) =>
    Boolean(profile && hasPermission(profile, permission));
  const [periodKey, setPeriodKey] = useState(previousMonth);
  const [workspace, setWorkspace] = useState<CloseWorkspace | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile || !can("accounting.close.read")) return;
    setBusy(true);
    setError(null);
    try {
      setWorkspace(await callAdministration("getAccountingCloseWorkspace", { periodKey }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The monthly close workspace could not be loaded.");
    } finally {
      setBusy(false);
    }
  // `can` derives only from the profile already listed here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodKey, profile]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(success);
      setNotes("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The accounting close action could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  const selectedPeriod = useMemo(
    () => workspace?.periods.find((period) => period.periodKey === periodKey),
    [periodKey, workspace?.periods],
  );
  const blocked = Boolean(workspace?.evidence.blockers.length);

  function downloadTrialBalance() {
    if (!workspace) return;
    const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = workspace.evidence.trialBalance.map((line) => [
      line.accountCode,
      line.accountName,
      (line.debitMinor / 100).toFixed(2),
      (line.creditMinor / 100).toFixed(2),
      (line.netMinor / 100).toFixed(2),
      "NGN",
    ]);
    const csv = [
      ["account_code", "account_name", "debit_naira", "credit_naira", "net_debit_naira", "currency"],
      ...rows,
    ].map((row) => row.map(escape).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `trial-balance-${periodKey}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (!profile || !can("accounting.close.read"))
    return <div className="rounded-xl border bg-white p-6">Your roles do not include monthly accounting-close access.</div>;

  return <div className="space-y-5">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[.16em] text-[var(--brand)]">Finance control</p>
        <h1 className="text-3xl font-semibold">Monthly accounting close</h1>
        <p className="max-w-3xl text-[var(--muted)]">Review the month&apos;s balanced ledger and operational blockers, prepare the evidence, then have another authorized person complete the close. A prepared or closed month rejects all new journal postings dated in that month.</p>
      </div>
      <Button variant="outline" disabled={busy} onClick={() => void load()}><RefreshCw className="mr-2 size-4" /> Refresh</Button>
    </header>

    {error && <div role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</div>}
    {message && <div role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">{message}</div>}

    <section className="rounded-xl border bg-white p-5">
      <div className="grid gap-4 md:grid-cols-[16rem_minmax(0,1fr)] md:items-end">
        <label className="text-sm font-medium">Month<input type="month" value={periodKey} onChange={(event) => setPeriodKey(event.target.value)} className="mt-1 w-full rounded-lg border p-3" /></label>
        <div className="rounded-lg bg-slate-50 p-4 text-sm"><strong className="capitalize">{selectedPeriod?.status ?? "Open / not prepared"}</strong><p className="mt-1 text-[var(--muted)]">{workspace?.evidence.periodStart} to {workspace?.evidence.periodEnd}</p></div>
      </div>
    </section>

    {workspace && <>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border bg-white p-4"><span className="text-sm text-[var(--muted)]">Journal entries</span><strong className="mt-2 block text-2xl">{workspace.evidence.journalEntryCount}</strong></div>
        <div className="rounded-xl border bg-white p-4"><span className="text-sm text-[var(--muted)]">Journal lines</span><strong className="mt-2 block text-2xl">{workspace.evidence.journalLineCount}</strong></div>
        <div className="rounded-xl border bg-white p-4"><span className="text-sm text-[var(--muted)]">Total debits</span><strong className="mt-2 block text-2xl">{formatNaira(workspace.evidence.totalDebitMinor)}</strong></div>
        <div className="rounded-xl border bg-white p-4"><span className="text-sm text-[var(--muted)]">Total credits</span><strong className="mt-2 block text-2xl">{formatNaira(workspace.evidence.totalCreditMinor)}</strong></div>
      </section>

      <section className="rounded-xl border bg-white p-5">
        <h2 className="flex items-center gap-2 text-xl font-semibold"><ShieldCheck className="size-5 text-[var(--brand)]" /> Readiness checks</h2>
        {blocked ? <div className="mt-4 space-y-3">{workspace.evidence.blockers.map((blocker) => <div key={blocker.code} className="rounded-lg bg-amber-50 p-4 text-sm text-amber-950"><strong>{blocker.count} issue{blocker.count === 1 ? "" : "s"}</strong><p>{blocker.message}</p></div>)}</div> : <div className="mt-4 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-900"><strong>All close checks passed.</strong><p>The ledger balances and no unresolved operational records block preparation.</p></div>}
      </section>

      <section className="overflow-hidden rounded-xl border bg-white">
        <div className="flex flex-wrap items-start justify-between gap-3 p-5"><div><h2 className="text-xl font-semibold">Trial balance evidence</h2><p className="text-sm text-[var(--muted)]">Amounts are shown in naira with kobo retained to two decimal places.</p></div><Button variant="secondary" onClick={downloadTrialBalance}><Download className="mr-2 size-4" /> Download CSV</Button></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[44rem] text-left text-sm"><thead className="bg-slate-50"><tr><th className="p-3">Account</th><th className="p-3 text-right">Debit</th><th className="p-3 text-right">Credit</th><th className="p-3 text-right">Net debit / (credit)</th></tr></thead><tbody>{workspace.evidence.trialBalance.map((line) => <tr key={line.accountCode} className="border-t"><td className="p-3"><strong>{line.accountCode}</strong> · {line.accountName}</td><td className="p-3 text-right">{formatNaira(line.debitMinor)}</td><td className="p-3 text-right">{formatNaira(line.creditMinor)}</td><td className="p-3 text-right">{formatNaira(line.netMinor)}</td></tr>)}{!workspace.evidence.trialBalance.length && <tr className="border-t"><td colSpan={4} className="p-6 text-center text-[var(--muted)]">No journals were posted in this month.</td></tr>}</tbody></table></div>
      </section>

      <section className="rounded-xl border bg-white p-5">
        <h2 className="flex items-center gap-2 text-xl font-semibold"><LockKeyhole className="size-5 text-[var(--brand)]" /> Close control</h2>
        <label className="mt-4 block text-sm">Close notes (optional)<textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1 min-h-24 w-full rounded-lg border p-3" placeholder="Record review notes or references for the audit trail." /></label>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {!selectedPeriod || selectedPeriod.status === "open" ? can("accounting.close.prepare") && <Button disabled={busy || blocked} onClick={() => void run(() => callAdministration("prepareAccountingPeriodClose", { periodKey, notes: notes || undefined, idempotencyKey: crypto.randomUUID() }), `${periodKey} prepared for independent completion.`)}><ShieldCheck className="mr-2 size-4" /> Prepare month</Button> : null}
          {selectedPeriod?.status === "prepared" && selectedPeriod.preparedBy === user?.uid && <span className="text-sm text-amber-800">Another authorized finance officer or administrator must complete this close.</span>}
          {selectedPeriod?.status === "prepared" && selectedPeriod.preparedBy !== user?.uid && can("accounting.close.approve") && <Button disabled={busy || blocked} onClick={() => void run(() => callAdministration("completeAccountingPeriodClose", { accountingPeriodId: selectedPeriod.id, notes: notes || undefined, idempotencyKey: crypto.randomUUID() }), `${periodKey} closed and locked.`)}><CheckCircle2 className="mr-2 size-4" /> Complete independently</Button>}
          {selectedPeriod?.status === "closed" && <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-900"><CheckCircle2 className="size-4" /> Month closed</span>}
        </div>
      </section>

      <section className="rounded-xl border bg-white p-5"><h2 className="text-xl font-semibold">Close history</h2><div className="mt-4 space-y-2">{workspace.periods.map((period) => <div key={period.id} className="flex items-center justify-between rounded-lg border p-3"><span><strong>{period.periodKey}</strong><small className="ml-2 capitalize text-[var(--muted)]">{period.status}</small></span><span className="text-sm">{formatNaira(period.totalDebitMinor ?? 0)}</span></div>)}{!workspace.periods.length && <p className="text-sm text-[var(--muted)]">No accounting month has been prepared yet.</p>}</div></section>
    </>}
  </div>;
}
