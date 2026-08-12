import { describe, expect, it } from "vitest";
import { previewCsvImport } from "../functions/src/imports/csv-import";

describe("CSV import preview", () => {
  it("rejects duplicate normalized product SKUs", () => {
    const csv = "sku,name,unitOfMeasure,trackingType,defaultUnitCostMinor\ninv-1,Inverter,unit,serial,100\nINV-1,Other,unit,serial,100";
    expect(previewCsvImport("products", csv).errors.some((error) => error.code === "DUPLICATE_SKU")).toBe(true);
  });

  it("rejects an opening balance at a foreign location", () => {
    const csv = "productId,locationId,quantity,unitCostMinor\np1,foreign,2,500";
    const result = previewCsvImport("opening_stock", csv, { locationIds: new Set(["own"]), productTracking: new Map([["p1", "quantity"]]) });
    expect(result.errors.some((error) => error.code === "INVALID_LOCATION")).toBe(true);
  });

  it("rejects duplicate normalized serial numbers", () => {
    const csv = "productId,locationId,serialNumber,unitCostMinor\np1,l1,abc-1,500\np1,l1,ABC-1,500";
    const result = previewCsvImport("serial_numbers", csv, { locationIds: new Set(["l1"]), productTracking: new Map([["p1", "serial"]]) });
    expect(result.errors.some((error) => error.code === "DUPLICATE_SERIAL")).toBe(true);
  });
});
