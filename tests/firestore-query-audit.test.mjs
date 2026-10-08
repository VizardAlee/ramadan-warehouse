import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { queryCatalog, querySourceFingerprints } from "../scripts/firestore-query-catalog.mjs";
import { validateAudit } from "../scripts/validate-firestore-query-audit.mjs";

const baseline = JSON.parse(readFileSync("scripts/firestore-query-audit-baseline.json", "utf8"));
const manifest = JSON.parse(readFileSync("firestore.indexes.json", "utf8"));
const catalog = queryCatalog();
const sources = querySourceFingerprints();
describe("cross-section Firestore index release guard", () => {
  it("accepts the audited source, catalog and index manifest", () => {
    expect(() => validateAudit(baseline, manifest, sources, catalog)).not.toThrow();
  });
  it("requires review when a query-bearing file changes or is added", () => {
    expect(() => validateAudit(baseline, manifest, { ...sources, "new-query.ts": "changed" }, catalog)).toThrow("query source changed");
  });
  it("requires a live audit when the catalog changes", () => {
    expect(() => validateAudit(baseline, manifest, sources, catalog.slice(1))).toThrow("query catalog changed");
  });
  it("rejects removal of an audited index", () => {
    expect(() => validateAudit(baseline, { ...manifest, indexes: manifest.indexes.slice(1) }, sources, catalog)).toThrow("index was removed");
  });
  it("rejects changing an audited index direction", () => {
    const indexes = structuredClone(manifest.indexes);
    const field = indexes[0].fields.at(-1);
    field.order = field.order === "DESCENDING" ? "ASCENDING" : "DESCENDING";
    expect(() => validateAudit(baseline, { ...manifest, indexes }, sources, catalog)).toThrow("index was removed or changed");
  });
  it("covers all inventory-history filters in organization, branch and legacy location scopes", () => {
    const movement = catalog.filter((shape) => shape.sources.includes("inventory history/movement filters"));
    expect(movement).toHaveLength(48);
    expect(movement.some((shape) => ["branchId", "productId", "locationId", "transactionType", "serialNumber"].every((field) => shape.filters.some(([key]) => field === key)))).toBe(true);
  });
  it("covers no-date sales totals, client customer searches, notifications and background jobs", () => {
    expect(catalog.some((shape) => shape.collection === "sales" && shape.sums?.length === 4 && !shape.filters.some(([field]) => field === "recordedAt"))).toBe(true);
    for (const collection of ["customers", "notifications", "employees", "attendanceEvents", "pushDeliveries", "notificationEvents", "integrationOutbox", "saleReturns", "bankStatementTransactions"]) expect(catalog.some((shape) => shape.collection === collection)).toBe(true);
  });
  it("covers supplier statements in organization and legacy location scopes with separate sums", () => {
    const pages = catalog.filter((shape) => shape.sources.includes("supplier statement pages"));
    expect(pages).toHaveLength(12);
    for (const field of ["amountMinor", "advanceAmountMinor"]) {
      expect(catalog.filter((shape) => shape.sources.includes("supplier statement separate totals") && shape.sums?.[0] === field)).toHaveLength(12);
      expect(catalog.filter((shape) => shape.sources.includes("supplier statement opening balance") && shape.sums?.[0] === field)).toHaveLength(3);
    }
  });
  it("covers supplier unpaid pages, full totals and dated aging in every supported scope", () => {
    for (const source of ["supplier unpaid invoice pages", "supplier unpaid totals", "supplier payable aging"])
      expect(catalog.filter((shape) => shape.sources.includes(source))).toHaveLength(3);
  });
  it("covers receiving history and its original stock ledger evidence", () => {
    expect(catalog.filter((shape) => shape.sources.includes("purchase receipt history"))).toHaveLength(1);
    expect(catalog.filter((shape) => shape.sources.includes("purchase receipt stock evidence"))).toHaveLength(1);
  });
});
