import type { PermissionId, RoleId } from "@/types/domain";

/** Starting points for unassigned custom roles; never grant a built-in role. */
export const operatingRoles = [
  {
    name: "Salesperson",
    baseRoleId: "sales_cashier",
    description: "Create branch sales for a cashier to collect payment.",
    permissionIds: ["products.read", "inventory.read", "sales.read.own_branch", "sales.shift.manage", "sales.order.create"],
  },
  {
    name: "Cashier",
    baseRoleId: "sales_cashier",
    description: "Collect payment against existing branch sales using your own shift.",
    permissionIds: ["products.read", "inventory.read", "sales.read.own_branch", "sales.shift.manage", "sales.payment.accept"],
  },
  {
    name: "Branch Stock Manager",
    baseRoleId: "branch_manager",
    description: "Count branch stock, request replenishment, receive transfers and report discrepancies.",
    permissionIds: ["products.read", "inventory.read", "inventory.count", "requests.read.own_branch", "requests.create", "requests.update_draft", "requests.submit", "transfers.read.own_branch", "transfers.receive", "transfers.report_discrepancy"],
  },
  {
    name: "Cash & Bank Reconciliation Officer",
    baseRoleId: "finance_officer",
    description: "Company-wide reconciliation preparation and recording returned staff/driver advances. No issue, spend approval, payout, stock changes or journal reversal. Final approvals stay with another authorized user.",
    permissionIds: ["daily.close.read", "daily.close.prepare", "banking.read", "banking.reconcile", "finance.journal.read", "expenses.read", "payables.read", "cash.advances.read", "cash.advances.return"],
  },
] satisfies readonly { name: string; baseRoleId: RoleId; description: string; permissionIds: PermissionId[] }[];
