"use client";

import {
  Archive,
  Boxes,
  ClipboardList,
  FileBarChart,
  Gauge,
  History,
  LogOut,
  MoreHorizontal,
  PackageCheck,
  ReceiptText,
  RefreshCw,
  Settings,
  Truck,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Feedback } from "@/components/ui/feedback";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";
import { useAuth } from "@/features/auth/auth-context";
import { useConnectivity } from "@/lib/connectivity";
import { cn } from "@/lib/utils";

const navigation = [
  ["/dashboard", "Dashboard", Gauge],
  ["/products", "Products", Boxes],
  ["/inventory", "Inventory", Archive],
  ["/requests", "Requests", ClipboardList],
  ["/transfers", "Transfers", Truck],
  ["/costs", "Costs", ReceiptText],
  ["/reports", "Reports", FileBarChart],
  ["/administration", "Administration", Settings],
  ["/audit", "Audit", History],
] as const;
const mobilePrimary = navigation.slice(0, 5);
const secondaryNavigation = navigation.slice(5);
const titleFromPath = (pathname: string) => {
  const section = pathname.split("/").filter(Boolean).at(-1) ?? "Dashboard";
  return section
    .replaceAll("-", " ")
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
};

export function AppShell({ children }: { children: ReactNode }) {
  const { user, profile, loading, error, logout, refreshAuthorization } =
    useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
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
  const desktopNav = (
    <nav aria-label="Desktop navigation" className="space-y-1">
      {navigation.map(([href, label, Icon]) => (
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
      {open && (
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
                  Administration, reporting, costs, and audit history.
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
              {secondaryNavigation.map(([href, label, Icon]) => (
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
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold md:text-base">
              {titleFromPath(pathname)}
            </p>
            <p className="hidden truncate text-xs text-[var(--muted)] sm:block">
              AB Ramadan Ltd. · {profile.roleId.replaceAll("_", " ")}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-1">
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
            You are offline. Data may be stale and protected write actions
            remain unavailable.
          </div>
        )}
        <main className="min-w-0 px-[var(--page-gutter)] py-[clamp(1rem,2.4vw,2rem)] pb-[calc(5.5rem+env(safe-area-inset-bottom))] xl:pb-8">
          {children}
        </main>
        <nav
          aria-label="Mobile and tablet navigation"
          className="safe-bottom fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t bg-white/97 px-1 pt-1 shadow-[0_-4px_16px_rgb(16_41_31_/_0.08)] backdrop-blur xl:hidden sm:px-[max(1rem,calc((100vw-48rem)/2))]"
        >
          {mobilePrimary.map(([href, label, Icon]) => (
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
          <button
            onClick={() => setOpen(true)}
            className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[.65rem] font-medium text-slate-600"
          >
            <MoreHorizontal className="size-5" />
            <span>More</span>
          </button>
        </nav>
      </div>
    </div>
  );
}
