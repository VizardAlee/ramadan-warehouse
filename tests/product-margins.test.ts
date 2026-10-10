import { describe, expect, it } from "vitest";
import { addProductMargin, type MarginItem, type ProductMargin } from "../functions/src/reports/product-margins";
import { budgetInput, budgetMonths } from "../functions/src/accounting/budgets";
import { rowsToCsv } from "../src/features/inventory/format";
const item: MarginItem = { id: "line", productId: "product", sku: "P1", productName: "Part", quantity: 4, netAmountMinor: 10000, costAmountMinor: 4000 };
describe("recorded product margins", () => {
  it("nets only actual restock credits and keeps damaged return costs", () => {
    const rows = new Map<string, ProductMargin>();
    addProductMargin(rows, item, [
      { saleItemId: "line", quantity: 1, netAmountMinor: 2500, costAmountMinor: 1000, restockable: true, cancellation: false },
      { saleItemId: "line", quantity: 1, netAmountMinor: 2500, costAmountMinor: 1000, restockable: false, cancellation: false },
    ]);
    expect(rows.get("product")).toMatchObject({ netSalesMinor: 5000, netRecordedCostMinor: 3000, grossMarginMinor: 2000, reversedQuantity: 2 });
  });
  it("never treats a missing cost or pending collection as a zero-cost profit", () => {
    for (const line of [{ ...item, costAmountMinor: undefined }, { ...item, costAmountMinor: 1000, collectionTracked: true, collectedQuantity: 1 }, { ...item, costEvidenceComplete: false }]) {
      const rows = new Map<string, ProductMargin>(); addProductMargin(rows, line, []);
      expect(rows.get("product")).toMatchObject({ unknownCostLines: 1, grossMarginMinor: null });
    }
  });
  it("allows explicit recorded zero costs, and cancellations never reverse unissued cost", () => {
    const rows = new Map<string, ProductMargin>();
    addProductMargin(rows, { ...item, costAmountMinor: 0, collectionTracked: true, collectedQuantity: 0, cancelledQuantity: 4 }, [{ saleItemId: "line", quantity: 4, netAmountMinor: 10000, costAmountMinor: 4000, restockable: true, cancellation: true }]);
    expect(rows.get("product")).toMatchObject({ netSalesMinor: 0, netRecordedCostMinor: 0, grossMarginMinor: 0 });
  });
  it("aggregates products across invoices without losing the unknown flag", () => {
    const rows = new Map<string, ProductMargin>();
    addProductMargin(rows, item, []); addProductMargin(rows, { ...item, id: "second", costAmountMinor: undefined }, []);
    expect(rows.get("product")).toMatchObject({ invoicedQuantity: 8, netSalesMinor: 20000, recordedCostMinor: 4000, grossMarginMinor: null });
  });
  it("keeps provider charges outside company margin and consumed service costs after a credit", () => {
    const rows = new Map<string, ProductMargin>(); addProductMargin(rows, { ...item, itemKind: "service", providerOriginalMinor: 500, providerCreditedMinor: 200 }, [{ saleItemId: item.id, quantity: 1, netAmountMinor: 2500, costAmountMinor: 0, restockable: false, cancellation: false }]);
    expect(rows.get("product")).toMatchObject({ itemKind: "service", netSalesMinor: 7500, netRecordedCostMinor: 4000, grossMarginMinor: 3500, providerNetMinor: 300 });
  });
  it("rejects corrupt totals, excess returns, invalid collection evidence and overflow", () => {
    expect(() => addProductMargin(new Map(), item, [{ saleItemId: "line", quantity: 5, netAmountMinor: 10000, restockable: false, cancellation: false }])).toThrow();
    expect(() => addProductMargin(new Map(), { ...item, collectionTracked: true }, [])).toThrow();
    expect(() => addProductMargin(new Map(), { ...item, netAmountMinor: -1 }, [])).toThrow();
    const rows = new Map<string, ProductMargin>(); addProductMargin(rows, { ...item, netAmountMinor: Number.MAX_SAFE_INTEGER }, []);
    expect(() => addProductMargin(rows, item, [])).toThrow();
  });
});
it("bounds multi-month comparisons and crosses year boundaries", () => {
  expect(budgetMonths("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  expect(budgetInput.safeParse({ action: "comparison", fromMonth: "2026-01", toMonth: "2027-01" }).success).toBe(false);
  expect(budgetInput.safeParse({ action: "comparison", fromMonth: "2026-12", toMonth: "2026-01" }).success).toBe(false);
  expect(budgetInput.safeParse({ action: "comparison", fromMonth: "2026-01", toMonth: "2026-12" }).success).toBe(true);
});
it("protects text cells from spreadsheet formula execution while preserving numeric losses", () => {
  expect(rowsToCsv([{ employee: " =1+1", activity: "@SUM(1)", margin: -100 }])).toContain('"\' =1+1","\'@SUM(1)","-100"');
});
