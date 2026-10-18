import { describe, expect, it } from "vitest";
import { addCashMovement, cashFlowRows, receiptsPayments, type CashMovement } from "../functions/src/reports/cash-movements";

function transfer(scope: "all" | "source" | "destination") {
  const groups = new Map<string, CashMovement>();
  const journal = { type: "internal_funds_transfer", referenceType: "companyFundsTransfer", referenceId: "shared-transfer", pairedTransfer: true };
  if (scope !== "destination") addCashMovement(groups, { ...journal, id: "source-journal" }, -100000);
  if (scope !== "source") addCashMovement(groups, { ...journal, id: "destination-journal" }, 100000);
  return groups;
}
describe("scoped internal funds in cash statements", () => {
  it("cancels paired journals in consolidated receipts/payments without erasing real receipts", () => {
    const groups = transfer("all");
    expect(receiptsPayments(groups)).toEqual({ rows: [], receiptsMinor: 0, paymentsMinor: 0, netCashMovementMinor: 0 });
    addCashMovement(groups, { id: "customer-receipt", type: "customer_payment" }, 20000);
    expect(receiptsPayments(groups)).toMatchObject({ receiptsMinor: 20000, paymentsMinor: 0, netCashMovementMinor: 20000 });
    expect(cashFlowRows(groups)).toContainEqual({ section: "Operating activities", amountMinor: 20000 });
    expect(cashFlowRows(groups)).toContainEqual({ section: "Store funding transfers", amountMinor: 0 });
  });
  it("shows source-store funding outflow separately from operations", () => {
    const groups = transfer("source");
    expect(receiptsPayments(groups)).toMatchObject({ receiptsMinor: 0, paymentsMinor: 100000, netCashMovementMinor: -100000 });
    expect(cashFlowRows(groups)).toContainEqual({ section: "Operating activities", amountMinor: 0 });
    expect(cashFlowRows(groups)).toContainEqual({ section: "Store funding transfers", amountMinor: -100000 });
  });
  it("shows destination-store funding inflow separately from operations", () => {
    const groups = transfer("destination");
    expect(receiptsPayments(groups)).toMatchObject({ receiptsMinor: 100000, paymentsMinor: 0, netCashMovementMinor: 100000 });
    expect(cashFlowRows(groups)).toContainEqual({ section: "Operating activities", amountMinor: 0 });
    expect(cashFlowRows(groups)).toContainEqual({ section: "Store funding transfers", amountMinor: 100000 });
  });
  it("does not net different transfers or ordinary journals through a shared label", () => {
    const groups = transfer("source");
    addCashMovement(groups, { id: "other", type: "internal_funds_transfer", referenceType: "companyFundsTransfer", referenceId: "other-transfer" }, 100000);
    expect(receiptsPayments(groups)).toMatchObject({ receiptsMinor: 100000, paymentsMinor: 100000, netCashMovementMinor: 0 });
    addCashMovement(groups, { id: "ordinary", type: "loan_receipt", referenceType: "companyFundsTransfer", referenceId: "shared-transfer" }, 500);
    expect(cashFlowRows(groups)).toContainEqual({ section: "Financing activities", amountMinor: 500 });
  });
  it("preserves legacy one-journal transfers and makes repeated report reads side-effect free", () => {
    const groups = new Map<string, CashMovement>(), journal = { id: "legacy", type: "internal_funds_transfer" };
    addCashMovement(groups, journal, -100000); addCashMovement(groups, journal, 100000);
    const before = structuredClone([...groups]);
    expect(receiptsPayments(groups)).toEqual(receiptsPayments(groups));
    expect(receiptsPayments(groups).receiptsMinor).toBe(0);
    expect([...groups]).toEqual(before);
  });
  it("refuses an unlinked paired transfer and unsafe arithmetic rather than inventing totals", () => {
    expect(() => addCashMovement(new Map(), { id: "broken", type: "internal_funds_transfer", pairedTransfer: true }, 100)).toThrow(/shared reference/);
    const groups = new Map<string, CashMovement>();
    addCashMovement(groups, { id: "a", type: "receipt" }, Number.MAX_SAFE_INTEGER);
    expect(() => addCashMovement(groups, { id: "a", type: "receipt" }, 1)).toThrow(/safe/);
    expect(() => addCashMovement(groups, { id: "b", type: "receipt" }, 1.5)).toThrow(/safe/);
  });
});
