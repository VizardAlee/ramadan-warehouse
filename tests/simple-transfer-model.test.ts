import { describe, expect, it } from "vitest";
import {
  pendingStock,
  type StockTransfer,
} from "../functions/src/transfers/simple-model";
import { evaluateSimpleTransfer } from "../functions/src/transfers/validate-simple-transfer";
import { stockTransferExportRows } from "../src/features/transfers/stock-transfer-export";

const transfer: StockTransfer = {
  id: "simple",
  organizationId: "org",
  number: "ST-001",
  status: "completed",
  version: 3,
  sourceLocationId: "warehouse",
  destinationLocationId: "branch",
  sourceName: "=unsafe()",
  destinationName: "Branch",
  destinationBranchId: "branch-unit",
  note: "",
  problemNote: "",
  createdBy: "admin",
  createdAt: "2026-09-06T00:00:00Z",
  updatedAt: "2026-09-06T00:00:00Z",
  items: [
    {
      id: "line",
      productId: "product",
      productName: "Panel",
      sku: "PV",
      trackingType: "quantity",
      serialItemIds: [],
      requested: 20,
      approved: 20,
      received: 12,
      damaged: 0,
      cancelled: 8,
      writtenOff: 0,
    },
  ],
};
const receipts = [
  { id: "receipt", lineId: "line", received: 12, transactionId: "tx" },
];
const entries = [
  {
    id: "out",
    transactionId: "tx",
    productId: "product",
    locationId: "warehouse",
    quantityDelta: -12,
    valueDeltaMinor: -1200,
  },
  {
    id: "in",
    transactionId: "tx",
    productId: "product",
    locationId: "branch",
    quantityDelta: 12,
    valueDeltaMinor: 1200,
  },
];
describe("simple transfer evidence and export", () => {
  it("finishes the transfer without mislabelling cancelled quantity as received", () => {
    expect(pendingStock(transfer.items[0]!)).toBe(0);
    expect(evaluateSimpleTransfer(transfer, receipts, entries).status).toBe(
      "clean",
    );
  });
  it("detects missing receipt evidence and unbalanced values", () => {
    expect(evaluateSimpleTransfer(transfer, [], entries).status).toBe("error");
    expect(
      evaluateSimpleTransfer(transfer, receipts, [
        entries[0]!,
        { ...entries[1]!, valueDeltaMinor: 1199 },
      ]).status,
    ).toBe("error");
  });
  it("exports only supplied rows, neutralizes formulas and omits internal costs", () => {
    const rows = stockTransferExportRows([transfer]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      From: "'=unsafe()",
      Received: 12,
      Cancelled: 8,
      Outstanding: 0,
    });
    expect(rows[0]).not.toHaveProperty("totalValueMinor");
    expect(stockTransferExportRows([])).toEqual([]);
  });
});
