import type { OperatingContext } from "@/features/auth/operating-context";
import type { BranchRequest, Product } from "@/types/domain";
export interface DashboardTransfer {
  status: string;
  originWarehouseId?: string;
  destinationBranchId: string;
  sourceBranchId?: string;
}
export interface DashboardSale {
  id: string;
  recordedAt: string;
  grossAmountMinor: number;
  amountPaidMinor: number;
  creditAmountMinor: number;
  vatAmountMinor: number;
  discountAmountMinor?: number;
  totalQuantity: number;
}

const completedRequestStatuses = new Set([
  "fulfilled",
  "cancelled",
  "closed",
  "rejected",
]);
const completedTransferStatuses = new Set(["closed", "cancelled", "completed"]);

export function scopeDashboardRecords(
  requests: readonly BranchRequest[],
  transfers: readonly DashboardTransfer[],
  context: OperatingContext | null,
) {
  if (!context) return { requests, transfers };
  if (context.type === "branch") {
    return {
      requests: requests.filter((request) => request.branchId === context.id),
      transfers: transfers.filter(
        (transfer) =>
          transfer.destinationBranchId === context.id ||
          transfer.sourceBranchId === context.id,
      ),
    };
  }
  return {
    requests,
    transfers: transfers.filter(
      (transfer) => transfer.originWarehouseId === context.id,
    ),
  };
}

export function summarizeDashboard(
  requests: readonly BranchRequest[],
  transfers: readonly DashboardTransfer[],
  products: readonly Product[],
) {
  return {
    requests: requests.filter(
      (request) => !completedRequestStatuses.has(request.status),
    ).length,
    transfers: transfers.filter(
      (transfer) => !completedTransferStatuses.has(transfer.status),
    ).length,
    products: products.filter((product) => product.active).length,
    discrepancies: transfers.filter((transfer) =>
      ["disputed", "problem"].includes(transfer.status),
    ).length,
  };
}

const transferStageStatuses: Readonly<Record<string, ReadonlySet<string>>> = {
  Review: new Set([
    "draft",
    "submitted",
    "under_review",
    "changes_requested",
    "requested",
  ]),
  Preparation: new Set([
    "approved",
    "partially_reserved",
    "reserved",
    "picking",
    "partially_picked",
    "picked",
    "packing",
    "packed",
    "ready_for_dispatch",
  ]),
  "In transit": new Set(["partially_dispatched", "dispatched"]),
  "Receiving & issues": new Set([
    "awaiting_receipt",
    "problem",
    "partially_received",
    "received",
    "disputed",
    "cost_reconciliation",
  ]),
} as const;

export function summarizeTransferPipeline(
  transfers: readonly DashboardTransfer[],
) {
  return Object.entries(transferStageStatuses).map(([label, statuses]) => ({
    label,
    value: transfers.filter((transfer) => statuses.has(transfer.status)).length,
  }));
}

export function summarizeSales(sales: readonly DashboardSale[]) {
  return sales.reduce(
    (summary, sale) => ({
      saleCount: summary.saleCount + 1,
      grossAmountMinor: summary.grossAmountMinor + sale.grossAmountMinor,
      amountPaidMinor: summary.amountPaidMinor + sale.amountPaidMinor,
      creditAmountMinor: summary.creditAmountMinor + sale.creditAmountMinor,
      vatAmountMinor: summary.vatAmountMinor + sale.vatAmountMinor,
      discountAmountMinor:
        summary.discountAmountMinor + (sale.discountAmountMinor ?? 0),
      totalQuantity: summary.totalQuantity + sale.totalQuantity,
    }),
    {
      saleCount: 0,
      grossAmountMinor: 0,
      amountPaidMinor: 0,
      creditAmountMinor: 0,
      vatAmountMinor: 0,
      discountAmountMinor: 0,
      totalQuantity: 0,
    },
  );
}

export function summarizeSalesByDay(
  sales: readonly DashboardSale[],
  days = 7,
  today = new Date(),
) {
  const dayKeys = Array.from({ length: days }, (_, index) => {
    const date = new Date(today);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - (days - index - 1));
    return date.toISOString().slice(0, 10);
  });
  return dayKeys.map((date) => {
    const matching = sales.filter((sale) => sale.recordedAt.slice(0, 10) === date);
    return {
      date,
      label: new Date(`${date}T00:00:00.000Z`).toLocaleDateString("en-NG", {
        weekday: "short",
      }),
      value: matching.reduce((sum, sale) => sum + sale.grossAmountMinor, 0),
      count: matching.length,
    };
  });
}

export function summarizeSalesPaymentMix(sales: readonly DashboardSale[]) {
  return [
    {
      label: "Paid in full",
      value: sales.filter((sale) => sale.creditAmountMinor === 0).length,
      color: "#34458f",
    },
    {
      label: "Part-paid",
      value: sales.filter(
        (sale) => sale.creditAmountMinor > 0 && sale.amountPaidMinor > 0,
      ).length,
      color: "#f6b333",
    },
    {
      label: "On credit",
      value: sales.filter(
        (sale) => sale.creditAmountMinor > 0 && sale.amountPaidMinor === 0,
      ).length,
      color: "#c8563d",
    },
  ];
}
