"use client";

import {
  Archive,
  Boxes,
  ClipboardList,
  ContactRound,
  CircleHelp,
  FileBarChart,
  Gauge,
  HandCoins,
  History,
  Landmark,
  LogOut,
  MoreHorizontal,
  PackageCheck,
  ReceiptText,
  Scale,
  RotateCcw,
  RefreshCw,
  Settings,
  ShoppingCart,
  ShoppingBasket,
  Truck,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Feedback } from "@/components/ui/feedback";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";
import { useAuth } from "@/features/auth/auth-context";
import { useOperatingContextOptions } from "@/features/auth/use-operating-context-options";
import { PwaControls } from "@/features/pwa/pwa-controls";
import { useConnectivity } from "@/lib/connectivity";
import { hasAnyPermission } from "@/lib/permissions/roles";
import { cn } from "@/lib/utils";
import type { PermissionId } from "@/types/domain";

const navigation = [
  { href: "/dashboard", label: "Dashboard", icon: Gauge, permissions: [] },
  { href: "/pos", label: "POS", icon: ShoppingCart, permissions: ["sales.create"] },
  { href: "/customers", label: "Customers", icon: ContactRound, permissions: ["customers.read"] },
  { href: "/returns", label: "Returns", icon: RotateCcw, permissions: ["sales.returns.read"] },
  { href: "/procurement", label: "Purchasing", icon: ShoppingBasket, permissions: ["procurement.read", "payables.read"] },
  { href: "/expenses", label: "Expenses", icon: HandCoins, permissions: ["expenses.read"] },
  { href: "/banking", label: "Banking", icon: Landmark, permissions: ["banking.read"] },
  { href: "/accounting", label: "Month close", icon: Scale, permissions: ["accounting.close.read"] },
  { href: "/products", label: "Products", icon: Boxes, permissions: ["products.read"] },
  { href: "/inventory", label: "Inventory", icon: Archive, permissions: ["inventory.read"] },
  { href: "/requests", label: "Requests", icon: ClipboardList, permissions: ["requests.read.all", "requests.read.own_branch", "requests.create"] },
  { href: "/transfers", label: "Transfers", icon: Truck, permissions: ["transfers.read.all", "transfers.read.assigned_warehouse", "transfers.read.own_branch"] },
  { href: "/costs", label: "Costs", icon: ReceiptText, permissions: ["transfers.cost.read", "transfers.cost.create", "transfers.cost.approve", "transfers.cost.reconcile"] },
  { href: "/reports", label: "Reports", icon: FileBarChart, permissions: ["reports.inventory.read", "reports.requests.read", "reports.transfers.read", "reports.sales.read"] },
  { href: "/administration", label: "Administration", icon: Settings, permissions: ["organization.manage", "branch.manage", "warehouse.manage", "location.manage", "user.manage", "role.manage"] },
  { href: "/audit", label: "Audit", icon: History, permissions: ["audit.read"] },
  { href: "/guide", label: "User guide", icon: CircleHelp, permissions: [] },
] as const;
const titleFromPath = (pathname: string) => {
  const segments = pathname.split("/").filter(Boolean);
  const section = segments.at(-1) ?? "Dashboard";
  const namedSubpages = {
    transfers: new Set([
      "review", "reservations", "picking", "packing", "dispatch",
      "in-transit", "incoming", "discrepancies", "costs",
      "cost-approvals", "cost-reconciliation", "closed", "create",
    ]),
    requests: new Set(["create", "reports", "review"]),
    products: new Set(["categories"]),
  } as const;
  if (
    segments[0] === "transfers" &&
    segments.length === 2 &&
    !namedSubpages.transfers.has(section)
  )
    return "Transfer details";
  if (
    segments[0] === "requests" &&
    segments.length === 2 &&
    !namedSubpages.requests.has(section)
  )
    return "Request details";
  if (
    segments[0] === "products" &&
    segments.length === 2 &&
    !namedSubpages.products.has(section)
  )
    return "Product details";
  return section
    .replaceAll("-", " ")
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
};

