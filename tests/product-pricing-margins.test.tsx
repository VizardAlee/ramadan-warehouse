// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProductsPage from "@/app/(protected)/products/page";
import { catalogueGrossMarginPercent } from "@/features/products/catalogue-gross-margin";
import { useBranchPriceColumns } from "@/features/products/branch-price-columns";
import { FinancialPrivacyProvider } from "@/features/finance/financial-privacy";
import type { OperatingContext } from "@/features/auth/operating-context";
import type { PermissionId, RoleId } from "@/types/domain";
import type { BranchSalesPrice, CentralSalesPrice } from "../functions/src/sales/pricing";

const state = vi.hoisted(() => ({
  role: "system_administrator" as RoleId,
  permissions: undefined as PermissionId[] | undefined,
  context: { type: "branch", id: "a" } as OperatingContext | null,
  cost: 60000 as number | undefined,
  service: false,
  central: { basePriceMinor: 150000, wholesalePriceMinor: 100000, active: true, version: 2 } as CentralSalesPrice | null,
  branch: { active: true, sellingPriceMinor: 180000, wholesalePriceMinor: 150000, version: 1 } as BranchSalesPrice,
  loading: "",
  error: "",
  localIds: new Set(["p"]),
  collection: vi.fn(),
}));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => {
  const profile = { uid: "user", organizationId: "org", status: "active", roleId: state.role, roleIds: [state.role], effectivePermissions: state.permissions, authorizationVersion: 1, branchIds: ["a"], warehouseIds: [] };
  return { profile, accessProfile: profile, operatingContext: state.context };
} }));
vi.mock("@/features/auth/use-operating-context-options", () => ({ useOperatingContextOptions: () => ({ options: [{ id: "a", name: "Branch A", type: "branch" }, { id: "b", name: "Branch B", type: "branch" }] }) }));
vi.mock("@/features/inventory/use-location-inventory", () => ({ useLocationProductMembership: () => ({ productIds: state.localIds, loading: false, error: null }) }));
vi.mock("@/features/products/catalog-import-dialog", () => ({ CatalogImportDialog: () => null }));
vi.mock("@/features/reports/product-history-preview", () => ({ ProductHistoryPreview: () => <div>History preview</div> }));
vi.mock("@/features/administration/use-organization-collection", () => ({ useOrganizationCollection: (name: string, enabled = true) => {
  state.collection(name, enabled);
  // Deliberately retain data when disabled, so UI guards are independently tested.
  const data = name === "products" ? [{ id: "p", name: "Solar panel", sku: "P", active: true, itemKind: state.service ? "service" : "stock", unitOfMeasure: "unit", trackingType: "quantity" }]
    : name === "productCosts" ? [{ id: "p", productId: "p", defaultUnitCostMinor: state.cost }]
    : name === "productSalesPrices" ? state.central ? [{ id: "p", productId: "p", ...state.central }] : []
    : name === "branchSalesPrices" ? [{ id: "a-p", branchId: "a", productId: "p", ...state.branch }] : [];
  return { data, loading: state.loading === name, error: state.error === name ? "Load failed" : null };
} }));
function marginCell(tier: "Retail" | "Wholesale") { return document.querySelector(`td[data-label="${tier} margin"]`)!; }
function DirectMargin() {
  const columns = useBranchPriceColumns();
  return <>{columns.margin("p", state.central, "retail", { unitCostMinor: state.cost, loading: false, error: null, service: false })}</>;
}
beforeEach(() => {
  state.role = "system_administrator"; state.permissions = undefined; state.context = { type: "branch", id: "a" };
  state.cost = 60000; state.service = false; state.loading = ""; state.error = ""; state.localIds = new Set(["p"]);
  state.central = { basePriceMinor: 150000, wholesalePriceMinor: 100000, active: true, version: 2 };
  state.branch = { active: true, sellingPriceMinor: 180000, wholesalePriceMinor: 150000, version: 1 };
  state.collection.mockClear();
});
afterEach(() => { cleanup(); localStorage.clear(); });

