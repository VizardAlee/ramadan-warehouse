import { hasAnyPermission, hasPermission } from "@/lib/permissions/roles";
import type { PermissionId, UserProfile } from "@/types/domain";
import { hasOrganizationWideOperatingAccess } from "@/features/auth/operating-context";

export function canReadCeoView(profile: UserProfile | null | undefined) {
  return Boolean(profile && hasOrganizationWideOperatingAccess(profile) && (hasPermission(profile, "sales.read.all") ||
    (hasPermission(profile, "requests.read.all") && hasPermission(profile, "transfers.read.all"))));
}
export interface CeoDestination { title: string; group: string; detail: string; href: string; permissions: PermissionId[]; all?: PermissionId[] }
/** Viewing a destination never grants its create, approve, edit or delete actions. */
export const ceoDestinations: CeoDestination[] = [
  { title: "Sales, invoices & receipts", group: "Customers & sales", detail: "Sales history, invoice documents, credit sales and export", href: "/reports?family=sales", permissions: ["reports.sales.read"] },
  { title: "Customers & statements", group: "Customers & sales", detail: "Customer balances, individual histories, repayments and advances", href: "/customers", permissions: ["customers.read"] },
  { title: "Checkout & customer collections", group: "Customers & sales", detail: "Orders, payments and goods collection; actions retain their permissions", href: "/pos", permissions: ["sales.create", "sales.order.create", "sales.payment.accept", "sales.payment.confirm", "sales.stock.release"] },
  { title: "Returns & credits", group: "Customers & sales", detail: "Returned goods, credit notes and refunds", href: "/returns", permissions: ["sales.returns.read"] },
  { title: "Services & provider funds", group: "Customers & sales", detail: "Aftersales history, service billing and external-provider liabilities", href: "/aftersales", permissions: ["sales.returns.read"] },
  { title: "Provider funds register", group: "Money & accounts", detail: "Expenses → Provider funds: external-provider liabilities, settlements and recoveries. Choose the register’s date range.", href: "/expenses#provider-funds", permissions: ["expenses.read"] },
  { title: "Products & categories", group: "Stock & movement", detail: "Catalogue, prices, product history and stock thresholds", href: "/products", permissions: ["products.read"] },
  { title: "Product categories", group: "Stock & movement", detail: "Browse catalogue categories", href: "/products/categories", permissions: ["products.read"] },
  { title: "Stock position & low stock", group: "Stock & movement", detail: "Current quantities, reservations and reorder thresholds by location", href: "/inventory", permissions: ["inventory.read"] },
  { title: "Stock movements & history", group: "Stock & movement", detail: "Receipts, issues, transfers and adjustments", href: "/inventory/movements", permissions: ["inventory.read"] },
  { title: "Stock counts & reconciliation", group: "Stock & movement", detail: "Physical counts and differences needing review", href: "/inventory/counts", permissions: ["inventory.count", "inventory.reconcile"] },
  { title: "Stock reconciliation", group: "Stock & movement", detail: "Inventory balances and movement evidence", href: "/inventory/reconciliation", permissions: ["inventory.reconcile"] },
  { title: "Assets & serial numbers", group: "Stock & movement", detail: "Serialized stock and asset history", href: "/inventory/assets", permissions: ["inventory.read"] },
  { title: "Stock receipts", group: "Stock & movement", detail: "Receiving records and authorized receipt workflow", href: "/inventory/receipts", permissions: ["inventory.receive"] },
  { title: "Opening stock", group: "Stock & movement", detail: "Opening quantities and their audit trail", href: "/inventory/opening-stock", permissions: ["inventory.opening_stock"] },
  { title: "Stock adjustments", group: "Stock & movement", detail: "Inventory corrections and reasons", href: "/inventory/adjustments", permissions: ["inventory.adjust"] },
  { title: "Branch requests", group: "Stock & movement", detail: "Requested stock, approvals and request history", href: "/requests", permissions: ["requests.read.all", "requests.read.own_branch"] },
  { title: "Request reports", group: "Insights", detail: "Branch request reporting and exports", href: "/requests/reports", permissions: ["reports.requests.read"] },
  { title: "Transfers & logistics", group: "Stock & movement", detail: "Dispatch, receiving, reservations and discrepancies", href: "/transfers", permissions: ["transfers.read.all", "transfers.read.own_branch", "transfers.read.assigned_warehouse"] },
  { title: "Detailed transfer history", group: "Stock & movement", detail: "Detailed packing and cost reconciliation workflows", href: "/transfers/legacy", permissions: ["transfers.read.all", "transfers.read.assigned_warehouse"] },
  { title: "Transfer reconciliation", group: "Stock & movement", detail: "Movement reconciliation and exceptions", href: "/transfers/reconciliation", permissions: ["transfers.read.all"] },
  { title: "Purchasing & suppliers", group: "Money & accounts", detail: "Purchase orders, supplier invoices, payments, advances and returns", href: "/procurement", permissions: ["procurement.read", "payables.read"] },
  { title: "Expenses", group: "Money & accounts", detail: "Expense obligations, approvals, payment records and history", href: "/expenses", permissions: ["expenses.read"] },
  { title: "Banks & reconciliations", group: "Money & accounts", detail: "Accounts, statement matching and internal transfers", href: "/banking", permissions: ["banking.read"] },
  { title: "Accounting & provider controls", group: "Money & accounts", detail: "Ledger accounts, journals and mixed-billing mappings", href: "/finance", permissions: ["finance.journal.read", "accounting.close.read", "banking.read"] },
  { title: "Financial statements & cash flow", group: "Money & accounts", detail: "Company receipts and payments, profit, liabilities and balances; choose the statement dates and branch", href: "/reports?family=financial", permissions: ["finance.journal.read"] },
  { title: "Budgets & comparisons", group: "Money & accounts", detail: "Reviewed monthly targets, actuals and budget history", href: "/finance", permissions: ["finance.journal.read"] },
  { title: "Month close", group: "Money & accounts", detail: "Closing periods and accounting exceptions", href: "/accounting", permissions: ["accounting.close.read"] },
  { title: "Daily checks", group: "Money & accounts", detail: "Till, stock and daily close evidence", href: "/daily-reconciliation", permissions: ["daily.close.read", "inventory.count", "inventory.reconcile", "sales.shift.manage", "banking.read"] },
  { title: "Transfer costs", group: "Money & accounts", detail: "Transport costs, approvals and reconciliation", href: "/costs", permissions: ["transfers.cost.read", "transfers.cost.create", "transfers.cost.approve", "transfers.cost.reconcile"] },
  { title: "Tax centre", group: "Money & accounts", detail: "Tax rules, coverage and tax reports", href: "/tax", permissions: ["finance.journal.read"], all: ["sales.read.all"] },
  { title: "Inventory & operational reports", group: "Insights", detail: "Stock valuation, movements and report exports", href: "/reports?family=inventory", permissions: ["reports.inventory.read", "reports.requests.read", "reports.transfers.read"] },
  { title: "Audit history", group: "Insights", detail: "Who changed what, when and why", href: "/audit", permissions: ["audit.read"] },
  { title: "People & attendance", group: "People & settings", detail: "Recorded attendance, employee activity and authorized staff details; compensation has separate access", href: "/hr", permissions: ["hr.read"] },
  { title: "Organization settings", group: "People & settings", detail: "Organization profile", href: "/administration/organization", permissions: ["organization.manage"] },
  { title: "Branches", group: "People & settings", detail: "Head office and branch setup", href: "/administration/branches", permissions: ["branch.manage"] },
  { title: "Warehouses", group: "People & settings", detail: "Legacy warehouse setup", href: "/administration/warehouses", permissions: ["warehouse.manage"] },
  { title: "Locations", group: "People & settings", detail: "Stock locations and assignments", href: "/administration/locations", permissions: ["location.manage"] },
  { title: "Users & assignments", group: "People & settings", detail: "Account access and assigned locations", href: "/administration/users", permissions: ["user.manage"] },
  { title: "Roles & permissions", group: "People & settings", detail: "View assigned capabilities; CEO view does not change access", href: "/administration/roles", permissions: ["role.manage"] },
  { title: "Administration", group: "People & settings", detail: "Setup, integrations and authorized maintenance tools", href: "/administration", permissions: ["organization.manage", "branch.manage", "warehouse.manage", "location.manage", "user.manage", "role.manage"] },
  { title: "Notifications", group: "Insights", detail: "Your alerts and tasks", href: "/notifications", permissions: [] },
  { title: "User guide", group: "People & settings", detail: "Workflows, setup and metric meanings", href: "/guide", permissions: [] },
];
export function permittedCeoDestinations(profile: UserProfile, search = "") {
  const term = search.trim().toLowerCase();
  return ceoDestinations.filter(item => (!item.permissions.length || hasAnyPermission(profile, item.permissions)) &&
    (!item.all || item.all.every(permission => hasPermission(profile, permission))) &&
    `${item.title} ${item.group} ${item.detail}`.toLowerCase().includes(term));
}
export function ceoDrilldown(href: string, fromDate: string, toDate: string, branchId: string) {
  const url = new URL(href, "https://warehouse.invalid");
  // Only sales reports currently consume date/branch parameters. Other registers
  // use the normal operating context and expose their own history filters.
  if (url.pathname === "/reports" && url.searchParams.get("family") !== "financial" && url.searchParams.get("family") !== "inventory") {
    url.searchParams.set("fromDate", fromDate); url.searchParams.set("toDate", toDate);
    if (branchId) url.searchParams.set("branchId", branchId);
  }
  return url.pathname + url.search + url.hash;
}
