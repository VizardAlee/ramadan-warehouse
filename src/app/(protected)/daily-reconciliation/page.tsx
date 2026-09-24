"use client";

import Link from "next/link";
import { Banknote, ClipboardCheck, Landmark, ScanSearch } from "lucide-react";
import { useAuth } from "@/features/auth/auth-context";
import { hasPermission } from "@/lib/permissions/roles";
import type { PermissionId } from "@/types/domain";

const steps: Array<{
  title: string;
  description: string;
  href: string;
  action: string;
  permission: PermissionId;
  icon: typeof ClipboardCheck;
}> = [
  {
    title: "Count stock on the shelves",
    description: "Start a physical stock count for the store. Enter what is actually present, submit it, and review any variance before an adjustment posts.",
    href: "/inventory/counts",
    action: "Open stock counts",
    permission: "inventory.count",
    icon: ClipboardCheck,
  },
  {
    title: "Check the inventory ledger",
    description: "Compare posted stock movements with the application's balances. This check is read-only and never silently changes stock.",
    href: "/inventory/reconciliation",
    action: "Check ledger balances",
    permission: "inventory.reconcile",
    icon: ScanSearch,
  },
  {
    title: "Count cash in the till",
    description: "At the end of the shift, enter the physical cash counted in POS. The shift records expected cash, actual cash and the variance.",
    href: "/pos",
    action: "Close and reconcile shift",
    permission: "sales.shift.manage",
    icon: Banknote,
  },
  {
    title: "Match company bank activity",
    description: "Reconcile bank statement transactions against posted journal entries for each company account.",
    href: "/banking",
    action: "Open bank reconciliation",
    permission: "banking.read",
    icon: Landmark,
  },
];

export default function DailyReconciliationPage() {
  const { profile } = useAuth();
  const visibleSteps = steps.filter((step) => profile && hasPermission(profile, step.permission));
  return (
    <div className="page-stack">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[.16em] text-[var(--brand)]">Daily control</p>
        <h1 className="page-title">Daily reconciliation</h1>
        <p className="page-description max-w-3xl">
          Check the goods physically present and the money physically held against the app. Each check keeps its own dated, auditable record; a variance is never silently written away.
        </p>
      </header>
      {visibleSteps.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {visibleSteps.map((step, index) => (
            <article key={step.href} className="rounded-2xl border bg-white p-5">
              <div className="flex items-start gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-emerald-50 text-[var(--brand)]"><step.icon className="size-5" /></span>
                <div>
                  <p className="text-xs font-semibold uppercase text-[var(--muted)]">Check {index + 1}</p>
                  <h2 className="mt-1 text-lg font-semibold">{step.title}</h2>
                </div>
              </div>
              <p className="mt-3 text-sm text-[var(--muted)]">{step.description}</p>
              <Link href={step.href} className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-[var(--brand)] px-4 text-sm font-semibold text-white hover:bg-[var(--brand-dark)]">
                {step.action}
              </Link>
            </article>
          ))}
        </div>
      ) : (
        <p className="rounded-xl border bg-white p-5">Your assigned roles do not include daily reconciliation actions.</p>
      )}
      <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        Stock counts, till closes and bank reconciliations are separate evidence today. This page does not yet create a single signed-off daily close or include every non-POS cash movement.
      </p>
    </div>
  );
}
