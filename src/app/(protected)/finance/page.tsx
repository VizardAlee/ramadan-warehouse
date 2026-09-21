"use client";

import Link from "next/link";
import { FileBarChart, Landmark, LockKeyhole, Calculator } from "lucide-react";
import { useAuth } from "@/features/auth/auth-context";
import { hasPermission } from "@/lib/permissions/roles";

const destinations = [
  { href: "/reports", title: "Financial statements", description: "Income statement, balance sheet, trial balance, and cash-flow draft reports from posted journals.", icon: FileBarChart, permission: "finance.journal.read" as const },
  { href: "/tax", title: "Tax Centre", description: "Review ledger VAT evidence and the statutory-rule register.", icon: Calculator, permission: "finance.journal.read" as const },
  { href: "/banking", title: "Company accounts", description: "Manage company bank accounts and reconciliation evidence.", icon: Landmark, permission: "banking.read" as const },
  { href: "/accounting", title: "Month close", description: "Inspect period evidence and close controls.", icon: LockKeyhole, permission: "accounting.close.read" as const },
];

export default function FinancePage() {
  const { profile } = useAuth();
  const visible = destinations.filter((item) => profile && hasPermission(profile, item.permission));
  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[.16em] text-[var(--brand)]">Financial control</p>
        <h1 className="text-3xl font-semibold">Accounting</h1>
        <p className="max-w-3xl text-[var(--muted)]">Transactions post to the existing general ledger. Use these views to review company accounts, draft statements, tax evidence, and period close.</p>
      </header>
      {visible.length ? <div className="grid gap-4 sm:grid-cols-2">
        {visible.map((item) => <Link key={item.href} href={item.href} className="rounded-xl border bg-white p-5 transition-colors hover:border-emerald-600 hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">
          <item.icon className="mb-3 size-6 text-[var(--brand)]" />
          <strong className="block text-lg">{item.title}</strong>
          <span className="mt-1 block text-sm text-[var(--muted)]">{item.description}</span>
        </Link>)}
      </div> : <p className="rounded-xl border bg-white p-5">Your roles do not include accounting access.</p>}
    </div>
  );
}
