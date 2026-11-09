// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ProcurementPage from "@/app/(protected)/procurement/page";

const state = vi.hoisted(() => ({ call: vi.fn(), auth: { profile: { organizationId: "fixture-org", status: "active", roleId: "purchasing_manager", roleIds: ["purchasing_manager"], directRoleIds: ["purchasing_manager"], effectivePermissions: [], branchIds: ["store"], warehouseIds: [] }, user: { uid: "fixture-user" }, operatingContext: { type: "branch", id: "store" } } }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => state.auth }));
vi.mock("@/features/administration/api", () => ({ callAdministration: state.call }));
vi.mock("@/features/procurement/supplier-accounts", () => ({ SupplierAccounts: () => null }));
vi.mock("@/features/procurement/goods-received-note", () => ({ GoodsReceivedNotes: () => null }));
vi.mock("@/features/procurement/supplier-returns", () => ({ SupplierReturns: () => null }));
const workspace = {
  suppliers: [{ id: "supplier", name: "Fixture Supplier", active: true }],
  branches: [{ id: "store", name: "Fixture Store", code: "FS", branchType: "store" }],
  warehouses: [], locations: [{ id: "stock", branchId: "store", name: "Fixture stock", code: "ST" }],
  products: [
    { id: "panel-id", name: "Solar Panel 620W", sku: "SKU-ONLY-620", trackingType: "quantity", unitOfMeasure: "unit" },
    { id: "battery-id", name: "Lithium Battery", sku: "BAT-ONLY-100", trackingType: "quantity", unitOfMeasure: "unit" },
  ],
  purchaseOrders: [], purchaseOrderItems: [], supplierInvoices: [], bankAccounts: [],
};
afterEach(() => { cleanup(); sessionStorage.clear(); state.call.mockReset(); });
it("lets a purchasing manager search and create purchases with real role checks", async () => {
  // All writes are intercepted by this mock. No real purchase is submitted.
  state.call.mockImplementation((name: string) => Promise.resolve(name === "getProcurementWorkspace" ? workspace : { id: "mock-order" }));
  const previousScroll = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = vi.fn();
  render(<ProcurementPage />);
  await waitFor(() => expect(state.call).toHaveBeenCalledWith("getProcurementWorkspace", expect.objectContaining({ view: "options" })));
  fireEvent.click(screen.getByRole("button", { name: "New order", exact: true }));
  const summary = await screen.findByText("Create purchase order", { selector: "summary" });
  expect(screen.queryByRole("button", { name: "Add supplier" })).not.toBeNull();
  fireEvent.click(summary);
  // jsdom does not implement the details toggle.
  (summary.closest("details") as HTMLDetailsElement).open = true;
  const product = screen.getByRole("combobox", { name: "Product", exact: true }) as HTMLSelectElement;
  fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "3" } });
  fireEvent.change(screen.getByLabelText("Unit cost (₦)"), { target: { value: "1250.50" } });
  fireEvent.change(screen.getByLabelText("VAT (%)"), { target: { value: "7.5" } });
  fireEvent.click(product);
  const search = screen.getByRole("combobox", { name: "Search Product by item name" });
  fireEvent.change(search, { target: { value: "SKU-ONLY-620" } });
  expect(screen.getByText("No items match this name.").getAttribute("role")).toBe("status");
  expect(product.value).toBe("");
  fireEvent.change(search, { target: { value: "panel" } });
  const list = screen.getByRole("listbox");
  expect(within(list).getAllByRole("option")).toHaveLength(1);
  expect(within(list).queryByText(/SKU-ONLY/)).toBeNull();
  fireEvent.click(within(list).getByRole("option", { name: "Solar Panel 620W", exact: true }));
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(product.value).toBe("panel-id");
  expect(product.selectedOptions[0].textContent?.trim()).toBe("Solar Panel 620W");
  expect((screen.getByLabelText("Unit cost (₦)") as HTMLInputElement).value).toBe("1,250.50");
  expect(state.call.mock.calls.every(call => call[0] === "getProcurementWorkspace")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Create draft order" }));
  await waitFor(() => expect(state.call).toHaveBeenCalledWith("createPurchaseOrder", expect.objectContaining({
    supplierId: "supplier", branchId: "store", receivingLocationId: "stock",
    lines: [{ productId: "panel-id", quantity: 3, unitCostMinor: 125050, vatRateBasisPoints: 750 }],
  })));
  Element.prototype.scrollIntoView = previousScroll;
});
