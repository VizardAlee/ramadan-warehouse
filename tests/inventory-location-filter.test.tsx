// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InventoryPage from "@/app/(protected)/inventory/page";
import ProductsPage from "@/app/(protected)/products/page";
import type { InventoryBalance, InventoryLocation, Product, UserProfile } from "@/types/domain";

const mocks = vi.hoisted(() => ({ call: vi.fn(), metadata: vi.fn(), auth: {} as Record<string, unknown>, locations: [] as InventoryLocation[], products: [] as Product[], balances: [] as InventoryBalance[], loading: false }));
vi.mock("@/features/administration/api", () => ({ callAdministration: mocks.call }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/features/administration/use-organization-collection", () => ({
  useOrganizationCollection: (name: string, enabled = true, scope?: { field: string; id: string }) => {
    mocks.metadata(name, enabled, scope);
    return { data: name === "inventoryLocations" ? mocks.locations : name === "products" ? mocks.products : [], loading: name === "inventoryLocations" && mocks.loading, error: null };
  },
}));
const administrator = { uid: "admin", organizationId: "org", status: "active", roleId: "system_administrator", roleIds: ["system_administrator"], branchIds: [], warehouseIds: [], authorizationVersion: 1 } as unknown as UserProfile;
function select(id: string | null, type = "branch", profile = administrator) {
  mocks.auth = { profile, accessProfile: profile, operatingContext: id ? { type, id } : null };
}
function balance(id: string, productId: string, locationId: string, quantity = 1, value = 100): InventoryBalance {
  return { id, productId, sku: productId.toUpperCase(), locationId, onHandQuantity: quantity, reservedQuantity: 0, availableQuantity: quantity, totalValueMinor: value, averageUnitCostMinor: quantity ? value / quantity : 0 } as InventoryBalance;
}
const stockA = balance("a", "panel", "stock-a", 5, 500);
const stockB = balance("b", "battery", "stock-b", 2, 900);
interface Input { locationIds?: string[]; locationId?: string; cursor?: string; limit?: number; view?: string; withSummary?: boolean }
function positionResponse(input: Input) {
  const all = mocks.balances.filter((row) => !input.locationIds || input.locationIds.includes(row.locationId)).sort((a, b) => a.id < b.id ? -1 : 1);
  const offset = input.cursor ? all.findIndex((row) => row.id === input.cursor) + 1 : 0;
  const limit = input.limit ?? 25;
  const rows = all.slice(offset, offset + limit);
  const summary = input.view !== "membership" && input.withSummary !== false ? all.reduce((s, row) => ({ count: s.count + 1, onHandQuantity: s.onHandQuantity + row.onHandQuantity, reservedQuantity: s.reservedQuantity + row.reservedQuantity, availableQuantity: s.availableQuantity + row.availableQuantity, valueMinor: s.valueMinor + (row.totalValueMinor ?? 0) }), { count: 0, onHandQuantity: 0, reservedQuantity: 0, availableQuantity: 0, valueMinor: 0 }) : null;
  return { rows: input.view === "membership" ? rows.map(({ id, productId }) => ({ id, productId })) : rows, summary, nextCursor: offset + rows.length < all.length ? rows.at(-1)!.id : null };
}
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.clearAllMocks(); select("a"); mocks.loading = false;
  mocks.locations = [{ id: "stock-a", branchId: "a", name: "Store A stock" }, { id: "damaged-a", branchId: "a", name: "Store A damaged" }, { id: "stock-b", branchId: "b", name: "Store B stock" }, { id: "legacy-a", warehouseId: "a", name: "Legacy warehouse A" }, { id: "empty", branchId: "empty", name: "Empty store" }] as InventoryLocation[];
  mocks.products = ["panel", "battery", "zero", "never"].map((id) => ({ id, name: id, sku: id.toUpperCase(), active: true, trackingType: "quantity", unitOfMeasure: "unit" })) as Product[];
  mocks.balances = [stockA, stockB, balance("zero", "zero", "stock-a", 0, 0), balance("warehouse", "warehouse-only", "legacy-a")];
  mocks.call.mockImplementation(async (name: string, input: Input) => name === "getSkuMovementHistory" ? { rows: [] } : positionResponse(input));
});
afterEach(cleanup);

