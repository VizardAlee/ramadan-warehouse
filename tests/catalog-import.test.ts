import { describe, expect, it } from "vitest";
import {
  autoMapCatalogColumns,
  mappedCatalogCsv,
  parseCatalogCsv,
} from "@/features/products/catalog-import";
import { previewCsvImport } from "../functions/src/imports/csv-import";

describe("product catalogue column mapping", () => {
  it("automatically maps familiar external headings to system fields", () => {
    const table = parseCatalogCsv(
      [
        "Item Name,Item Code,Product Category,UOM,Inventory Tracking,Cost,Price,VAT",
        "Inverter,INV-01,Inverters,unit,serial,120000,150000,7.5",
      ].join("\n"),
    );
    const mapping = autoMapCatalogColumns(table.headers);

    expect(mapping).toMatchObject({
      name: 0,
      sku: 1,
      categoryName: 2,
      unitOfMeasure: 3,
      trackingType: 4,
      defaultUnitCostNaira: 5,
      baseSellingPriceNaira: 6,
      vatPercent: 7,
    });
    expect(previewCsvImport("products", mappedCatalogCsv(table, mapping)).valid)
      .toBe(true);
  });

  it("requires the user to map every required system field", () => {
    const table = parseCatalogCsv("Product,Cost\nPanel,100");
    const mapping = autoMapCatalogColumns(table.headers);
    expect(() => mappedCatalogCsv(table, mapping)).toThrow(
      "Unit of measure, Tracking type",
    );
  });

  it("rejects using one imported column for multiple system fields", () => {
    const table = parseCatalogCsv(
      "Product,Unit,Tracking\nPanel,unit,quantity",
    );
    const mapping = autoMapCatalogColumns(table.headers);
    mapping.sku = mapping.name;
    expect(() => mappedCatalogCsv(table, mapping)).toThrow(
      "only one system field",
    );
  });
});
