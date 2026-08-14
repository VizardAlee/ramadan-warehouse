"use client";

import { AlertTriangle, CheckCircle2, Loader2, Search } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { useAuth } from "@/features/auth/auth-context";
import { useConnectivity } from "@/lib/connectivity";
import { hasRole } from "@/lib/permissions/roles";

interface Check { code: string; status: "pass" | "warning" | "fail"; message: string; expected?: unknown; actual?: unknown }
interface Result { transferId: string; transferNumber: string; status: "clean" | "warning" | "error"; checkedAt: string; checks: Check[] }

export function TransferReconciliation() {
  const { profile } = useAuth();
  const { online } = useConnectivity();
  const [transferId, setTransferId] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const authorized = profile && (["system_administrator", "operations_administrator", "auditor"] as const).some((roleId) => hasRole(profile, roleId));
  if (!authorized) return <p className="rounded-xl border bg-white p-8">Detailed transfer reconciliation is restricted to administrators and auditors.</p>;
  async function run() {
    setLoading(true); setMessage(null);
    try { setResult(await callAdministration("reconcileTransfer", { transferId })); }
    catch { setMessage("Reconciliation could not run. Verify the transfer ID and your authorization."); }
    finally { setLoading(false); }
  }
  return <div className="space-y-5">
    <header><h1 className="text-3xl font-semibold">Transfer reconciliation</h1><p className="text-[var(--muted)]">Read-only comparison of workflow projections, ledger movements, reservations, packages, dispatches, receipts, discrepancies, and costs.</p></header>
    <section className="flex flex-col gap-3 rounded-xl border bg-white p-4 sm:flex-row">
      <label className="flex-1 text-sm"><span className="mb-1 block font-medium">Transfer ID</span><input className="w-full rounded-lg border p-2.5" value={transferId} onChange={(event) => setTransferId(event.target.value)} /></label>
      <Button className="self-end" disabled={!online || !transferId.trim() || loading} onClick={() => void run()}>{loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Search className="mr-2 size-4" />}Run read-only check</Button>
    </section>
    {message && <p className="rounded-lg bg-amber-50 p-3 text-sm">{message}</p>}
    {result && <section className="rounded-xl border bg-white p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">{result.transferNumber}</h2><p className="text-xs text-[var(--muted)]">Checked {new Date(result.checkedAt).toLocaleString("en-NG")}</p></div><span className={`rounded-full px-3 py-1 text-sm font-semibold ${result.status === "clean" ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"}`}>{result.status}</span></div><ul className="mt-5 space-y-2">{result.checks.map((check, index) => <li key={`${check.code}-${index}`} className="flex gap-3 rounded-lg border p-3">{check.status === "pass" ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-700" /> : <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-700" />}<div><p className="font-medium">{check.code}</p><p className="text-sm text-[var(--muted)]">{check.message}</p>{check.status !== "pass" && <p className="mt-1 text-xs">Expected {JSON.stringify(check.expected)}; actual {JSON.stringify(check.actual)}</p>}</div></li>)}</ul></section>}
  </div>;
}