describe("catalogue gross margin", () => {
  it("uses selling price as the denominator, without a 50% cap", () => {
    expect(catalogueGrossMarginPercent(3000, 6000)).toBe(50);
    expect(catalogueGrossMarginPercent(3001, 6000)).toBeCloseTo(49.9833);
    expect(catalogueGrossMarginPercent(155000, 1600000)).toBeCloseTo(90.3125);
    expect(catalogueGrossMarginPercent(1550000, 1600000)).toBeCloseTo(3.125);
    expect(catalogueGrossMarginPercent(6000, 6000)).toBe(0);
    expect(catalogueGrossMarginPercent(9000, 6000)).toBe(-50);
  });
  it("rejects missing, zero, negative and malformed money instead of inventing profit", () => {
    for (const invalid of [undefined, 0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(catalogueGrossMarginPercent(invalid, 1000)).toBeNull();
      expect(catalogueGrossMarginPercent(1000, invalid)).toBeNull();
    }
  });
});

describe("product catalogue pricing margins", () => {
  it("places each margin immediately after its effective branch price and labels the cost basis", () => {
    render(<ProductsPage />);
    const headers = screen.getAllByRole("columnheader").map(cell => cell.textContent);
    expect(headers.slice(7, 11)).toEqual(["Branch retail", "Retail margin", "Branch wholesale", "Wholesale margin"]);
    expect(marginCell("Retail").textContent).toBe("66.7%Branch override");
    expect(marginCell("Wholesale").textContent).toBe("60.0%Branch override");
    expect(screen.getByText(/Estimated gross margins use catalogue default cost/).textContent).toContain("not posted profit");
    fireEvent.click(screen.getByRole("button", { name: "Solar panel" }));
    expect(screen.getByText("History preview").closest("td")?.colSpan).toBe(13);
    fireEvent.click(screen.getByRole("button", { name: "Solar panel" }));
    expect(screen.queryByText("History preview")).toBeNull();
  });
  it("shows high and negative percentages without changing prices", () => {
    state.cost = 15500; state.branch.sellingPriceMinor = 160000;
    const view = render(<ProductsPage />);
    expect(marginCell("Retail").textContent).toContain("90.3%");
    expect(document.querySelector('td[data-label="Branch retail"]')?.textContent).toContain("1,600.00");
    state.cost = 320000; view.rerender(<ProductsPage />);
    expect(marginCell("Retail").textContent).toContain("-100.0%");
  });
  it("uses central fallback for stale below-base approval and resolves each tier separately", () => {
    state.branch = { active: true, sellingPriceMinor: 90000, wholesalePriceMinor: null, version: 1, belowBaseApproved: true, basePriceVersion: 1 };
    const view = render(<ProductsPage />);
    expect(marginCell("Retail").textContent).toBe("60.0%Central fallback");
    expect(marginCell("Wholesale").textContent).toBe("40.0%Central fallback");
    state.branch.basePriceVersion = 2; view.rerender(<ProductsPage />);
    expect(marginCell("Retail").textContent).toBe("33.3%Branch override");
    expect(marginCell("Wholesale").textContent).toBe("40.0%Central fallback");
  });
  it("keeps all-branch results attributed and switches without retaining the previous branch", () => {
    state.context = null;
    const view = render(<ProductsPage />);
    expect(marginCell("Retail").textContent).toBe("Branch A66.7%Branch overrideBranch B60.0%Central fallback");
    state.context = { type: "branch", id: "b" }; view.rerender(<ProductsPage />);
    expect(marginCell("Retail").textContent).toBe("60.0%Central fallback");
    state.context = { type: "warehouse", id: "w" }; view.rerender(<ProductsPage />);
    expect(marginCell("Retail").textContent).toBe("Choose a branch");
  });
  it("supports authorized catalogue products with no local stock", () => {
    state.localIds = new Set(); render(<ProductsPage />);
    expect(screen.queryByRole("button", { name: "Solar panel" })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /Show all catalogue items/ }));
    expect(marginCell("Retail").textContent).toContain("66.7%");
  });
  it("supports valid branch-only pricing and rejects stale branch-only approval", () => {
    state.central = null;
    state.branch = { ...state.branch, belowBaseApproved: true, belowWholesaleApproved: true, basePriceVersion: 0 };
    const view = render(<ProductsPage />);
    expect(marginCell("Retail").textContent).toContain("66.7%");
    state.branch.basePriceVersion = 1; view.rerender(<ProductsPage />);
    expect(marginCell("Retail").textContent).toBe("Unknown");
  });
  it("distinguishes missing and zero costs and does not call service fees 100% profit", () => {
    state.cost = undefined; const view = render(<ProductsPage />);
    expect(marginCell("Retail").textContent).toContain("Unknown");
    state.cost = 0; view.rerender(<ProductsPage />);
    expect(marginCell("Retail").textContent).toContain("Not meaningful");
    state.cost = 60000; state.service = true; view.rerender(<ProductsPage />);
    expect(marginCell("Wholesale").textContent).toContain("Not meaningful");
    expect(view.container.textContent).not.toContain("100.0%");
  });
  it("does not calculate from missing, zero, or inactive effective prices", () => {
    state.branch = {}; state.central = { basePriceMinor: 0, wholesalePriceMinor: null, version: 1, active: true };
    const view = render(<ProductsPage />);
    expect(marginCell("Retail").textContent).toBe("Unknown");
    expect(marginCell("Wholesale").textContent).toBe("Unknown");
    state.central = { basePriceMinor: 150000, wholesalePriceMinor: 100000, version: 1, active: false }; view.rerender(<ProductsPage />);
    expect(marginCell("Retail").textContent).toBe("Unknown");
  });
  it.each(["productCosts", "productSalesPrices", "branchSalesPrices"])("never shows cached estimates while %s is loading or failed", name => {
    state.loading = name; const view = render(<ProductsPage />);
    expect(marginCell("Retail").textContent).toBe("Loading…");
    state.loading = ""; state.error = name; view.rerender(<ProductsPage />);
    expect(marginCell("Retail").textContent).toMatch(/Unable to/);
    expect(marginCell("Retail").textContent).not.toMatch(/\d/);
  });
  it.each(["branch_manager", "sales_cashier", "operations_administrator"] as RoleId[])("does not subscribe to costs or expose margin columns to %s", role => {
    state.role = role; const view = render(<ProductsPage />);
    expect(screen.queryByRole("columnheader", { name: "Retail margin" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Wholesale margin" })).toBeNull();
    expect(document.querySelector('td[data-label="Default cost"]')?.textContent).toBe("Restricted");
    expect(view.container.textContent).not.toContain("66.7%");
    expect(state.collection).toHaveBeenCalledWith("productCosts", false);
  });
  it("also guards a directly rendered margin and removes values immediately on permission revocation", () => {
    state.role = "finance_officer"; const view = render(<DirectMargin />);
    expect(screen.getByText("66.7%")).toBeTruthy();
    state.permissions = ["products.read", "sales.read.all"]; view.rerender(<DirectMargin />);
    expect(screen.getByText("Restricted")).toBeTruthy();
    expect(screen.queryByText("66.7%")).toBeNull();
  });
  it("masks percentages and amounts in financial privacy mode, including DOM attributes", () => {
    const view = render(<FinancialPrivacyProvider organizationId="org" uid="user"><ProductsPage /></FinancialPrivacyProvider>);
    expect(marginCell("Retail").textContent).toContain("••••");
    expect(view.container.innerHTML).not.toContain("66.7%");
    expect(view.container.innerHTML).not.toContain("60.0%");
    expect(view.container.innerHTML).not.toContain("600.00");
  });
});
