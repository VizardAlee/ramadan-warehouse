import type { BranchRequest, Product, WarehouseTransfer } from "@/types/domain";

const completedRequestStatuses = new Set([
  "fulfilled",
  "cancelled",
  "closed",
  "rejected",
]);
const completedTransferStatuses = new Set(["closed", "cancelled"]);

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
