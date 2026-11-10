"use client";

import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { useAuth } from "@/features/auth/auth-context";
import { DashboardLocationSwitcher } from "@/features/dashboard/location-switcher";
import { hasPermission, permissionsForRoles, roleIdsForProfile } from "@/lib/permissions/roles";
import type { OperatingContext } from "@/features/auth/operating-context";
import { permissionIds, type PermissionId, type RoleId, type UserProfile } from "@/types/domain";

type Profile = Parameters<typeof hasPermission>[0];
const purchasingPermissions = new Set<PermissionId>([
  "products.read", "suppliers.read", "suppliers.manage", "procurement.read",
  "procurement.create", "procurement.approve", "procurement.receive",
  "payables.read", "payables.create", "payables.approve",
  "inventory.read", "transfers.read.all", "transfers.create.direct", "transfers.create.from_request",
  "transfers.approve", "transfers.receive", "transfers.report_discrepancy", "transfers.resolve_discrepancy", "transfers.cancel",
]);

/** Effective grants decide the landing page, so mixed-role users keep their workspace. */
export function isPurchasingOnlyProfile(profile: Profile): boolean {
  return roleIdsForProfile(profile).includes("purchasing_manager") &&
    hasPermission(profile, "procurement.read") &&
    !permissionIds.some(permission => !purchasingPermissions.has(permission) && hasPermission(profile, permission));
}

const globalRoles: readonly RoleId[] = ["system_administrator", "operations_administrator", "finance_officer", "auditor"];
const branchRoles: readonly RoleId[] = ["branch_manager", "branch_requester", "sales_cashier", "logistics_officer"];

/** Use immutable assignments, never the UI profile narrowed to the selected location.
 * Custom-role unions do not prove which role supplied an overlapping permission.
 * Outside assignments, retain the generic dashboard only with independently
 * provable organization-wide grants for every generic data section it will fetch.
 */
export function shouldShowPurchasingDashboard(profile: Profile, authority: UserProfile | null | undefined, context: OperatingContext | null): boolean {
  if (isPurchasingOnlyProfile(profile)) return true;
  if (!roleIdsForProfile(profile).includes("purchasing_manager") || !hasPermission(profile, "procurement.read") || !context) return false;
  if (!authority) return true;
  const roles = roleIdsForProfile(authority);
  const local = roles.filter(role => context.type === "branch" ? branchRoles.includes(role) : role === "warehouse_manager" || role === "warehouse_officer");
  if ((context.type === "branch" ? authority.branchIds : authority.warehouseIds).includes(context.id) && [...permissionsForRoles(local)].some(permission => !purchasingPermissions.has(permission) && hasPermission(profile, permission))) return false;

  const direct = authority.directRoleIds ?? (authority.customRoleIds?.length || authority.effectivePermissions ? [] : roles);
  const directGlobal = permissionsForRoles(direct.filter(role => globalRoles.includes(role)));
  const possibleGlobal = permissionsForRoles(roles.filter(role => globalRoles.includes(role)));
  const possibleLocal = permissionsForRoles(roles.filter(role => !globalRoles.includes(role)));
  const provenGlobal = (permission: PermissionId) => hasPermission(profile, permission) &&
    (directGlobal.has(permission) || possibleGlobal.has(permission) && !possibleLocal.has(permission));
  const can = (permissions: PermissionId[]) => permissions.some(permission => hasPermission(profile, permission));
  const required: PermissionId[] = [
    ...(can(["requests.read.all", "requests.read.own_branch"]) ? ["requests.read.all" as const] : []),
    ...(can(["transfers.read.all", "transfers.read.own_branch", "transfers.read.assigned_warehouse"]) ? ["transfers.read.all" as const] : []),
    ...(hasPermission(profile, "reports.sales.read") ? ["reports.sales.read", "sales.read.all"] as const : []),
  ];
  return required.length === 0 || !required.every(provenGlobal);
}

const workflows: readonly { title: string; detail: string; href: string; permission: PermissionId }[] = [
  { title: "Stock transfers", detail: "Manage authorized stock transfers between warehouses and branches.", href: "/transfers", permission: "transfers.read.all" },
  { title: "Stock records", detail: "View stock without making direct adjustments.", href: "/inventory", permission: "inventory.read" },
  { title: "Purchase orders", detail: "Review drafts, submitted orders and approved purchases for the selected location.", href: "/procurement#purchase-orders", permission: "procurement.read" },
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
    <DashboardLocationSwitcher description="Purchasing registers follow the selected location. Your authorized roles and actions do not change when you switch the view." />
    <p className="rounded-xl border bg-white p-4 text-sm text-[var(--muted)]">
      {operatingContext
        ? "Purchasing registers follow your selected location. Switch locations above to handle purchases for another store."
        : "Select a branch or warehouse above before opening its purchasing registers."}
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
