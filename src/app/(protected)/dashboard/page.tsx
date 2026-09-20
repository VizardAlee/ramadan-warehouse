"use client";

import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  BookOpenCheck,
  ClipboardClock,
  HandCoins,
  PackageCheck,
  ReceiptText,
  ShoppingBag,
  Truck,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { callAdministration } from "@/features/administration/api";
import { useOrganizationCollection } from "@/features/administration/use-organization-collection";
import { useAuth } from "@/features/auth/auth-context";
import {
  OperationalMixChart,
  SalesPaymentMixChart,
  SalesTrendChart,
  TransferPipelineChart,
} from "@/features/dashboard/charts";
import { DashboardLocationSwitcher } from "@/features/dashboard/location-switcher";
import {
  scopeDashboardRecords,
  summarizeDashboard,
  summarizeSales,
  summarizeSalesByDay,
  summarizeSalesPaymentMix,
  summarizeTransferPipeline,
  type DashboardSale,
  type DashboardTransfer,
} from "@/features/dashboard/summary";
import type { BranchRequest, Product, WarehouseTransfer } from "@/types/domain";
import type { StockTransfer } from "../../../../functions/src/transfers/simple-model";
import { formatNaira } from "@/features/inventory/format";
import { hasPermission } from "@/lib/permissions/roles";

interface PageResult<T> {
  rows: T[];
  nextCursor: string | null;
}

async function loadScopedRegister<T>(callable: string, extra: object = {}): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const result = await callAdministration<object, PageResult<T>>(callable, {
      cursor,
      limit: 100,
      ...extra,
    });
    rows.push(...result.rows);
    if (!result.nextCursor) return rows;
    cursor = result.nextCursor;
  }
  throw new Error("The dashboard register exceeded the supported page limit.");
}

async function loadSalesRegister(branchId?: string): Promise<DashboardSale[]> {
  const rows: DashboardSale[] = [];
  let cursor: { recordedAt: string; saleId: string } | undefined;
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - 29);
  for (let page = 0; page < 100; page += 1) {
    const result = await callAdministration<
      object,
      { rows: DashboardSale[]; nextCursor: typeof cursor | null }
    >("generateSalesReport", {
      reportType: "sales_register",
      branchId,
      fromDate: from.toISOString().slice(0, 10),
      cursor,
      limit: 500,
    });
    rows.push(...result.rows);
    if (!result.nextCursor) return rows;
    cursor = result.nextCursor;
  }
  throw new Error("The dashboard sales register exceeded the supported page limit.");
}