describe("selected Store/Warehouse inventory", () => {
  it("requests metadata by the selected entity field without merging same-ID Store/warehouse identities", async () => {
    const view = render(<InventoryPage />); expect(await screen.findByText("PANEL")).toBeTruthy();
    expect(mocks.metadata).toHaveBeenCalledWith("inventoryLocations", true, { field: "branchId", id: "a" });
    select("a", "warehouse"); view.rerender(<InventoryPage />); expect(await screen.findByText("WAREHOUSE-ONLY")).toBeTruthy();
    expect(mocks.metadata).toHaveBeenCalledWith("inventoryLocations", true, { field: "warehouseId", id: "a" });
    view.unmount(); select(null); render(<ProductsPage />); expect(await screen.findByRole("button", { name: "never" })).toBeTruthy();
    expect(mocks.metadata).toHaveBeenCalledWith("inventoryLocations", true, undefined);
  });
  it("keeps zero-stock membership, excludes never-local products and scopes inline history", async () => {
    render(<ProductsPage />);
    expect(await screen.findByRole("button", { name: "panel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "zero" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "battery" })).toBeNull();
    expect(screen.queryByRole("button", { name: "never" })).toBeNull();
    expect(screen.getByText("1–2 of 2 products")).toBeTruthy();
    expect(mocks.call).toHaveBeenCalledWith("generateStockPositionReport", expect.objectContaining({ locationIds: ["damaged-a", "stock-a"], view: "membership", limit: 500, withSummary: false, includeCosts: false }));
    fireEvent.click(screen.getByRole("button", { name: "panel" }));
    await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("getSkuMovementHistory", expect.objectContaining({ productId: "panel", locationId: "stock-a" })));
  });
  it("loads a single bounded page and obtains whole-location totals rather than summing that page", async () => {
    mocks.balances = Array.from({ length: 26 }, (_, i) => balance(`a-${String(i).padStart(2, "0")}`, `panel-${i}`, "stock-a", 2, 200));
    render(<InventoryPage />);
    expect(await screen.findByText("1–25 of 26 inventory positions")).toBeTruthy();
    expect(screen.getAllByText("52", { selector: "article p" })).toHaveLength(2);
    expect(screen.getByText("₦52.00", { selector: "article p" })).toBeTruthy();
    expect(mocks.call).toHaveBeenCalledTimes(1);
    expect(mocks.call).toHaveBeenLastCalledWith("generateStockPositionReport", expect.objectContaining({ limit: 25, withSummary: true, view: "positions" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("26–26 of 26 inventory positions")).toBeTruthy();
    expect(mocks.call).toHaveBeenCalledTimes(2);
    expect(mocks.call).toHaveBeenLastCalledWith("generateStockPositionReport", expect.objectContaining({ cursor: "a-24", limit: 25, withSummary: false }));
  });
  it("uses projected 500-row membership pages without requiring balance amounts or aggregates", async () => {
    mocks.products = Array.from({ length: 501 }, (_, i) => ({ ...mocks.products[0]!, id: `p-${i}`, name: `product-${i}` }));
    mocks.balances = mocks.products.map((p, i) => balance(`b-${String(i).padStart(3, "0")}`, p.id, "stock-a"));
    render(<ProductsPage />);
    expect(await screen.findByText("1–25 of 501 products")).toBeTruthy();
    expect(mocks.call).toHaveBeenCalledTimes(2);
    for (const call of mocks.call.mock.calls) expect(call[1]).toMatchObject({ view: "membership", limit: 500, withSummary: false, includeCosts: false });
  });
  it("shows loading while location mappings load and never falls back to All locations", async () => {
    mocks.loading = true; const view = render(<InventoryPage />);
    expect(screen.getByText("Loading inventory…")).toBeTruthy(); expect(mocks.call).not.toHaveBeenCalled();
    mocks.loading = false; view.rerender(<InventoryPage />); expect(await screen.findByText("PANEL")).toBeTruthy();
  });
  it("handles mapped-empty and unmapped stores without unfiltered requests", async () => {
    select("empty"); const view = render(<InventoryPage />);
    expect(await screen.findByText("No inventory history at this location.")).toBeTruthy();
    expect(screen.getByText("0 inventory positions")).toBeTruthy();
    expect(mocks.call).toHaveBeenCalledWith("generateStockPositionReport", expect.objectContaining({ locationIds: ["empty"] }));
    view.unmount(); mocks.call.mockClear(); select("unmapped"); render(<InventoryPage />);
    expect(screen.getByText("No inventory history at this location.")).toBeTruthy(); expect(mocks.call).not.toHaveBeenCalled();
  });
  it("clears rows and discards a late response when switching A to B", async () => {
    const old = deferred(); mocks.call.mockReturnValueOnce(old.promise);
    const view = render(<InventoryPage />); select("b"); view.rerender(<InventoryPage />);
    expect(await screen.findByText("BATTERY")).toBeTruthy();
    await act(async () => old.resolve(positionResponse({ locationIds: ["stock-a"] })));
    expect(screen.queryByText("PANEL")).toBeNull(); expect(screen.getByText("BATTERY")).toBeTruthy(); expect(mocks.call).toHaveBeenCalledTimes(2);
  });
  it("resets pagination immediately through A -> B -> A", async () => {
    mocks.balances = Array.from({ length: 26 }, (_, i) => balance(`a-${String(i).padStart(2, "0")}`, `panel-${i}`, "stock-a"));
    const view = render(<InventoryPage />); expect(await screen.findByText("1–25 of 26 inventory positions")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" })); expect(await screen.findByText("26–26 of 26 inventory positions")).toBeTruthy();
    const b = deferred(); const a = deferred(); mocks.call.mockReturnValueOnce(b.promise).mockReturnValueOnce(a.promise);
    select("b"); view.rerender(<InventoryPage />); expect(screen.queryByText("PANEL-25")).toBeNull();
    select("a"); view.rerender(<InventoryPage />); expect(screen.getByText("Loading inventory…")).toBeTruthy();
    await act(async () => a.resolve(positionResponse({ locationIds: ["stock-a"] })));
    expect(await screen.findByText("1–25 of 26 inventory positions")).toBeTruthy();
    await act(async () => b.resolve({ rows: [stockB], nextCursor: null, summary: null })); expect(screen.queryByText("BATTERY")).toBeNull();
  });
  it("stops old membership pagination after switching and hides old catalogue rows", async () => {
    const old = deferred(); mocks.call.mockReturnValueOnce(old.promise); const view = render(<ProductsPage />);
    select("b"); view.rerender(<ProductsPage />); expect(await screen.findByRole("button", { name: "battery" })).toBeTruthy();
    await act(async () => old.resolve({ rows: [{ productId: "panel" }], nextCursor: "old-more" }));
    expect(screen.queryByRole("button", { name: "panel" })).toBeNull(); expect(mocks.call).toHaveBeenCalledTimes(2);
  });
  it("separates failed requests from empty results and clears error on switch", async () => {
    mocks.call.mockRejectedValueOnce(new Error("Inventory unavailable")); const view = render(<InventoryPage />);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Inventory unavailable");
    expect(screen.queryByText("No inventory history at this location.")).toBeNull();
    select("b"); view.rerender(<InventoryPage />); expect(screen.queryByRole("alert")).toBeNull(); expect(await screen.findByText("BATTERY")).toBeTruthy();
  });
  it("allows organization-wide inventory/catalogue only for existing broad roles", async () => {
    select(null); const view = render(<InventoryPage />);
    expect(await screen.findByText("PANEL")).toBeTruthy(); expect(screen.getByText("BATTERY")).toBeTruthy();
    expect(mocks.call).toHaveBeenCalledWith("generateStockPositionReport", expect.objectContaining({ locationIds: undefined }));
    view.unmount(); mocks.call.mockClear(); render(<ProductsPage />); expect(screen.getByRole("button", { name: "never" })).toBeTruthy(); expect(mocks.call).not.toHaveBeenCalled();
    cleanup(); const assigned = { ...administrator, roleId: "branch_manager", roleIds: ["branch_manager"], branchIds: ["a"] } as UserProfile;
    select(null, "branch", assigned); render(<InventoryPage />); expect(screen.getByRole("alert").textContent).toBe("Choose a Store/Warehouse to view inventory."); expect(mocks.call).not.toHaveBeenCalled();
  });
  it("refreshes a failed or outdated inventory view with a fresh summary", async () => {
    mocks.call.mockRejectedValueOnce(new Error("Temporary inventory failure"));
    render(<InventoryPage />); expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Refresh inventory" }));
    expect(await screen.findByText("PANEL")).toBeTruthy();
    mocks.balances.push(balance("new", "new-product", "stock-a", 4, 400));
    fireEvent.click(screen.getByRole("button", { name: "Refresh inventory" }));
    expect(await screen.findByText("NEW-PRODUCT")).toBeTruthy();
    expect(screen.getAllByText("9", { selector: "article p" })).toHaveLength(2);
    expect(mocks.call.mock.calls.every((call) => call[1].withSummary)).toBe(true);
  });
  it("refreshes catalogue membership without showing stale rows during the request", async () => {
    render(<ProductsPage />); expect(await screen.findByRole("button", { name: "panel" })).toBeTruthy();
    mocks.balances.push(balance("new", "never", "stock-a", 0, 0));
    const next = deferred(); mocks.call.mockReturnValueOnce(next.promise);
    fireEvent.click(screen.getByRole("button", { name: "Refresh catalogue" }));
    expect(screen.queryByRole("button", { name: "panel" })).toBeNull();
    await act(async () => next.resolve(positionResponse({ locationIds: ["stock-a", "damaged-a"], view: "membership" })));
    expect(await screen.findByRole("button", { name: "never" })).toBeTruthy();
  });
  it("does not turn server-redacted costs into zero when a cached profile allows costs", async () => {
    mocks.call.mockResolvedValue({ rows: [{ id: "a", productId: "panel", sku: "PANEL", locationId: "stock-a", onHandQuantity: 5, reservedQuantity: 0, availableQuantity: 5 }], summary: { count: 1, onHandQuantity: 5, reservedQuantity: 0, availableQuantity: 5 }, nextCursor: null, includeCosts: false });
    render(<InventoryPage />); expect(await screen.findByText("PANEL")).toBeTruthy();
    const value = screen.getByText("Value", { selector: "article p" }).closest("article");
    expect(value?.textContent).toContain("Restricted"); expect(value?.textContent).not.toContain("₦0.00");
  });
  it("keeps a legacy warehouse distinct from a store with the same ID", async () => {
    select("a", "warehouse"); render(<InventoryPage />); expect(await screen.findByText("WAREHOUSE-ONLY")).toBeTruthy();
    expect(screen.queryByText("PANEL")).toBeNull(); expect(mocks.call).toHaveBeenCalledWith("generateStockPositionReport", expect.objectContaining({ locationIds: ["legacy-a"] }));
  });
  it("drops loaded rows when the authenticated identity changes", async () => {
    const view = render(<InventoryPage />); expect(await screen.findByText("PANEL")).toBeTruthy();
    const next = deferred(); mocks.call.mockReturnValueOnce(next.promise); select("a", "branch", { ...administrator, uid: "another-user" }); view.rerender(<InventoryPage />);
    expect(screen.queryByText("PANEL")).toBeNull(); expect(screen.getByText("Loading inventory…")).toBeTruthy();
    await act(async () => next.resolve(positionResponse({ locationIds: ["stock-a"] })));
    expect(await screen.findByText("PANEL")).toBeTruthy();
  });
});
