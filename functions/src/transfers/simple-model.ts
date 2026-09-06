export interface StockTransferLine {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  trackingType: string;
  lotId?: string;
  lotNumber?: string;
  serialItemIds: string[];
  serialNumbers?: Record<string, string>;
  requested: number;
  approved: number;
  received: number;
  damaged: number;
  cancelled: number;
  writtenOff: number;
  sourceRequestItemId?: string;
}

export interface StockTransfer {
  id: string;
  organizationId: string;
  number: string;
  status:
    | "requested"
    | "awaiting_receipt"
    | "partially_received"
    | "problem"
    | "completed"
    | "cancelled";
  version: number;
  sourceLocationId: string;
  destinationLocationId: string;
  sourceName: string;
  destinationName: string;
  sourceBranchId?: string;
  sourceWarehouseId?: string;
  destinationBranchId: string;
  sourceRequestId?: string;
  note: string;
  problemNote: string;
  createdBy: string;
  approvedBy?: string;
  items: StockTransferLine[];
  createdAt: string;
  updatedAt: string;
}

export function pendingStock(line: StockTransferLine) {
  return (
    line.approved -
    line.received -
    line.damaged -
    line.cancelled -
    line.writtenOff
  );
}

export const stockTransferStatusLabels: Record<
  StockTransfer["status"],
  string
> = {
  requested: "Needs approval",
  awaiting_receipt: "Awaiting receipt",
  partially_received: "Some items still expected",
  problem: "Needs attention",
  completed: "Completed",
  cancelled: "Cancelled",
};
