// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReportsPage from "@/app/(protected)/reports/page";
import RequestReportsPage from "@/app/(protected)/requests/reports/page";
import TaxPage from "@/app/(protected)/tax/page";

const api = vi.hoisted(() => ({ call: vi.fn() }));

vi.mock("@/features/administration/api", () => ({ callAdministration: api.call }));
vi.mock("@/features/administration/use-organization-collection", () => ({
  useOrganizationCollection: () => ({ data: [] }),
}));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({ profile: { status: "active", roleId: "system_administrator", roleIds: ["system_administrator"] } }),
}));

beforeEach(() => {
  api.call.mockReset();
  api.call.mockImplementation(async (name: string, filters: Record<string, string>) => {
    if (name === "generateFinancialStatement")
      return { reportType: filters.reportType, fromDate: filters.fromDate, toDate: filters.toDate, rows: [] };
    if (name === "getTaxWorkspace")
      return { fromDate: filters.fromDate, toDate: filters.toDate, vat: { outputVatMinor: 0, inputVatMinor: 0, calculatedLiabilityMinor: 0, status: "calculated" }, rules: [], statutoryRuleReviewRequired: false };
    return { rows: [], nextCursor: null };
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("automatic reports", () => {
  it("expands an inventory report product before linking to its full history", async () => {
    api.call.mockImplementation(async (name: string) => name === "generateStockPositionReport"
      ? {
          rows: [{
            id: "balance-1",
            productId: "product-1",
            sku: "PANEL-620",
            productName: "620W Solar Panel",
            onHandQuantity: 20,
          }],
          nextCursor: null,
        }
      : { rows: [], nextCursor: null });
    render(<ReportsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Inventory reports" }));

    const product = await screen.findByRole("button", { name: /PANEL-620 — 620W Solar Panel/ });
    expect(product.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("link", { name: /Full product history/ })).toBeNull();
    fireEvent.click(product);
    expect(product.getAttribute("aria-expanded")).toBe("true");
    await waitFor(() => expect(api.call).toHaveBeenCalledWith("generateSkuMovementReport", expect.objectContaining({ productId: "product-1" })));
    const link = screen.getByRole("link", { name: /Full product history/ });
    expect(link.getAttribute("href")).toBe("/products/product-1#movement-history");
    expect(screen.queryByRole("columnheader", { name: "Product Id" })).toBeNull();
  });

  it("loads on entry and refreshes sales, inventory and financial filters without a generate click", async () => {
    render(<ReportsPage />);
    await waitFor(() => expect(api.call).toHaveBeenCalledWith("generateSalesReport", expect.objectContaining({ reportType: "sales_register" })));
    expect(screen.queryByRole("button", { name: /run report/i })).toBeNull();

    fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-09-01" } });
    await waitFor(() => expect(api.call).toHaveBeenCalledWith("generateSalesReport", expect.objectContaining({ fromDate: "2026-09-01" })));

    fireEvent.click(screen.getByRole("button", { name: "Inventory reports" }));
    await waitFor(() => expect(api.call).toHaveBeenCalledWith("generateStockPositionReport", expect.objectContaining({ limit: 50 })));
    fireEvent.change(screen.getByLabelText("Report"), { target: { value: "valuation" } });
    await waitFor(() => expect(api.call).toHaveBeenCalledWith("generateInventoryValuationReport", expect.objectContaining({ limit: 50 })));

    fireEvent.click(screen.getByRole("button", { name: "Financial statements" }));
    await waitFor(() => expect(api.call).toHaveBeenCalledWith("generateFinancialStatement", expect.objectContaining({ reportType: "income_statement" })));
    fireEvent.change(screen.getByLabelText("Statement"), { target: { value: "trial_balance" } });
    await waitFor(() => expect(api.call).toHaveBeenCalledWith("generateFinancialStatement", expect.objectContaining({ reportType: "trial_balance" })));
    expect(screen.queryByRole("button", { name: /generate/i })).toBeNull();
  });

  it("presents financial results as period-specific statements with visible totals", async () => {
    api.call.mockImplementation(async (name: string, filters: Record<string, string>) => {
      if (name !== "generateFinancialStatement") return { rows: [], nextCursor: null };
      if (filters.reportType === "income_statement") return {
        ...filters, rows: [
          { section: "Income", accountName: "Product sales", amountMinor: 500000 },
          { section: "Expenses", accountName: "Operating expenses", amountMinor: 100000 },
        ], incomeMinor: 500000, expenseMinor: 100000, profitMinor: 400000,
      };
      if (filters.reportType === "balance_sheet") return {
        ...filters, rows: [
          { section: "Assets", accountName: "Cash", amountMinor: 500000 },
          { section: "Liabilities", accountName: "Payables", amountMinor: 100000 },
          { section: "Equity", accountName: "Capital", amountMinor: 400000 },
        ], assetsMinor: 500000, liabilitiesMinor: 100000, equityMinor: 400000, balanced: true,
      };
      return { ...filters, rows: [
        { section: "Operating activities", amountMinor: 400000 },
        { section: "Investing activities", amountMinor: -100000 },
        { section: "Financing activities", amountMinor: 0 },
      ], netCashMovementMinor: 300000 };
    });
    render(<ReportsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Financial statements" }));
    expect(await screen.findByText("Product sales")).toBeTruthy();
    expect(screen.getByText("Net profit / (loss)")).toBeTruthy();
    expect(screen.getByText(/For the period/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Print / Save PDF" })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Statement"), { target: { value: "balance_sheet" } });
    expect(await screen.findByText("Total liabilities and equity")).toBeTruthy();
    expect(screen.getByText(/As at/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Statement"), { target: { value: "cash_flow" } });
    expect(await screen.findByText("Net increase / (decrease) in cash")).toBeTruthy();
    expect(screen.getByText("(₦1,000.00)")).toBeTruthy();
  });

  it("does not show an older sales response after filters have changed", async () => {
    const pending: Array<(value: unknown) => void> = [];
    api.call.mockImplementation((name: string) => name === "generateSalesReport"
      ? new Promise((resolve) => pending.push(resolve))
      : Promise.resolve({ rows: [], nextCursor: null }));
    render(<ReportsPage />);
    await waitFor(() => expect(pending).toHaveLength(1));

    fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-09-01" } });
    await waitFor(() => expect(pending).toHaveLength(2));
    const row = (saleNumber: string) => ({
      id: saleNumber, saleNumber, receiptNumber: `REC-${saleNumber}`,
      branchName: "Head Office", customerName: "Walk-in", recordedAt: "2026-09-24T10:00:00Z",
      netAmountMinor: 100, discountAmountMinor: 0, vatAmountMinor: 0,
      grossAmountMinor: 100, creditAmountMinor: 0,
    });
    pending[1]!({ rows: [row("SALE-NEW")], nextCursor: null });
    expect(await screen.findByText("SALE-NEW")).toBeTruthy();
    pending[0]!({ rows: [row("SALE-OLD")], nextCursor: null });
    await waitFor(() => expect(screen.queryByText("SALE-OLD")).toBeNull());
    expect(screen.getByText("SALE-NEW")).toBeTruthy();
  });

  it("updates request reports and tax evidence from their filters", async () => {
    const requestView = render(<RequestReportsPage />);
    await waitFor(() => expect(api.call).toHaveBeenCalledWith("generateBranchRequestReport", expect.objectContaining({ reportType: "register" })));
    fireEvent.change(screen.getByLabelText("Report"), { target: { value: "product_demand" } });
    await waitFor(() => expect(api.call).toHaveBeenCalledWith("generateBranchRequestReport", expect.objectContaining({ reportType: "product_demand" })));
    expect(screen.queryByRole("button", { name: /run report/i })).toBeNull();
    requestView.unmount();

    render(<TaxPage />);
    await waitFor(() => expect(api.call).toHaveBeenCalledWith("getTaxWorkspace", expect.any(Object)));
    fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-08-01" } });
    await waitFor(() => expect(api.call).toHaveBeenCalledWith("getTaxWorkspace", expect.objectContaining({ fromDate: "2026-08-01" })));
    expect(screen.queryByRole("button", { name: "Run" })).toBeNull();
  });
});
