import { describe, expect, it } from "vitest";
import { planPurchaseReclassification, type ReclassificationEvidence, type ReclassificationLine } from "../functions/src/procurement/purchase-reclassification-plan";
function fixture(): ReclassificationEvidence {
  const line = (id: string, quantity: number, unitCostMinor: number, disposition: "external" | "internal"): ReclassificationLine => ({ id, productId: `product-${id}`, trackingType: "quantity", quantity, unitCostMinor, receivedQuantity: quantity, invoicedQuantity: quantity, vatMinor: 0, receiptId: `receipt-${id}`, inventoryTransactionId: `movement-${id}`, disposition,
    ...(disposition === "external" ? { externalSupplierId: "actual-vendor" } : { source: { locationId: "warehouse", balanceVersion: 1, availableQuantity: quantity, unitCostMinor, managementUnitCostMinor: unitCostMinor, alreadyIssued: false } }) });
  const lines = [[line("part-a", 2, 10_000, "internal"), line("part-b", 4, 2_000, "internal"), line("part-c", 6, 3_000, "external")], [line("part-d", 1, 7_000, "external")], [line("part-e", 3, 11_000, "internal"), line("part-f", 7, 13_000, "internal")]];
  return { organizationId: "org", transportMinor: 0, currentPeriodOpen: true, sourceLocationConfirmed: true, sourceNotPreviouslyIssuedConfirmed: true, hasDependentReturnsOrCredits: false,
    invoices: lines.map((items, index) => { const net = items.reduce((s, l) => s + l.quantity * l.unitCostMinor, 0); return { id: `invoice-${index}`, purchaseOrderId: `po-${index}`, purchaseOrderNumber: `PO-TEST-${index + 1}`, organizationId: "org", destinationLocationId: "destination", supplierId: "head-office", status: "approved", netMinor: net, vatMinor: 0, grossMinor: net, outstandingMinor: net, paidMinor: 0, creditedMinor: 0, journalId: `journal-${index}`, journalPosted: true, journalReversed: false, periodOpen: true, lines: items }; }) };
}
describe("historical mixed purchase reclassification preflight (never posts)", () => {
  it("preserves destination quantities and balances the reviewed commercial split", () => {
    const evidence = fixture(), before = JSON.stringify(evidence), result = planPurchaseReclassification(evidence);
    expect(result.blockers).toEqual([]); expect(result.executable).toBe(false);
    expect(result.externalPurchaseMinor).toBe(25_000); expect(result.internalTransferMinor).toBe(152_000);
    expect(result.originalPayableMinor).toBe(177_000); expect(result.destinationQuantityDelta).toBe(0); expect(result.destinationValueDeltaMinor).toBe(0);
    expect(result.sourceIssues.reduce((s, l) => s + l.quantity, 0)).toBe(16); expect(result.originalJournalReversals).toHaveLength(3); expect(result.replacementExternalInvoices).toHaveLength(2);
    expect(JSON.stringify(evidence)).toBe(before); expect(planPurchaseReclassification(evidence)).toEqual(result);
  });
  it.each(["paidMinor", "creditedMinor"] as const)("blocks existing %s", field => { const e = fixture(); e.invoices[0]![field] = 1; expect(planPurchaseReclassification(e).blockers.join()).toContain("payment or credit"); });
  it("reports all missing decisions together", () => { const e = fixture(); e.transportMinor = null; e.sourceLocationConfirmed = false; e.sourceNotPreviouslyIssuedConfirmed = false; delete e.invoices[1]!.lines[0]!.externalSupplierId; expect(planPurchaseReclassification(e).blockers).toHaveLength(4); });
  it("blocks prior source issues, shortages and valuation differences", () => { const e = fixture(), source = e.invoices[0]!.lines[0]!.source!; source.alreadyIssued = true; source.availableQuantity = 0; source.managementUnitCostMinor += 1; const b = planPurchaseReclassification(e).blockers.join(); expect(b).toContain("do not deduct again"); expect(b).toContain("insufficient"); expect(b).toContain("valuation differs"); });
  it("blocks nonzero freight and dependent documents", () => { const e = fixture(); e.transportMinor = 3500000; e.hasDependentReturnsOrCredits = true; expect(planPurchaseReclassification(e).blockers).toHaveLength(2); });
  it("blocks closed periods, reversed journal, prior correction and incomplete receipts", () => { const e = fixture(); e.currentPeriodOpen = false; const i = e.invoices[0]!; i.periodOpen = false; i.journalReversed = true; i.correctionId = "existing"; i.lines[0]!.receivedQuantity = 1; expect(planPurchaseReclassification(e).blockers).toHaveLength(5); });
  it.each([NaN, Infinity, -1, Number.MAX_SAFE_INTEGER, 1.2])("rejects unsafe monetary evidence %s", value => { const e = fixture(); e.invoices[0]!.netMinor = value; expect(() => planPurchaseReclassification(e)).toThrow(); });
  it("rejects duplicate provenance", () => { const e = fixture(); e.invoices[0]!.lines[1]!.receiptId = e.invoices[0]!.lines[0]!.receiptId; expect(() => planPurchaseReclassification(e)).toThrow("Duplicate"); });
  it("rejects cross-organization records", () => { const e = fixture(); e.invoices[1]!.organizationId = "other"; expect(() => planPurchaseReclassification(e)).toThrow("same organization"); });
  it("rejects duplicate purchase order IDs", () => { const e = fixture(); e.invoices[1]!.purchaseOrderId = e.invoices[0]!.purchaseOrderId; expect(() => planPurchaseReclassification(e)).toThrow("duplicate"); });
  it("blocks serial tracking", () => { const e = fixture(); e.invoices[0]!.lines[0]!.trackingType = "serial"; expect(planPurchaseReclassification(e).blockers.join()).toContain("quantity-tracked"); });
  it("rejects duplicate order numbers", () => { const e = fixture(); e.invoices[1]!.purchaseOrderNumber = e.invoices[0]!.purchaseOrderNumber; expect(() => planPurchaseReclassification(e)).toThrow("Unexpected"); });
  it("rejects misclassified mixed invoice lines", () => { const e = fixture(); e.invoices[0]!.lines[0]!.disposition = "external"; expect(() => planPurchaseReclassification(e)).toThrow(); });
  it("rejects changed totals and overlong paths", () => { const e = fixture(); e.invoices[0]!.netMinor += 1; expect(() => planPurchaseReclassification(e)).toThrow("totals"); const f = fixture(); f.invoices[0]!.journalId = "other/doc"; expect(() => planPurchaseReclassification(f)).toThrow("identity"); });
});
