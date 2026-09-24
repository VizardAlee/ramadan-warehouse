"use client";

import { Calculator, Loader2, ShieldAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { callAdministration } from "@/features/administration/api";
import { useAuth } from "@/features/auth/auth-context";
import { formatNaira } from "@/features/inventory/format";
import { hasPermission } from "@/lib/permissions/roles";

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
  rules: Array<{
    id: string;
    taxType?: string;
    version?: string;
    effectiveFrom?: string;
    effectiveTo?: string;
    status?: string;
    source?: string;
  }>;
  statutoryRuleReviewRequired: boolean;
}
function monthStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

export default function TaxPage() {
  const { profile } = useAuth();
  const allowed = Boolean(profile && hasPermission(profile, "finance.journal.read"));
  const [fromDate, setFromDate] = useState(monthStart);
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [workspace, setWorkspace] = useState<TaxWorkspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const queryKey = JSON.stringify([fromDate, toDate]);
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
          const result: TaxWorkspace = await callAdministration("getTaxWorkspace", { fromDate, toDate });
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
  }, [allowed, fromDate, queryKey, toDate, validDates]);

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
          <p>No approved effective-dated statutory tax rule is configured. Ledger VAT is shown for review, but the system will not invent or silently activate a legal rate.</p>
        </div>
      )}
      {currentWorkspace && (
        <>
          <section className="grid gap-3 sm:grid-cols-3">
            <TaxCard label="Output VAT" value={currentWorkspace.vat.outputVatMinor} />
            <TaxCard label="Recoverable input VAT" value={currentWorkspace.vat.inputVatMinor} />
            <TaxCard label="Calculated VAT liability" value={currentWorkspace.vat.calculatedLiabilityMinor} strong />
          </section>
          <section className="rounded-xl border bg-white p-5">
            <h2 className="flex items-center gap-2 text-xl font-semibold"><Calculator className="size-5 text-[var(--brand)]" /> Tax rule register</h2>
            {currentWorkspace.rules.length ? (
              <div className="mt-3 responsive-table-wrap"><table className="responsive-table text-sm"><thead className="bg-slate-50"><tr><th className="px-3 py-2">Tax</th><th className="px-3 py-2">Version</th><th className="px-3 py-2">Effective period</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Source</th></tr></thead><tbody>{currentWorkspace.rules.map((rule) => <tr key={rule.id} className="border-t"><td data-label="Tax" className="px-3 py-2">{rule.taxType}</td><td data-label="Version" className="px-3 py-2">{rule.version}</td><td data-label="Effective period" className="px-3 py-2">{rule.effectiveFrom} – {rule.effectiveTo || "current"}</td><td data-label="Status" className="px-3 py-2 capitalize">{rule.status}</td><td data-label="Source" className="px-3 py-2">{rule.source}</td></tr>)}</tbody></table></div>
            ) : <p className="mt-3 text-sm text-[var(--muted)]">No reviewed statutory rules have been activated.</p>}
          </section>
        </>
      )}
    </div>
  );
}

function TaxCard({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return <div className={`rounded-xl border bg-white p-5 ${strong ? "ring-2 ring-emerald-100" : ""}`}><span className="text-sm text-[var(--muted)]">{label}</span><strong className="mt-2 block text-2xl">{formatNaira(value)}</strong><span className="mt-1 block text-xs uppercase tracking-wide text-[var(--muted)]">Calculated</span></div>;
}
