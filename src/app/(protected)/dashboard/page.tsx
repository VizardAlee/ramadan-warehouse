"use client";

import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  ClipboardClock,
  PackageCheck,
  Truck,
} from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrganizationCollection } from "@/features/administration/use-organization-collection";
import { useAuth } from "@/features/auth/auth-context";
import type { BranchRequest, Product, WarehouseTransfer } from "@/types/domain";

const completedRequestStatuses = new Set(["fulfilled", "cancelled", "closed", "rejected"]);
const completedTransferStatuses = new Set(["closed", "cancelled"]);

export default function DashboardPage() {
  const { profile } = useAuth();
  const requests = useOrganizationCollection<BranchRequest>("branchRequests");
  const transfers = useOrganizationCollection<WarehouseTransfer>("transfers");
  const products = useOrganizationCollection<Product>("products");
  const loading = requests.loading || transfers.loading || products.loading;
  const failed = requests.error || transfers.error || products.error;
  const summary = loading
    ? null
    : {
        requests: requests.data.filter((request) => !completedRequestStatuses.has(request.status)).length,
        transfers: transfers.data.filter((transfer) => !completedTransferStatuses.has(transfer.status)).length,
        products: products.data.filter((product) => product.active).length,
        discrepancies: transfers.data.filter((transfer) => transfer.status === "disputed").length,
      };
  const cards = [
    { label: "Open branch requests", value: summary?.requests, icon: ClipboardClock, href: "/requests", emphasis: false },
    { label: "Transfers in progress", value: summary?.transfers, icon: Truck, href: "/transfers", emphasis: false },
    { label: "Active products", value: summary?.products, icon: Boxes, href: "/products", emphasis: false },
    { label: "Open discrepancies", value: summary?.discrepancies, icon: AlertTriangle, href: "/transfers/discrepancies", emphasis: Boolean(summary?.discrepancies) },
  ];

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Operations control"
        title="Warehouse overview"
        description={`Welcome, ${profile?.displayName ?? "administrator"}. Priorities and operational queues appear here as real master data and stock are configured.`}
      />
      {failed && (
        <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          Some dashboard totals could not be refreshed. Use the linked registers for current operational detail.
        </p>
      )}
      <section aria-label="Operational summary" className="card-grid">
        {cards.map(({ label, value, icon: Icon, href, emphasis }) => (
          <Link key={label} href={href} className={`rounded-xl border bg-white p-5 transition-colors hover:border-emerald-300 ${emphasis ? "border-amber-300 bg-amber-50" : ""}`}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm text-[var(--muted)]">{label}</p>
                {value === undefined ? <Skeleton className="mt-3 h-9 w-16" /> : <p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p>}
              </div>
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-emerald-50 text-[var(--brand)]"><Icon className="size-5" /></span>
            </div>
            <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand)]">Open queue <ArrowRight className="size-3.5" /></span>
          </Link>
        ))}
      </section>
      {summary && summary.products === 0 && summary.requests === 0 && summary.transfers === 0 ? (
        <EmptyState
          icon={PackageCheck}
          title="Production workspace is ready"
          description="Start with real branches and warehouse configuration, then add the approved product catalogue and opening inventory. No sample business records have been created."
          action={<Link href="/administration" className="inline-flex min-h-11 items-center rounded-lg bg-[var(--brand)] px-4 text-sm font-semibold text-white">Configure master data</Link>}
        />
      ) : (
        <section className="rounded-xl border bg-white p-5 sm:p-6">
          <h2 className="section-title">Operational priorities</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">Review discrepancies first, then approvals and active warehouse movements. Counts reflect the records available to your current role.</p>
        </section>
      )}
    </div>
  );
}