export default function DashboardPage() {
  const { profile, operatingContext } = useAuth();
  const products = useOrganizationCollection<Product>("products");
  const [requests, setRequests] = useState<BranchRequest[]>([]);
  const [transfers, setTransfers] = useState<DashboardTransfer[]>([]);
  const [sales, setSales] = useState<DashboardSale[]>([]);
  const [registersLoading, setRegistersLoading] = useState(true);
  const [registerError, setRegisterError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    let active = true;
    const canReadSales = hasPermission(profile, "reports.sales.read");
    const salesBranchId =
      operatingContext?.type === "branch"
        ? operatingContext.id
        : profile.branchIds.length === 1
          ? profile.branchIds[0]
          : undefined;
    void Promise.all([
      loadScopedRegister<BranchRequest>("listBranchRequests"),
      loadScopedRegister<WarehouseTransfer>("listTransfers"),
      (profile.roleIds?.length ? profile.roleIds : [profile.roleId]).some(r => ["system_administrator", "operations_administrator", "warehouse_manager", "branch_manager", "auditor", "finance_officer"].includes(r)) ? loadScopedRegister<StockTransfer>("stockTransfers", { action: "list" }) : Promise.resolve([] as StockTransfer[]),
      canReadSales ? loadSalesRegister(salesBranchId) : Promise.resolve([]),
    ])
      .then(([requestRows, transferRows, simpleRows, saleRows]) => {
        if (!active) return;
        setRequests(requestRows);
        setTransfers([...transferRows, ...simpleRows.map(t => ({ status: t.status, originWarehouseId: t.sourceWarehouseId, sourceBranchId: t.sourceBranchId, destinationBranchId: t.destinationBranchId }))]);
        setSales(saleRows);
        setRegisterError(null);
      })
      .catch(() => {
        if (active)
          setRegisterError(
            "Some dashboard totals could not be refreshed for your assignments.",
          );
      })
      .finally(() => {
        if (active) setRegistersLoading(false);
      });
    return () => {
      active = false;
    };
  }, [operatingContext, profile]);

  const loading = registersLoading || products.loading;
  const failed = registerError || products.error;
  const scopedRecords = scopeDashboardRecords(
    requests,
    transfers,
    operatingContext,
  );
  const summary = loading
    ? null
    : summarizeDashboard(
        scopedRecords.requests,
        scopedRecords.transfers,
        products.data,
      );
  const cards = [
    { label: "Open branch requests", value: summary?.requests, icon: ClipboardClock, href: "/requests", emphasis: false },
    { label: "Transfers in progress", value: summary?.transfers, icon: Truck, href: "/transfers", emphasis: false },
    { label: "Active products", value: summary?.products, icon: Boxes, href: "/products", emphasis: false },
    { label: "Open discrepancies", value: summary?.discrepancies, icon: AlertTriangle, href: "/transfers", emphasis: Boolean(summary?.discrepancies) },
  ];
  const mixData = summary ? [
    { label: "Open requests", value: summary.requests, color: "#116149" },
    { label: "Transfers on track", value: Math.max(0, summary.transfers - summary.discrepancies), color: "#2a8b72" },
    { label: "Active products", value: summary.products, color: "#e7aa2d" },
    { label: "Discrepancies", value: summary.discrepancies, color: "#c8563d" },
  ] : [];
  const pipelineColors = ["#116149", "#2a8b72", "#e7aa2d", "#c8563d"];
  const pipelineData = summarizeTransferPipeline(scopedRecords.transfers).map((item, index) => ({
    ...item,
    color: pipelineColors[index]!,
  }));
  const salesSummary = summarizeSales(sales);
  const salesTrend = summarizeSalesByDay(sales);
  const salesPaymentMix = summarizeSalesPaymentMix(sales);
  const canReadSales = Boolean(
    profile && hasPermission(profile, "reports.sales.read"),
  );

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Operations control"
        title={
          operatingContext?.type === "branch"
            ? "Branch overview"
            : operatingContext?.type === "warehouse"
              ? "Warehouse overview"
              : "Organization overview"
        }
        description={`Welcome, ${profile?.displayName ?? "administrator"}. Priorities and operational queues appear here as real master data and stock are configured.`}
      />
      <DashboardLocationSwitcher />
      <aside className="flex flex-wrap items-center gap-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-[var(--brand)]">
          <BookOpenCheck className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-emerald-950">New to ABR Warehouse?</p>
          <p className="mt-1 text-sm text-emerald-900">Follow the visual setup, stock movement, sales, and accounting workflows.</p>
        </div>
        <Link href="/guide" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[var(--brand)] px-4 text-sm font-semibold text-white">
          Open user guide <ArrowRight className="size-4" />
        </Link>
      </aside>
      {failed && (
        <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          Some dashboard totals could not be refreshed. Use the linked registers for current operational detail.
        </p>
      )}
      {canReadSales && (
        <>
          <section aria-label="Sales summary" className="card-grid">
            {[
              { label: "Sales (30 days)", value: String(salesSummary.saleCount), icon: ReceiptText, href: "/reports" },
              { label: "Sales value", value: formatNaira(salesSummary.grossAmountMinor), icon: ShoppingBag, href: "/reports" },
              { label: "Amount received", value: formatNaira(salesSummary.amountPaidMinor), icon: HandCoins, href: "/reports" },
              { label: "Customer credit", value: formatNaira(salesSummary.creditAmountMinor), icon: ClipboardClock, href: "/customers" },
            ].map(({ label, value, icon: Icon, href }) => (
              <Link key={label} href={href} className="rounded-xl border bg-white p-5 transition-colors hover:border-emerald-300">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0"><p className="text-sm text-[var(--muted)]">{label}</p>{loading ? <Skeleton className="mt-3 h-9 w-24" /> : <p className="mt-2 truncate text-2xl font-semibold tabular-nums">{value}</p>}</div>
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-emerald-50 text-[var(--brand)]"><Icon className="size-5" /></span>
                </div>
                <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand)]">Open details <ArrowRight className="size-3.5" /></span>
              </Link>
            ))}
          </section>
          {!loading && (
            <section aria-label="Sales charts" className="grid gap-4 lg:grid-cols-2">
              <SalesTrendChart data={salesTrend} />
              <SalesPaymentMixChart data={salesPaymentMix} />
            </section>
          )}
        </>
      )}
      <div className="flex items-center gap-3 pt-2">
        <span className="h-px flex-1 bg-slate-200" />
        <h2 className="text-sm font-semibold uppercase tracking-[.14em] text-[var(--muted)]">Inventory &amp; operations</h2>
        <span className="h-px flex-1 bg-slate-200" />
      </div>
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
      {summary && (
        <section aria-label="Operational charts" className="grid gap-4 lg:grid-cols-2">
          <OperationalMixChart data={mixData} />
          <TransferPipelineChart data={pipelineData} />
        </section>
      )}
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
