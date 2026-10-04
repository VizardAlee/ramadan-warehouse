"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CursorTablePagination } from "@/components/ui/table-pagination";
import { callAdministration } from "@/features/administration/api";
import { useOrganizationCollection } from "@/features/administration/use-organization-collection";
import { useAuth } from "@/features/auth/auth-context";
import { customerHistoryLabel, customerHistoryTone, type CustomerHistory, type CustomerHistoryCursor } from "@/features/customers/history-presentation";
import { formatNaira } from "@/features/inventory/format";
import { hasPermission } from "@/lib/permissions/roles";
import type { Branch } from "@/types/domain";

export default function CustomerHistoryPage() {
  const { customer_id: customerId } = useParams<{ customer_id: string }>();
  const { profile, accessProfile, operatingContext } = useAuth();
  const branches = useOrganizationCollection<Branch>("branches");
  const canRead = Boolean(profile && hasPermission(profile, "customers.read"));
  const canAllStores = Boolean(profile && hasPermission(profile, "sales.read.all"));
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const branchId = canAllStores ? selectedBranchId : selectedBranchId || (operatingContext?.type === "branch" ? operatingContext.id : accessProfile?.branchIds[0] ?? "");
  const [pageSize, setPageSize] = useState(25);
  const [pageStarts, setPageStarts] = useState<(CustomerHistoryCursor | null)[]>([null]);
  const [response, setResponse] = useState<{ key: string; result?: CustomerHistory; error?: string } | null>(null);
  const requestVersion = useRef(0);
  const cursor = pageStarts.at(-1) ?? null;
  const queryKey = JSON.stringify([customerId, branchId, pageSize, cursor, canRead]);
  const currentResponse = response?.key === queryKey ? response : null;
  const result = currentResponse?.result;
  const loading = !currentResponse;
  const error = currentResponse?.error;

  useEffect(() => {
    if (!customerId || !canRead || (!canAllStores && !branchId)) return;
    const version = ++requestVersion.current;
    void callAdministration<object, CustomerHistory>("getCustomerHistory", {
      customerId,
      branchId: branchId || undefined,
      limit: pageSize,
      cursor: cursor || undefined,
    }).then((value) => {
      if (version === requestVersion.current) setResponse({ key: queryKey, result: value });
    }).catch((cause) => {
      if (version === requestVersion.current) setResponse({ key: queryKey, error: cause instanceof Error ? cause.message : "Unable to load customer history." });
    });
    return () => { requestVersion.current += 1; };
  }, [branchId, canAllStores, canRead, cursor, customerId, pageSize, queryKey]);

  if (!canRead) return <p className="rounded-xl border bg-white p-6">Your roles do not include customer-account access.</p>;
  const visibleBranches = branches.data.filter((branch) => branch.status === "active" && (canAllStores || accessProfile?.branchIds.includes(branch.id)));
  const rows = result?.rows ?? [];

  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><Link href="/customers" className="text-sm font-semibold text-[var(--brand)]">← Customers</Link><h1 className="mt-2 text-3xl font-semibold">{result?.customer.name ?? "Customer history"}</h1><p className="font-mono text-sm text-[var(--muted)]">{result?.customer.customerNumber ?? "Loading account…"}</p></div>
    </div>
    {result && <section aria-label="Customer credit position" className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-xl border bg-blue-50 p-4"><p className="text-sm">Credit limit</p><strong className="mt-1 block text-xl finance-balance">{formatNaira(result.customer.creditLimitMinor)}</strong></div>
      <div className="rounded-xl border bg-amber-50 p-4"><p className="text-sm">Outstanding</p><strong className="mt-1 block text-xl finance-attention">{formatNaira(result.customer.outstandingBalanceMinor)}</strong></div>
      <div className="rounded-xl border bg-blue-50 p-4"><p className="text-sm">Available credit</p><strong className="mt-1 block text-xl finance-balance">{formatNaira(result.customer.availableCreditMinor)}</strong></div>
    </section>}
    <section className="rounded-xl border bg-white p-4">
      <label className="block max-w-sm text-sm font-medium">Activity at store
        <select value={branchId} onChange={(event) => { setSelectedBranchId(event.target.value); setPageStarts([null]); }} className="mt-1 w-full rounded-lg border p-3">
          {canAllStores && <option value="">All stores</option>}
          {visibleBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
        </select>
      </label>
      <p className="mt-2 text-xs text-[var(--muted)]">Credit position covers the whole organization. Store selection filters the transaction list only.</p>
    </section>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {loading && <p role="status" className="text-sm text-[var(--muted)]">Loading customer transactions…</p>}
    <section aria-label="Customer transactions" className="hidden lg:block">
      <div className="responsive-table-wrap"><table className="responsive-table">
        <thead className="bg-slate-50"><tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Activity</th><th className="px-4 py-3">Reference</th><th className="px-4 py-3 text-right">Amount</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id} className="border-t"><td className="px-4 py-3">{row.at ? new Date(row.at).toLocaleString("en-NG") : "Date pending"}</td><td className="px-4 py-3 capitalize">{customerHistoryLabel(row.kind, row.detail)}</td><td className="px-4 py-3 font-mono text-xs">{row.reference}</td><td className={`px-4 py-3 text-right font-semibold finance-${customerHistoryTone(row.kind, row.detail)}`}>{formatNaira(Math.abs(row.amountMinor))}</td></tr>)}
          {!loading && rows.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-[var(--muted)]">No recorded transactions for this selection.</td></tr>}
        </tbody>
      </table></div>
    </section>
    <section aria-label="Customer transactions on compact screens" className="space-y-3 lg:hidden">{rows.map((row) => <article key={row.id} className="rounded-xl border bg-white p-4"><div className="flex justify-between gap-3"><strong className="capitalize">{customerHistoryLabel(row.kind, row.detail)}</strong><strong className={`finance-${customerHistoryTone(row.kind, row.detail)}`}>{formatNaira(Math.abs(row.amountMinor))}</strong></div><p className="mt-1 text-xs text-[var(--muted)]">{row.reference} · {row.at ? new Date(row.at).toLocaleString("en-NG") : "Date pending"}</p></article>)}
      {!loading && rows.length === 0 && <p className="rounded-xl border bg-white p-6 text-center text-[var(--muted)]">No recorded transactions for this selection.</p>}
    </section>
    <CursorTablePagination page={pageStarts.length} pageSize={pageSize} rowCount={rows.length} hasNextPage={Boolean(result?.nextCursor)} loading={loading} onPrevious={() => setPageStarts((current) => current.length > 1 ? current.slice(0, -1) : current)} onNext={() => { if (result?.nextCursor) setPageStarts((current) => [...current, result.nextCursor]); }} onPageSizeChange={(size) => { setPageSize(size); setPageStarts([null]); }} itemLabel="transactions" />
  </div>;
}
