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
