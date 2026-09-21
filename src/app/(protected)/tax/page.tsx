"use client";

import { Calculator, RefreshCw, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!allowed) return;
    setBusy(true);
    setError(null);
    try {
      setWorkspace(await callAdministration("getTaxWorkspace", { fromDate, toDate }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The tax workspace could not be loaded.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
    // The selected dates are intentionally refreshed with the Run button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed]);

  if (!allowed)
    return <div className="rounded-xl border bg-white p-6">Your roles do not include Tax Centre access.</div>;

  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[.16em] text-[var(--brand)]">Finance control</p>
        <h1 className="text-3xl font-semibold">Tax Centre</h1>
        <p className="max-w-3xl text-[var(--muted)]">Review tax calculated from posted ledger activity. Statutory rules are versioned separately so historical transactions are never silently recalculated.</p>
      </header>
      <section className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-3">
        <label className="text-sm font-medium">From date<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="mt-1 w-full rounded-lg border p-2.5" /></label>
        <label className="text-sm font-medium">To date<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="mt-1 w-full rounded-lg border p-2.5" /></label>
        <Button className="self-end" disabled={busy} onClick={() => void load()}><RefreshCw className="mr-2 size-4" /> Run</Button>
      </section>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {workspace?.statutoryRuleReviewRequired && (
        <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <ShieldAlert className="mt-0.5 size-5 shrink-0" />
          <p>No approved effective-dated statutory tax rule is configured. Ledger VAT is shown for review, but the system will not invent or silently activate a legal rate.</p>
        </div>
      )}
      {workspace && (
        <>
          <section className="grid gap-3 sm:grid-cols-3">
            <TaxCard label="Output VAT" value={workspace.vat.outputVatMinor} />
            <TaxCard label="Recoverable input VAT" value={workspace.vat.inputVatMinor} />
            <TaxCard label="Calculated VAT liability" value={workspace.vat.calculatedLiabilityMinor} strong />
          </section>
          <section className="rounded-xl border bg-white p-5">
            <h2 className="flex items-center gap-2 text-xl font-semibold"><Calculator className="size-5 text-[var(--brand)]" /> Tax rule register</h2>
            {workspace.rules.length ? (
              <div className="mt-3 responsive-table-wrap"><table className="responsive-table text-sm"><thead className="bg-slate-50"><tr><th className="px-3 py-2">Tax</th><th className="px-3 py-2">Version</th><th className="px-3 py-2">Effective period</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Source</th></tr></thead><tbody>{workspace.rules.map((rule) => <tr key={rule.id} className="border-t"><td data-label="Tax" className="px-3 py-2">{rule.taxType}</td><td data-label="Version" className="px-3 py-2">{rule.version}</td><td data-label="Effective period" className="px-3 py-2">{rule.effectiveFrom} – {rule.effectiveTo || "current"}</td><td data-label="Status" className="px-3 py-2 capitalize">{rule.status}</td><td data-label="Source" className="px-3 py-2">{rule.source}</td></tr>)}</tbody></table></div>
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