export function AppShell({ children }: { children: ReactNode }) {
  const {
    user,
    profile,
    loading,
    error,
    logout,
    refreshAuthorization,
  } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const {
    options: contexts,
    activeValue: contextValue,
    activeOption,
    canSelectAll,
    selectValue,
  } = useOperatingContextOptions();
  const showContextSwitcher = canSelectAll
    ? contexts.length > 0
    : contexts.length > 1;
  const visibleNavigation = useMemo(
    () =>
      profile
        ? navigation.filter(
            (item) =>
              item.permissions.length === 0 ||
              hasAnyPermission(
                profile,
                item.permissions as readonly PermissionId[],
              ),
          )
        : [],
    [profile],
  );
  const mobilePrimary = visibleNavigation.slice(0, 5);
  const secondaryNavigation = visibleNavigation.slice(5);
  const moreSheetRef = useDialogFocus<HTMLElement>(open, () => setOpen(false));
  const { online } = useConnectivity();
  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);
  if (loading)
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <div className="text-center">
          <PackageCheck className="mx-auto mb-3 size-9 animate-pulse text-[var(--brand)]" />
          <p className="text-sm text-[var(--muted)]">
            Verifying warehouse access…
          </p>
        </div>
      </main>
    );
  if (!user) return null;
  if (!profile)
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <div className="w-full max-w-md">
          <Feedback tone="danger">
            <h1 className="font-semibold">Access is not provisioned</h1>
            <p className="mt-1">
              {error ??
                "Ask a system administrator to create your active user profile."}
            </p>
            <Button
              className="mt-5 w-full"
              variant="outline"
              onClick={() => void logout()}
            >
              Sign out
            </Button>
          </Feedback>
        </div>
      </main>
    );
  const active = (href: string) =>
    pathname === href ||
    (href !== "/dashboard" && pathname.startsWith(`${href}/`));
  const contextLabel = activeOption
    ? `${activeOption.typeLabel}: ${activeOption.name}`
    : null;
  const desktopNav = (
    <nav aria-label="Desktop navigation" className="space-y-1">
      {visibleNavigation.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={active(href) ? "page" : undefined}
          className={cn(
            "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm text-emerald-50 transition-colors hover:bg-white/10",
            active(href) && "bg-white/15 font-semibold text-white",
          )}
        >
          <Icon className="size-4 shrink-0" />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
  return (
    <div className="min-h-dvh xl:grid xl:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 bg-[#10291f] px-5 py-5 text-white xl:block">
        <Link
          href="/dashboard"
          className="mb-8 flex min-h-11 items-center gap-3 font-semibold"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-400 text-[#10291f]">
            <Boxes />
          </span>
          <span>
            AB Ramadan
            <small className="block text-xs font-normal text-emerald-200">
              Warehouse operations
            </small>
          </span>
        </Link>
        {desktopNav}
      </aside>
      {open && secondaryNavigation.length > 0 && (
        <div className="fixed inset-0 z-50 xl:hidden">
          <button
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
            aria-label="Close more destinations"
          />
          <section
            ref={moreSheetRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="more-destinations-title"
            className="safe-bottom absolute inset-x-0 bottom-0 mx-auto max-h-[min(80dvh,36rem)] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:p-6"
          >
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <h2
                  id="more-destinations-title"
                  className="text-xl font-semibold"
                >
                  More destinations
                </h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Guidance, administration, reporting, costs, and audit history.
                </p>
              </div>
              <Button
                size="icon"
                variant="outline"
                onClick={() => setOpen(false)}
                aria-label="Close more destinations"
              >
                <X />
              </Button>
            </div>
            <nav
              aria-label="Secondary navigation"
              className="grid gap-3 sm:grid-cols-2"
            >
              {secondaryNavigation.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setOpen(false)}
                  aria-current={active(href) ? "page" : undefined}
                  className={cn(
                    "flex min-h-14 items-center gap-3 rounded-xl border bg-white px-4 text-sm font-semibold text-slate-700",
                    active(href) &&
                      "border-emerald-300 bg-emerald-50 text-[var(--brand-dark)]",
                  )}
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-slate-100">
                    <Icon className="size-5" />
                  </span>
                  {label}
                </Link>
              ))}
            </nav>
          </section>
        </div>
      )}
      <div className="min-w-0 xl:col-start-2">
        <header className="sticky top-0 z-30 flex min-h-16 items-center gap-3 border-b bg-white/95 px-[var(--page-gutter)] backdrop-blur">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold md:text-base">
              {titleFromPath(pathname)}
            </p>
            <p className="hidden truncate text-xs text-[var(--muted)] sm:block">
              AB Ramadan Ltd. · {contextLabel ?? (profile.roleIds ?? [profile.roleId])
                .map((roleId) => roleId.replaceAll("_", " "))
                .join(", ")}
            </p>
          </div>
          <div className="ml-auto flex min-w-0 items-center gap-1">
            {showContextSwitcher && (
              <label className="min-w-0">
                <span className="sr-only">Working location</span>
                <select
                  aria-label="Working location"
                  value={contextValue}
                  onChange={(event) => {
                    selectValue(event.target.value);
                  }}
                  className="min-h-10 max-w-[10rem] rounded-lg border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-800 sm:max-w-[16rem] sm:text-sm"
                >
                  {canSelectAll && <option value="">All locations</option>}
                  {contexts.map((context) => {
                    return (
                      <option key={context.value} value={context.value}>
                        {context.typeLabel}: {context.name}
                      </option>
                    );
                  })}
                </select>
              </label>
            )}
            <PwaControls />
            <Link
              href="/guide"
              title="Open user guide"
              aria-label="Open visual user guide"
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
            >
              <CircleHelp className="size-4" />
            </Link>
            <Button
              size="icon"
              variant="ghost"
              title="Refresh authorization"
              onClick={() => void refreshAuthorization()}
              aria-label="Refresh authorization"
            >
              <RefreshCw className="size-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => void logout().then(() => router.replace("/login"))}
              aria-label="Sign out"
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </header>
        {!online && (
          <div
            role="status"
            className="border-b border-amber-300 bg-amber-50 px-[var(--page-gutter)] py-2 text-center text-sm text-amber-950"
          >
            You are offline. Data may be stale. The POS can queue paid sales;
            other protected write actions remain unavailable.
          </div>
        )}
        <main className="min-w-0 px-[var(--page-gutter)] py-[clamp(1rem,2.4vw,2rem)] pb-[calc(5.5rem+env(safe-area-inset-bottom))] xl:pb-8">
          <div key={contextValue || "organization"}>{children}</div>
        </main>
        <nav
          aria-label="Mobile and tablet navigation"
          className="safe-bottom fixed inset-x-0 bottom-0 z-30 grid border-t bg-white/97 px-1 pt-1 shadow-[0_-4px_16px_rgb(16_41_31_/_0.08)] backdrop-blur xl:hidden sm:px-[max(1rem,calc((100vw-48rem)/2))]"
          style={{
            gridTemplateColumns: `repeat(${mobilePrimary.length + (secondaryNavigation.length > 0 ? 1 : 0)}, minmax(0, 1fr))`,
          }}
        >
          {mobilePrimary.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={active(href) ? "page" : undefined}
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[.65rem] font-medium text-slate-600",
                active(href) && "bg-emerald-50 text-[var(--brand-dark)]",
              )}
            >
              <Icon className="size-5" />
              <span>{label}</span>
            </Link>
          ))}
          {secondaryNavigation.length > 0 && (
            <button
              onClick={() => setOpen(true)}
              className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[.65rem] font-medium text-slate-600"
            >
              <MoreHorizontal className="size-5" />
              <span>More</span>
            </button>
          )}
        </nav>
      </div>
    </div>
  );
}
