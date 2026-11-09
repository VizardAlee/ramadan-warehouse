"use client";

import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { useAuth } from "@/features/auth/auth-context";
import { DashboardLocationSwitcher } from "@/features/dashboard/location-switcher";
import { hasPermission, roleIdsForProfile } from "@/lib/permissions/roles";
import { permissionIds, type PermissionId } from "@/types/domain";

type Profile = Parameters<typeof hasPermission>[0];
const purchasingPermissions = new Set<PermissionId>([
  "products.read", "suppliers.read", "suppliers.manage", "procurement.read",
  "procurement.create", "procurement.approve", "procurement.receive",
  "payables.read", "payables.create", "payables.approve",
]);

/** Effective grants decide the landing page, so mixed-role users keep their workspace. */
export function isPurchasingOnlyProfile(profile: Profile): boolean {
  return roleIdsForProfile(profile).includes("purchasing_manager") &&
    hasPermission(profile, "procurement.read") &&
    !permissionIds.some(permission => !purchasingPermissions.has(permission) && hasPermission(profile, permission));
}

const workflows: readonly { title: string; detail: string; href: string; permission: PermissionId }[] = [
  { title: "Purchase orders", detail: "Review drafts, submitted orders and approved purchases for the selected branch.", href: "/procurement#purchase-orders", permission: "procurement.read" },
  { title: "Create a purchase order", detail: "Choose the supplier, products and receiving location.", href: "/procurement#new-purchase-order", permission: "procurement.create" },
  { title: "Receive purchased goods", detail: "Open an approved purchase order to record delivered quantities and receiving evidence.", href: "/procurement#purchase-orders", permission: "procurement.receive" },
  { title: "Supplier invoices", detail: "Review and match invoices against received goods. Payment authority remains separate.", href: "/procurement#supplier-invoices", permission: "payables.read" },
  { title: "Dealers / Suppliers", detail: "Find suppliers and review their purchasing records.", href: "/suppliers", permission: "suppliers.read" },
  { title: "Product catalogue", detail: "Look up products used on purchase orders.", href: "/products", permission: "products.read" },
];

export function PurchasingDashboard() {
  const { profile, operatingContext } = useAuth();
  if (!profile) return null;
  return <div className="page-stack">
    <PageHeader eyebrow="Purchasing" title="Purchasing overview" description={`Welcome, ${profile.displayName}. Manage purchase orders, receiving and supplier invoices.`} />
    <DashboardLocationSwitcher description="Purchasing registers follow the selected branch. Your authorized roles and actions do not change when you switch the view." />
    <p className="rounded-xl border bg-white p-4 text-sm text-[var(--muted)]">
      {operatingContext?.type === "branch"
        ? "Purchasing registers follow your selected branch. Switch branches above to handle purchases for another store."
        : "Select a branch above before opening its purchasing registers. All branches, including Head Office, are available."}
    </p>
    <section aria-label="Purchasing workflows" className="card-grid">
      {workflows.filter(item => hasPermission(profile, item.permission)).map(item =>
        <Link key={item.title} href={item.href} className="surface interactive-card p-5">
          <h2 className="text-lg font-semibold">{item.title}</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">{item.detail}</p>
          <span className="mt-4 inline-block text-sm font-semibold text-[var(--brand)]">Open workspace →</span>
        </Link>)}
    </section>
  </div>;
}
