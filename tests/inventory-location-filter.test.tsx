// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InventoryPage from "@/app/(protected)/inventory/page";
import ProductsPage from "@/app/(protected)/products/page";
import type { InventoryBalance, InventoryLocation, Product, UserProfile } from "@/types/domain";

const mocks = vi.hoisted(() => ({ call: vi.fn(), metadata: vi.fn(), auth: {} as Record<string, unknown>, locations: [] as InventoryLocation[], products: [] as Product[], balances: [] as InventoryBalance[], loading: false }));
vi.mock("@/features/administration/api", () => ({ callAdministration: mocks.call }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/features/auth/use-operating-context-options", () => ({ useOperatingContextOptions: () => ({ options: [{ type: "branch", id: "a", name: "Store A" }, { type: "branch", id: "b", name: "Store B" }] }) }));
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
  return { id, productId, sku: productId.toUpperCase(), productName: productId === "panel" ? "Solar panel" : "Battery", locationId, onHandQuantity: quantity, reservedQuantity: 0, availableQuantity: quantity, totalValueMinor: value, averageUnitCostMinor: quantity ? value / quantity : 0 } as InventoryBalance;
}
const stockA = balance("a", "panel", "stock-a", 5, 500);
const stockB = balance("b", "battery", "stock-b", 2, 900);
interface Input { search?: string; locationIds?: string[]; locationId?: string; cursor?: string; limit?: number; view?: string; withSummary?: boolean; includeCosts?: boolean }
function positionResponse(input: Input) {
  // The real callable applies the authenticated operating context independently
  // of locationIds. Model that boundary for the branch cost report as well.
  const context = mocks.auth.operatingContext as { type: "branch" | "warehouse"; id: string } | null;
  const all = mocks.balances.map(row => {
    const location = mocks.locations.find(item => item.id === row.locationId);
    return { ...row, branchId: location?.branchId, warehouseId: location?.warehouseId };
  }).filter((row) => (!context || (context.type === "branch" ? row.branchId : row.warehouseId) === context.id) && (!input.locationIds || input.locationIds.includes(row.locationId)) && (!input.search || row.productName?.toLowerCase().includes(input.search.toLowerCase()))).sort((a, b) => a.id < b.id ? -1 : 1);
  const offset = input.cursor ? all.findIndex((row) => row.id === input.cursor) + 1 : 0;
  const limit = input.limit ?? 25;
  const rows = all.slice(offset, offset + limit);
  const summary = input.view !== "membership" && input.withSummary !== false ? all.reduce((s, row) => ({ count: s.count + 1, onHandQuantity: s.onHandQuantity + row.onHandQuantity, reservedQuantity: s.reservedQuantity + row.reservedQuantity, availableQuantity: s.availableQuantity + row.availableQuantity, valueMinor: s.valueMinor + (row.totalValueMinor ?? 0) }), { count: 0, onHandQuantity: 0, reservedQuantity: 0, availableQuantity: 0, valueMinor: 0 }) : null;
  return { includeCosts: input.view !== "membership" && input.includeCosts === true, rows: input.view === "membership" ? rows.map(({ id, productId }) => ({ id, productId })) : rows, summary, nextCursor: offset + rows.length < all.length ? rows.at(-1)!.id : null };
}
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.call.mockReset(); select("a"); mocks.loading = false;
  mocks.locations = [{ id: "stock-a", branchId: "a", name: "Store A stock" }, { id: "damaged-a", branchId: "a", name: "Store A damaged" }, { id: "stock-b", branchId: "b", name: "Store B stock" }, { id: "legacy-a", warehouseId: "a", name: "Legacy warehouse A" }, { id: "empty", branchId: "empty", name: "Empty store" }] as InventoryLocation[];
  mocks.products = ["panel", "battery", "zero", "never"].map((id) => ({ id, name: id, sku: id.toUpperCase(), active: true, trackingType: "quantity", unitOfMeasure: "unit" })) as Product[];
  mocks.balances = [stockA, stockB, balance("zero", "zero", "stock-a", 0, 0), balance("warehouse", "warehouse-only", "legacy-a")];
  mocks.call.mockImplementation(async (name: string, input: Input) => name === "getSkuMovementHistory" ? { rows: [] } : positionResponse(input));
});
afterEach(cleanup);

