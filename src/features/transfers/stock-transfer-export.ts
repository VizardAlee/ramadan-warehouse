import {
  pendingStock,
  stockTransferStatusLabels,
  type StockTransfer,
} from "../../../functions/src/transfers/simple-model";

/** Export only already-authorized, currently displayed rows; never internal costs. */
export function stockTransferExportRows(transfers: readonly StockTransfer[]) {
  return transfers.flatMap((t) =>
    t.items.map((item) =>
      Object.fromEntries(
        Object.entries({
          Transfer: t.number,
          From: t.sourceName,
          To: t.destinationName,
          Status: stockTransferStatusLabels[t.status],
          "Supply route": t.tradeAgreement ? "Internal head-office supply" : "Inventory movement",
          "Internal pricing": t.tradeAgreement?.pricingStatus ?? "Not applicable",
          Product: item.productName,
          SKU: item.sku,
          Requested: item.requested,
          Approved: item.approved,
          Received: item.received,
          Damaged: item.damaged,
          Cancelled: item.cancelled,
          Lost: item.writtenOff,
          Outstanding: pendingStock(item),
          Created: t.createdAt,
        }).map(([key, value]) => [
          key,
          typeof value === "string" && /^[\s]*[=+@\-\t\r\n]/.test(value)
            ? `'${value}`
            : value,
        ]),
      ),
    ),
  );
}
