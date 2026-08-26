import type { OperatingContext } from "@/features/auth/operating-context";
import type { BranchRequest, Product, WarehouseTransfer } from "@/types/domain";

const completedRequestStatuses = new Set([
  "fulfilled",
  "cancelled",
  "closed",
  "rejected",
]);
const completedTransferStatuses = new Set(["closed", "cancelled"]);

export function scopeDashboardRecords(
  requests: readonly BranchRequest[],
  transfers: readonly WarehouseTransfer[],
  context: OperatingContext | null,
) {
  if (!context) return { requests, transfers };
  if (context.type === "branch") {
    return {
      requests: requests.filter((request) => request.branchId === context.id),
      transfers: transfers.filter(
        (transfer) => transfer.destinationBranchId === context.id,
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
  transfers: readonly WarehouseTransfer[],
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
    discrepancies: transfers.filter((transfer) => transfer.status === "disputed")
      .length,
  };
}

const transferStageStatuses: Readonly<Record<string, ReadonlySet<string>>> = {
  Review: new Set(["draft", "submitted", "under_review", "changes_requested"]),
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
    "partially_received",
    "received",
    "disputed",
    "cost_reconciliation",
  ]),
} as const;

export function summarizeTransferPipeline(
  transfers: readonly WarehouseTransfer[],
) {
  return Object.entries(transferStageStatuses).map(([label, statuses]) => ({
    label,
    value: transfers.filter((transfer) => statuses.has(transfer.status))
      .length,
  }));
}
