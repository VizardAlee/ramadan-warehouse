import { describe, expect, it } from "vitest";
import {
  formatInventoryReportValue,
  humanizeInventoryReportRows,
  inventoryReportColumnLabel,
  readableInventoryCsvRows,
} from "../src/features/reports/inventory-report-presentation";

const lookups = {
  products: { "product-opaque-id": "PV-620W — 620W Solar Panel" },
  locations: { "location-opaque-id": "Igbo Road Branch Stock" },
  branches: { "branch-opaque-id": "Igbo Road Branch" },
  warehouses: { "warehouse-opaque-id": "Igbo Road Warehouse" },
};

describe("inventory report presentation", () => {
  it("replaces internal document identifiers with business-readable names", () => {
    const [row] = humanizeInventoryReportRows(
      [
        {
          id: "balance-opaque-id",
          organizationId: "organization-opaque-id",
          productId: "product-opaque-id",
          sku: "PV-620W",
          productName: "620W Solar Panel",
          locationId: "location-opaque-id",
          branchId: "branch-opaque-id",
          warehouseId: "warehouse-opaque-id",
          onHandQuantity: 12,
        },
      ],
      lookups,
    );

    expect(row).toEqual({
      product: "PV-620W — 620W Solar Panel",
      location: "Igbo Road Branch Stock",
      branch: "Igbo Road Branch",
      warehouse: "Igbo Road Warehouse",
      onHandQuantity: 12,
    });
  });

  it("uses business numbers and concise references when a name is unavailable", () => {
    const [row] = humanizeInventoryReportRows(
      [
        {
          id: "entry-opaque-id",
          transactionId: "transaction-opaque-id",
          transactionNumber: "STOCK-000123",
          stockCountId: "count-opaque-id",
          postedBy: "user-opaque-id",
        },
      ],
      lookups,
    );
    expect(row).toMatchObject({
      transaction: "STOCK-000123",
      stockCount: "Stock count …paque-id",
      postedBy: "User …paque-id",
    });
    expect(row).not.toHaveProperty("transactionId");
    expect(row).not.toHaveProperty("organizationId");
  });

  it("uses readable headings, Naira values and readable CSV fields", () => {
    expect(inventoryReportColumnLabel("averageUnitCostMinor")).toBe(
      "Average Unit Cost",
    );
    expect(formatInventoryReportValue("totalValueMinor", 130_050)).toBe(
      "₦1,300.50",
    );
    expect(readableInventoryCsvRows([{ totalValueMinor: 130_050 }])).toEqual([
      { "Total Value": "₦1,300.50" },
    ]);
  });
});