describe("selected Store/Warehouse inventory", () => {
  it("searches all pages by name, resets pagination and clears search", async () => {
    mocks.balances = Array.from({ length: 26 }, (_, i) => ({ ...balance(`a-${String(i).padStart(2, "0")}`, `panel-${i}`, "stock-a"), productName: i === 25 ? "Rare solar panel" : "Battery", sku: "RARE" }));
    render(<InventoryPage />); expect(await screen.findByText("1–25 of 26 inventory positions")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("26–26 of 26 inventory positions")).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search inventory by item name" }), { target: { value: "  ＲＡＲＥ  " } });
    expect(screen.queryByRole("link", { name: "Rare solar panel" })).toBeNull();
    expect(await screen.findByText("1–1 of 1 inventory positions")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Rare solar panel" })).toBeTruthy();
    expect(mocks.call).toHaveBeenLastCalledWith("generateStockPositionReport", expect.objectContaining({ search: "rare", cursor: undefined, withSummary: true }));
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(await screen.findByText("1–25 of 26 inventory positions")).toBeTruthy();
  });
  it("hides old search rows immediately and discards delayed search responses", async () => {
    render(<InventoryPage />); expect(await screen.findByText("PANEL")).toBeTruthy();
    const old = deferred(); mocks.call.mockReturnValueOnce(old.promise);
    const search = screen.getByRole("searchbox", { name: "Search inventory by item name" });
    fireEvent.change(search, { target: { value: "Solar" } });
    expect(screen.queryByText("PANEL")).toBeNull();
    await waitFor(() => expect(mocks.call).toHaveBeenLastCalledWith("generateStockPositionReport", expect.objectContaining({ search: "solar" })));
    fireEvent.change(search, { target: { value: "Missing" } });
    expect(await screen.findByText("No inventory items match this name.")).toBeTruthy();
    await act(async () => old.resolve(positionResponse({ search: "Solar" })));
    expect(screen.queryByText("PANEL")).toBeNull();
    expect(screen.getByText("No inventory items match this name.")).toBeTruthy();
  });
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
  it("keeps branch costs scoped independently of catalogue membership and never fetches costs for non-cost roles", async () => {
    mocks.balances.push(balance("other-panel", "panel", "stock-b", 1, 99000));
    const view = render(<ProductsPage />);
    expect(await screen.findByRole("button", { name: "panel" })).toBeTruthy();
    await waitFor(() => expect(document.querySelector('td[data-label="Branch stock cost"]')?.textContent).toBe("₦1.00"));
    expect(view.container.textContent).not.toContain("₦990.00");
    select("b"); view.rerender(<ProductsPage />);
    expect(view.container.textContent).not.toContain("₦1.00");
    expect(await screen.findByRole("button", { name: "panel" })).toBeTruthy();
    await waitFor(() => expect(view.container.textContent).toContain("₦990.00"));
    view.unmount(); mocks.call.mockClear();
    const assigned = { ...administrator, roleId: "branch_manager", roleIds: ["branch_manager"], branchIds: ["a"] } as UserProfile;
    select("a", "branch", assigned); render(<ProductsPage />);
    expect(await screen.findByRole("button", { name: "panel" })).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "Branch stock cost" })).toBeNull();
    expect(mocks.call.mock.calls.every(call => call[1].view === "membership" && call[1].includeCosts === false)).toBe(true);
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
    const membershipCalls = mocks.call.mock.calls.filter(call => call[1].view === "membership");
    expect(membershipCalls).toHaveLength(2);
    for (const call of membershipCalls) expect(call[1]).toMatchObject({ view: "membership", limit: 500, withSummary: false, includeCosts: false });
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh stock costs" }).hasAttribute("disabled")).toBe(false));
    const costCalls = mocks.call.mock.calls.filter(call => call[1].view === "positions");
    expect(costCalls).toHaveLength(6);
    for (const call of costCalls) expect(call[1]).toMatchObject({ view: "positions", limit: 100, withSummary: false, includeCosts: true });
    expect(costCalls.at(-1)?.[1].cursor).toBe("b-499");
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
    const old = deferred();
    mocks.call.mockImplementation(async (_name: string, input: Input) => input.view === "membership" && input.locationIds?.includes("stock-a") ? old.promise : positionResponse(input));
    const view = render(<ProductsPage />);
    select("b"); view.rerender(<ProductsPage />); expect(await screen.findByRole("button", { name: "battery" })).toBeTruthy();
    await act(async () => old.resolve({ rows: [{ productId: "panel" }], nextCursor: "old-more" }));
    expect(screen.queryByRole("button", { name: "panel" })).toBeNull();
    expect(mocks.call.mock.calls.filter(call => call[1].view === "membership")).toHaveLength(2);
    expect(mocks.call.mock.calls.some(call => call[1].cursor === "old-more")).toBe(false);
    expect(document.querySelector('td[data-label="Branch stock cost"]')?.textContent).toBe("₦4.50");
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
    view.unmount(); mocks.call.mockClear(); render(<ProductsPage />); expect(screen.getByRole("button", { name: "never" })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh stock costs" }).hasAttribute("disabled")).toBe(false));
    expect(mocks.call).toHaveBeenCalledTimes(1);
    expect(mocks.call).toHaveBeenCalledWith("generateStockPositionReport", expect.objectContaining({ view: "positions", includeCosts: true, limit: 100 }));
    expect(mocks.call.mock.calls.some(call => call[1].view === "membership")).toBe(false);
    cleanup(); mocks.call.mockClear(); const assigned = { ...administrator, roleId: "branch_manager", roleIds: ["branch_manager"], branchIds: ["a"] } as UserProfile;
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

describe("inventory product identity", () => {
  it("shows the full human-readable name above its separate SKU, including long names and zero stock", async () => {
    const productName = "Lithium 4 kW(h) / 1.5 kVA All in One Haisic with extended product specifications";
    mocks.balances = [{ ...stockA, productName, sku: "SKU-366115BDF78EC3DEF837E9820156B005", onHandQuantity: 0, availableQuantity: 0 }];
    render(<InventoryPage />);
    const link = await screen.findByRole("link", { name: productName });
    expect(link.textContent).toBe(productName);
    expect(link.getAttribute("href")).toBe("/products/panel#movement-history");
    expect(link.closest("td")?.getAttribute("data-primary")).toBe("true");
    expect(link.closest("td")?.textContent).toContain("SKU-366115BDF78EC3DEF837E9820156B005");
  });

  it("keeps the name after refreshing or switching locations and does not substitute its SKU", async () => {
    const view = render(<InventoryPage />);
    expect(await screen.findByRole("link", { name: "Solar panel" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Refresh inventory" }));
    expect(await screen.findByRole("link", { name: "Solar panel" })).toBeTruthy();
    select("b"); view.rerender(<InventoryPage />);
    expect(await screen.findByRole("link", { name: "Battery" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Solar panel" })).toBeNull();
    expect(screen.queryByRole("link", { name: "BATTERY" })).toBeNull();
  });
});
