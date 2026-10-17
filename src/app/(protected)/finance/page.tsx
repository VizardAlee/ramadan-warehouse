"use client";

import Link from "next/link";
import { useState } from "react";
import { useFinancialAccess } from "@/features/accounting/use-financial-access";
import { useOrganizationCollection } from "@/features/administration/use-organization-collection";
import type { Branch } from "@/types/domain";
import { FileBarChart, Landmark, LockKeyhole, Calculator } from "lucide-react";
import { useAuth } from "@/features/auth/auth-context";
import { hasPermission } from "@/lib/permissions/roles";
import { BillingControls } from "@/features/accounting/billing-controls";
import { JournalWorkspace } from "@/features/accounting/journal-workspace";
import { BudgetWorkspace } from "@/features/accounting/budget-workspace";

const destinations = [
  { href: "/reports", title: "Financial statements", description: "Income statement, balance sheet, trial balance, and cash-flow draft reports from posted journals.", icon: FileBarChart, permission: "finance.journal.read" as const },
  { href: "/tax", title: "Tax Centre", description: "Review ledger VAT evidence and the statutory-rule register.", icon: Calculator, permission: "finance.journal.read" as const },
  { href: "/banking", title: "Company accounts", description: "Manage company bank accounts and reconciliation evidence.", icon: Landmark, permission: "banking.read" as const },
  { href: "/accounting", title: "Month close", description: "Inspect period evidence and close controls.", icon: LockKeyhole, permission: "accounting.close.read" as const },
];

export default function FinancePage() {
  const { profile, user, operatingContext } = useAuth();
  const { access, error, loading } = useFinancialAccess();
  const branches = useOrganizationCollection<Branch>("branches");
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const globalRead = Boolean(access?.organizationPermissions.includes("finance.journal.read"));
  const branchId = (selectedBranch ?? (operatingContext?.type === "branch" && access?.branchIds.includes(operatingContext.id) ? operatingContext.id : !globalRead ? access?.branchIds[0] : undefined)) || undefined;
  const ready = Boolean(access && (globalRead || branchId && access.branchIds.includes(branchId)));
  const can = (permission: "finance.journal.create" | "finance.journal.reverse" | "finance.accounts.manage" | "finance.budget.manage") => Boolean(access?.permissions.includes(permission));
  const visible = destinations.filter((item) => profile && hasPermission(profile, item.permission) &&
    (item.href !== "/tax" || globalRead));
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
      {loading && <p role="status">Checking financial access…</p>}
      {error && <p role="alert" className="text-red-800">{error}</p>}
      {access && <label className="block text-sm">Accounting scope<select aria-label="Accounting scope" value={branchId ?? ""} onChange={event => setSelectedBranch(event.target.value)} className="ml-3 rounded-lg border p-2">
        {globalRead && <option value="">Entire organization</option>}
        {branches.data.filter(branch => branch.status === "active" && (globalRead || access.branchIds.includes(branch.id))).map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
      </select></label>}
      {access && !ready && <p>Select an assigned branch before reviewing accounting records.</p>}
      {profile && user && ready && <JournalWorkspace key={`${profile.organizationId}:${user.uid}:${branchId ?? "all"}`}
        ownerKey={`${profile.organizationId}:${user.uid}`} branchId={branchId}
        canCreate={can("finance.journal.create")} canReverse={can("finance.journal.reverse")} canManageAccounts={can("finance.accounts.manage")} />}
      {profile && user && can("finance.accounts.manage") && <BillingControls key={`billing:${profile.organizationId}:${user.uid}`} ownerKey={`${profile.organizationId}:${user.uid}`} />}
      {profile && user && ready && <BudgetWorkspace key={`budget:${profile.organizationId}:${user.uid}:${branchId ?? "all"}`} ownerKey={`${profile.organizationId}:${user.uid}`} branchId={branchId} canManage={can("finance.budget.manage")} />}
    </div>
  );
}
