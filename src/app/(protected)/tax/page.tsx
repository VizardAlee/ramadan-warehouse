"use client";

import { Loader2, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { callAdministration } from "@/features/administration/api";
import { useAuth } from "@/features/auth/auth-context";
import { formatNaira } from "@/features/inventory/format";
import { hasPermission } from "@/lib/permissions/roles";
import { TaxRuleWorkspace, type TaxRule } from "@/features/accounting/tax-rule-workspace";
import { Button } from "@/components/ui/button";

interface TaxWorkspace {
  fromDate: string;
  toDate: string;
  vat: {
    taxType: "VAT";
    outputVatMinor: number;
    inputVatMinor: number;
    calculatedLiabilityMinor: number;
    status: "calculated";
  };
  rules: TaxRule[];
  nextRuleCursorId: string | null;
  statutoryRuleReviewRequired: boolean;
}
function monthStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

export default function TaxPage() {
  const { profile } = useAuth();
  const allowed = Boolean(profile && hasPermission(profile, "finance.journal.read") && hasPermission(profile, "sales.read.all"));
  const [fromDate, setFromDate] = useState(monthStart);
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [workspace, setWorkspace] = useState<TaxWorkspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [rulePageSize, setRulePageSize] = useState(25);
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh(value => value + 1), []);
  const ruleCursorId = cursors.at(-1);
  const requestVersion = useRef(0);
  const queryKey = JSON.stringify([profile?.organizationId, profile?.uid, fromDate, toDate, rulePageSize, ruleCursorId, refresh]);
  const validDates = Boolean(fromDate && toDate && fromDate <= toDate);
  const currentWorkspace = loadedKey === queryKey ? workspace : null;
  useEffect(() => {
    if (!allowed) return;
    const version = ++requestVersion.current;
    const timer = window.setTimeout(() => {
      if (!validDates) {
        return;
      }
      void (async () => {
        setError(null);
        try {
          const result: TaxWorkspace = await callAdministration("getTaxWorkspace", { fromDate, toDate, rulePageSize, ruleCursorId });
          if (version !== requestVersion.current) return;
          setWorkspace(result);
          setLoadedKey(queryKey);
        } catch (cause) {
          if (version !== requestVersion.current) return;
          setError(cause instanceof Error ? cause.message : "The tax workspace could not be loaded.");
          setErrorKey(queryKey);
        }
      })();
    }, 250);
    return () => {
      window.clearTimeout(timer);
      requestVersion.current += 1;
    };
  }, [allowed, fromDate, queryKey, toDate, validDates, rulePageSize, ruleCursorId]);

  if (!allowed)
    return <div className="rounded-xl border bg-white p-6">Your roles do not include Tax Centre access.</div>;

  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[.16em] text-[var(--brand)]">Finance control</p>
        <h1 className="text-3xl font-semibold">Tax Centre</h1>
        <p className="max-w-3xl text-[var(--muted)]">Tax evidence updates when you change dates. Statutory rules are versioned separately so historical transactions are never silently recalculated.</p>
      </header>
      <section className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-2">
        <label className="text-sm font-medium">From date<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="mt-1 w-full rounded-lg border p-2.5" /></label>
        <label className="text-sm font-medium">To date<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="mt-1 w-full rounded-lg border p-2.5" /></label>
      </section>
      {!validDates && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Select a valid date range; the from date must be on or before the to date.</p>}
      {validDates && !currentWorkspace && !(error && errorKey === queryKey) && <p role="status" className="flex items-center gap-2 text-sm text-[var(--muted)]"><Loader2 className="size-4 animate-spin" /> Updating tax evidence…</p>}
      {error && errorKey === queryKey && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {currentWorkspace?.statutoryRuleReviewRequired && (
        <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <ShieldAlert className="mt-0.5 size-5 shrink-0" />
          <p>Reviewed standard VAT rules do not cover this entire period, or coverage is ambiguous. Ledger VAT remains evidence of posted transactions, not proof that rates, exemptions or input-tax recovery are correct. No legal rate is invented or silently activated.</p>
        </div>
      )}
      {currentWorkspace && (
        <>
          <section className="grid gap-3 sm:grid-cols-3">
            <TaxCard label="Output VAT" value={currentWorkspace.vat.outputVatMinor} />
            <TaxCard label="Recoverable input VAT" value={currentWorkspace.vat.inputVatMinor} />
            <TaxCard label="Calculated VAT liability" value={currentWorkspace.vat.calculatedLiabilityMinor} strong />
          </section>
        </>
      )}
      <TaxRuleWorkspace key={`${profile!.organizationId}:${profile!.uid}`} ownerKey={`${profile!.organizationId}:${profile!.uid}`} rules={currentWorkspace?.rules ?? []} canManage={hasPermission(profile!, "finance.tax.manage")} onSaved={reload} />
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-3">
        <label className="text-sm">Rules per page<select className="ml-2 rounded-lg border p-2" value={rulePageSize} onChange={event => { setRulePageSize(Number(event.target.value)); setCursors([undefined]); }}>{[25, 50, 100].map(value => <option key={value}>{value}</option>)}</select></label>
        <div className="flex items-center gap-3"><Button variant="secondary" disabled={cursors.length === 1 || !currentWorkspace} onClick={() => setCursors(value => value.slice(0, -1))}>Previous</Button><span className="text-sm">Page {cursors.length}</span><Button variant="secondary" disabled={!currentWorkspace?.nextRuleCursorId} onClick={() => setCursors(value => [...value, currentWorkspace!.nextRuleCursorId!])}>Next</Button></div>
      </div>
    </div>
  );
}

function TaxCard({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return <div className={`rounded-xl border bg-white p-5 ${strong ? "ring-2 ring-emerald-100" : ""}`}><span className="text-sm text-[var(--muted)]">{label}</span><strong className="mt-2 block text-2xl">{formatNaira(value)}</strong><span className="mt-1 block text-xs uppercase tracking-wide text-[var(--muted)]">Calculated</span></div>;
}
