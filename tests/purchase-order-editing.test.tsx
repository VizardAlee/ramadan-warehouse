// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react";
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
afterEach(() => { cleanup(); sessionStorage.clear(); state.call.mockReset(); state.auth.operatingContext.id = "store"; });

vi.mock("@/features/procurement/purchasing-list", () => ({ PurchasingList: ({ onOrder }: { onOrder: (id: string) => void }) => <button onClick={() => onOrder("po")}>Open fixture</button> }));
const order = { id: "po", purchaseOrderNumber: "PO-1", status: "draft", supplierId: "supplier", supplierName: "Fixture Supplier", branchId: "store", receivingLocationId: "stock", revision: 3, expectedAt: "2026-12-01T12:30:00.000Z", notes: "Handle carefully", grossAmountMinor: 10000 };
const items = [{ id: "line", productId: "panel-id", orderedQuantity: 2, receivedQuantity: 0, unitCostMinor: 125050, vatRateBasisPoints: 750, productName: "Solar Panel 620W", sku: "SKU", trackingType: "quantity" }];
it("opens a populated draft and saves revision-protected changes", async () => {
  Element.prototype.scrollIntoView = vi.fn();
  state.call.mockImplementation((name: string, payload: { view?: string }) => Promise.resolve(name === "getProcurementWorkspace" ? payload.view === "order_detail" ? { order, items } : workspace : { updated: true }));
  render(<ProcurementPage />);
  await waitFor(() => expect(state.call).toHaveBeenCalledWith("getProcurementWorkspace", expect.objectContaining({ view: "options" })));
  fireEvent.click(screen.getByRole("button", { name: "Open fixture" }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit draft" }));
  expect((screen.getByLabelText("Quantity") as HTMLInputElement).value).toBe("2");
  expect((screen.getByLabelText("Notes") as HTMLTextAreaElement).value).toBe("Handle carefully");
  expect((screen.getByRole("button", { name: "Submit", exact: true }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Updated notes" } });
  fireEvent.click(screen.getByRole("button", { name: "Save draft changes" }));
  await waitFor(() => expect(state.call).toHaveBeenCalledWith("createPurchaseOrder", expect.objectContaining({ action: "edit_draft", purchaseOrderId: "po", expectedRevision: 3, notes: "Updated notes", idempotencyKey: expect.any(String), lines: [{ productId: "panel-id", quantity: 2, unitCostMinor: 125050, vatRateBasisPoints: 750 }] })));
});

async function openEditor(write: () => Promise<unknown> = () => Promise.resolve({ updated: true }), record = order) {
  Element.prototype.scrollIntoView = vi.fn();
  state.call.mockImplementation((name: string, payload: { view?: string }) => name === "getProcurementWorkspace" ? Promise.resolve(payload.view === "order_detail" ? { order: record, items } : workspace) : write());
  const rendered = render(<ProcurementPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Open fixture" }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit draft" }));
  return rendered;
}
const saves = () => state.call.mock.calls.filter(call => call[0] === "createPurchaseOrder");
it("retains unsaved changes and reuses retry keys only for identical payloads", async () => {
  await openEditor(() => Promise.reject(new Error("Stale revision")));
  fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Keep me" } });
  fireEvent.click(screen.getByRole("button", { name: "Save draft changes" }));
  await screen.findByText(/Your unsaved changes are kept/);
  expect((screen.getByLabelText("Notes") as HTMLTextAreaElement).value).toBe("Keep me");
  fireEvent.click(screen.getByRole("button", { name: "Save draft changes" }));
  await waitFor(() => expect(saves()).toHaveLength(2));
  await screen.findByText(/Your unsaved changes are kept/);
  expect(saves()[1][1].idempotencyKey).toBe(saves()[0][1].idempotencyKey);
  expect(saves()[0][1].expectedAt).toBe(order.expectedAt);
  fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Changed" } });
  fireEvent.click(screen.getByRole("button", { name: "Save draft changes" }));
  await waitFor(() => expect(saves()).toHaveLength(3));
  expect(saves()[2][1].idempotencyKey).not.toBe(saves()[1][1].idempotencyKey);
});
it("cancels and starts a clean new order", async () => {
  await openEditor();
  fireEvent.click(screen.getByRole("button", { name: "Cancel", exact: true }));
  expect(screen.queryByLabelText("Notes")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "New order", exact: true }));
  expect((screen.getByLabelText("Notes") as HTMLTextAreaElement).value).toBe("");
  expect(screen.queryByRole("button", { name: "Save draft changes" })).toBeNull();
});
it("discards the editor on a branch switch", async () => {
  const rendered = await openEditor();
  state.auth.operatingContext.id = "other-store";
  rendered.rerender(<ProcurementPage />);
  expect(screen.queryByLabelText("Notes")).toBeNull();
});
it("does not offer editing submitted orders", async () => {
  Element.prototype.scrollIntoView = vi.fn();
  state.call.mockImplementation((_name: string, payload: { view?: string }) => Promise.resolve(payload.view === "order_detail" ? { order: { ...order, status: "submitted" }, items } : workspace));
  render(<ProcurementPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Open fixture" }));
  await screen.findByText("PO-1");
  expect(screen.queryByRole("button", { name: "Edit draft" })).toBeNull();
});
it("does not close a newer form when an older save completes", async () => {
  let finish!: (value: unknown) => void;
  await openEditor(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole("button", { name: "Save draft changes" }));
  await waitFor(() => expect(saves()).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "New order", exact: true }));
  await act(async () => { finish({ updated: true }); });
  expect(screen.getByText("Create purchase order", { selector: "summary" })).not.toBeNull();
  expect((screen.getByLabelText("Notes") as HTMLTextAreaElement).value).toBe("");
});
it("handles invalid stored dates without throwing", async () => {
  await openEditor(undefined, { ...order, expectedAt: "invalid" });
  expect((screen.getByLabelText("Expected delivery date") as HTMLInputElement).value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Save draft changes" }));
  await waitFor(() => expect(saves()).toHaveLength(1));
  expect(saves()[0][1].expectedAt).toBeUndefined();
});
it("hides the editor when closing order details", async () => {
  await openEditor();
  fireEvent.click(screen.getByRole("button", { name: "Close details" }));
  expect(screen.queryByLabelText("Notes")).toBeNull();
  expect(screen.queryByRole("button", { name: "Create draft order" })).toBeNull();
});
