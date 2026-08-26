export interface WorkflowStep {
  title: string;
  detail: string;
  href?: string;
}

export const setupWorkflowSteps: readonly WorkflowStep[] = [
  {
    title: "Locations",
    detail: "Create warehouses and stores/branches as separate places.",
    href: "/administration",
  },
  {
    title: "Catalogue",
    detail: "Add products, central prices, VAT, and tracking rules.",
    href: "/products",
  },
  {
    title: "Opening stock",
    detail:
      "Count existing stock into the warehouse or branch where it is physically held.",
    href: "/inventory/opening-stock",
  },
  {
    title: "People",
    detail: "Invite users and assign only their real roles and locations.",
    href: "/administration/users",
  },
];

export const transferWorkflowSteps: readonly WorkflowStep[] = [
  {
    title: "Create",
    detail: "Start from an approved branch request or a direct allocation.",
    href: "/transfers",
  },
  {
    title: "Approve",
    detail: "A different authorized person reviews quantities and route.",
    href: "/transfers/review",
  },
  {
    title: "Reserve",
    detail: "Lock available warehouse stock to this transfer.",
    href: "/transfers/reservations",
  },
  {
    title: "Pick & verify",
    detail: "Warehouse staff collect the reserved goods and confirm the pick.",
    href: "/transfers/picking",
  },
  {
    title: "Pack & verify",
    detail: "Package the picked goods and independently verify the package.",
    href: "/transfers/packing",
  },
  {
    title: "Dispatch",
    detail:
      "Confirm goods leaving the warehouse; dispatched quantities become immutable.",
    href: "/transfers/dispatch",
  },
  {
    title: "Receive",
    detail:
      "The destination branch records received, damaged, or missing quantities.",
    href: "/transfers/incoming",
  },
  {
    title: "Reconcile & close",
    detail:
      "Resolve discrepancies and costs, then validate and close the movement.",
    href: "/transfers/reconciliation",
  },
];

export const salesWorkflowSteps: readonly WorkflowStep[] = [
  {
    title: "Price & stock",
    detail: "Set the central price and ensure saleable stock exists at the branch.",
    href: "/products",
  },
  {
    title: "Open shift",
    detail: "The cashier records the real opening cash before selling.",
    href: "/pos",
  },
  {
    title: "Sell",
    detail: "Select products and payment; VAT remains separate from the net price.",
    href: "/pos",
  },
  {
    title: "Documents",
    detail: "The posted sale produces its controlled receipt and invoice evidence.",
    href: "/reports",
  },
  {
    title: "After-sale",
    detail:
      "Use the original receipt for returns, refunds, exchanges, or approved credit.",
    href: "/returns",
  },
  {
    title: "Reconcile",
    detail: "Download reports, reconcile banking, and complete the monthly close.",
    href: "/accounting",
  },
];
