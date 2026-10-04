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
import { NotificationCard } from "@/features/notifications/notification-card";
import { useNotifications } from "@/features/notifications/use-notifications";

interface PageResult<T> {
  rows: T[];
  nextCursor: string | null;
}

function ChartPlaceholder({ label }: { label: string }) {
  return (
    <div aria-label={`${label} loading`} className="surface min-h-80 p-5 sm:p-6">
      <Skeleton className="h-6 w-44" />
      <Skeleton className="mt-3 h-4 w-64 max-w-full" />
      <Skeleton className="mt-8 h-48 w-full rounded-xl" />
    </div>
  );
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
  const { rows: notifications, error: notificationError, markRead } = useNotifications();
  const products = useOrganizationCollection<Product>("products");
  const [requests, setRequests] = useState<BranchRequest[]>([]);
  const [transfers, setTransfers] = useState<DashboardTransfer[]>([]);
  const [sales, setSales] = useState<DashboardSale[]>([]);
  const [operationsLoading, setOperationsLoading] = useState(true);
  const [salesLoading, setSalesLoading] = useState(true);
  const [operationsError, setOperationsError] = useState(false);
  const [salesError, setSalesError] = useState(false);

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
    queueMicrotask(() => {
      if (!active) return;
      setOperationsLoading(true);
      setOperationsError(false);
      setSalesLoading(canReadSales);
      setSalesError(false);
      if (!canReadSales) setSales([]);
    });
    void Promise.all([
      loadScopedRegister<BranchRequest>("listBranchRequests"),
      loadScopedRegister<WarehouseTransfer>("listTransfers"),
      (profile.roleIds?.length ? profile.roleIds : [profile.roleId]).some(r => ["system_administrator", "operations_administrator", "warehouse_manager", "branch_manager", "auditor", "finance_officer"].includes(r)) ? loadScopedRegister<StockTransfer>("stockTransfers", { action: "list" }) : Promise.resolve([] as StockTransfer[]),
    ])
      .then(([requestRows, transferRows, simpleRows]) => {
        if (!active) return;
        setRequests(requestRows);
        setTransfers([...transferRows, ...simpleRows.map(t => ({ status: t.status, originWarehouseId: t.sourceWarehouseId, sourceBranchId: t.sourceBranchId, destinationBranchId: t.destinationBranchId }))]);
      })
      .catch(() => {
        if (active) {
          setRequests([]);
          setTransfers([]);
          setOperationsError(true);
        }
      })
      .finally(() => {
        if (active) setOperationsLoading(false);
      });
    if (canReadSales) {
      void loadSalesRegister(salesBranchId)
        .then((saleRows) => {
          if (active) setSales(saleRows);
        })
        .catch(() => {
          if (active) {
            setSales([]);
            setSalesError(true);
          }
        })
        .finally(() => {
          if (active) setSalesLoading(false);
        });
    }
    return () => {
      active = false;
    };
  }, [operatingContext, profile]);

  const operationsReady = !operationsLoading && !products.loading && !operationsError && !products.error;
  const scopedRecords = scopeDashboardRecords(
    requests,
    transfers,
    operatingContext,
  );
  const summary = operationsReady
    ? summarizeDashboard(
        scopedRecords.requests,
        scopedRecords.transfers,
        products.data,
      )
    : null;
  const cards = [
    { label: "Open branch requests", value: summary?.requests, icon: ClipboardClock, href: "/requests", emphasis: false },
    { label: "Transfers in progress", value: summary?.transfers, icon: Truck, href: "/transfers", emphasis: false },
    { label: "Active products", value: summary?.products, icon: Boxes, href: "/products", emphasis: false },
    { label: "Open discrepancies", value: summary?.discrepancies, icon: AlertTriangle, href: "/transfers", emphasis: Boolean(summary?.discrepancies) },
  ];
  const mixData = summary ? [
    { label: "Open requests", value: summary.requests, color: "#34458f" },
    { label: "Transfers on track", value: Math.max(0, summary.transfers - summary.discrepancies), color: "#6074bd" },
    { label: "Discrepancies", value: summary.discrepancies, color: "#c8563d" },
  ] : [];
  const pipelineColors = ["#34458f", "#6074bd", "#f6b333", "#c8563d"];
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
              ? "Central stock overview"
              : "Organization overview"
        }
        description={`Welcome, ${profile?.displayName ?? "administrator"}. Priorities and operational queues appear here as real master data and stock are configured.`}
      />
      <DashboardLocationSwitcher />
      <section aria-label="Needs your attention" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Needs your attention</h2>
            <p className="text-sm text-[var(--muted)]">Current tasks for your assigned locations.</p>
          </div>
          <Link href="/notifications" className="inline-flex min-h-10 items-center gap-1 font-semibold text-[var(--brand)]">View notifications <ArrowRight className="size-4" /></Link>
        </div>
        {notificationError && <p role="alert" className="text-sm text-amber-800">{notificationError}</p>}
        {notifications.filter((item) => item.actionRequired).length ? notifications.filter((item) => item.actionRequired).slice(0, 3).map((item) => <NotificationCard key={item.id} item={item} onRead={markRead} />) : <p className="rounded-xl border bg-white p-4 text-sm text-[var(--muted)]">No action is waiting for you.</p>}
      </section>
      <aside className="flex flex-wrap items-center gap-4 rounded-xl border border-indigo-100 bg-indigo-50 p-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-[var(--brand)]">
          <BookOpenCheck className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-[var(--brand-dark)]">New to AB Ramadan?</p>
          <p className="mt-1 text-sm text-[var(--muted)]">Follow the visual setup, stock movement, sales, and accounting workflows.</p>
        </div>
        <Link href="/guide" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[var(--brand)] px-4 text-sm font-semibold text-white">
          Open user guide <ArrowRight className="size-4" />
        </Link>
      </aside>
      {(operationsError || products.error || salesError) && (
        <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          Some dashboard totals could not be refreshed. Use the linked registers for current detail.
        </p>
      )}
      {canReadSales && (
        <>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Financial colour key"><span className="finance-income">● Received or earned</span><span className="finance-attention">● Due or needs attention</span><span className="finance-outflow">● Outflow or shortfall</span><span className="finance-balance">● Balance or information</span></p>
          <section aria-label="Sales summary" className="card-grid">
            {[
              { label: "Sales (30 days)", value: String(salesSummary.saleCount), icon: ReceiptText, href: "/reports", tone: "finance-balance" },
              { label: "Sales value", value: formatNaira(salesSummary.grossAmountMinor), icon: ShoppingBag, href: "/reports", tone: "finance-income" },
              { label: "Amount received", value: formatNaira(salesSummary.amountPaidMinor), icon: HandCoins, href: "/reports", tone: "finance-income" },
              { label: "Customer credit", value: formatNaira(salesSummary.creditAmountMinor), icon: ClipboardClock, href: "/customers", tone: "finance-attention" },
            ].map(({ label, value, icon: Icon, href, tone }) => (
              <Link key={label} href={href} className="surface interactive-card p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0"><p className="text-sm text-[var(--muted)]">{label}</p>{salesLoading ? <Skeleton className="mt-3 h-9 w-24" /> : <p className={`mt-2 truncate text-2xl font-semibold tabular-nums ${tone}`}>{salesError ? "—" : value}</p>}</div>
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-indigo-50 text-[var(--brand)]"><Icon className="size-5" /></span>
                </div>
                <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand)]">Open details <ArrowRight className="size-3.5" /></span>
              </Link>
            ))}
          </section>
          {!salesError && (
            <section aria-label="Sales charts" aria-busy={salesLoading} className="grid gap-4 lg:grid-cols-2">
              {salesLoading ? <><ChartPlaceholder label="Sales trend" /><ChartPlaceholder label="Payment mix" /></> : <><SalesTrendChart data={salesTrend} /><SalesPaymentMixChart data={salesPaymentMix} /></>}
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
          <Link key={label} href={href} className={`surface interactive-card p-5 ${emphasis ? "border-amber-300 bg-amber-50" : ""}`}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm text-[var(--muted)]">{label}</p>
                {!operationsReady && !operationsError && !products.error ? <Skeleton className="mt-3 h-9 w-16" /> : <p className="mt-2 text-3xl font-semibold tabular-nums">{value ?? "—"}</p>}
              </div>
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-indigo-50 text-[var(--brand)]"><Icon className="size-5" /></span>
            </div>
            <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand)]">Open queue <ArrowRight className="size-3.5" /></span>
          </Link>
        ))}
      </section>
      {!operationsError && !products.error && (
        <section aria-label="Operational charts" aria-busy={!operationsReady} className="grid gap-4 lg:grid-cols-2">
          {summary ? <><OperationalMixChart data={mixData} /><TransferPipelineChart data={pipelineData} /></> : <><ChartPlaceholder label="Open work" /><ChartPlaceholder label="Transfer pipeline" /></>}
        </section>
      )}
      {summary && summary.products === 0 && summary.requests === 0 && summary.transfers === 0 ? (
        <EmptyState
          icon={PackageCheck}
          title="Production workspace is ready"
          description="Set up Head Office and your stores, then add the product catalogue and opening stock. No sample business records have been created."
          action={<Link href="/administration" className="inline-flex min-h-11 items-center rounded-lg bg-[var(--brand)] px-4 text-sm font-semibold text-white">Configure master data</Link>}
        />
      ) : (
        <section className="rounded-xl border bg-white p-5 sm:p-6">
          <h2 className="section-title">Operational priorities</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">Review discrepancies first, then requests and active store movements. Counts reflect the records available to your current role.</p>
        </section>
      )}
    </div>
  );
}
