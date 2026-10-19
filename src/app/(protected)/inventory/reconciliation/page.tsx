"use client";
import { FinancialDetails, FinancialText } from "@/features/finance/financial-privacy";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { useAuth } from "@/features/auth/auth-context";
import { hasPermission } from "@/lib/permissions/roles";
export default function ReconciliationPage() {
  const { profile } = useAuth();
  const [result, setResult] = useState<{
    reconciliationId: string;
    checkedBalances: number;
    discrepancyCount: number;
    discrepancies: Record<string, unknown>[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  async function run() {
    setLoading(true);
    try {
      setResult(
        await callAdministration("reconcileInventoryBalances", { limit: 200 }),
      );
    } finally {
      setLoading(false);
    }
  }
  if (!profile || !hasPermission(profile, "inventory.reconcile"))
    return (
      <div className="rounded-xl border bg-white p-8">
        You do not have permission to run inventory reconciliation.
      </div>
    );
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-semibold">Inventory reconciliation</h1>
        <p className="text-[var(--muted)]">
          Read-only comparison of ledger, balances, serials, and lots. This
          never repairs data.
        </p>
      </div>
      <Button disabled={loading} onClick={run}>
        <FinancialText>{loading ? "Reconciling…" : "Run reconciliation"}</FinancialText>
      </Button>
      {result && (
        <section className="rounded-xl border bg-white p-5">
          <h2 className="font-semibold">Run <FinancialText>{result.reconciliationId}</FinancialText></h2>
          <p className="mt-1 text-sm">
            Checked <FinancialText>{result.checkedBalances}</FinancialText> balances; found{" "}
            <FinancialText>{result.discrepancyCount}</FinancialText> discrepancies.
          </p>
          <pre className="mt-4 max-h-96 overflow-auto rounded-lg bg-slate-950 p-4 text-xs text-emerald-100">
            <FinancialDetails>{JSON.stringify(result.discrepancies, null, 2)}</FinancialDetails>
          </pre>
        </section>
      )}
    </div>
  );
}
