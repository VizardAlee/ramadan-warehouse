// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ProcurementPage from "@/app/(protected)/procurement/page";
const state = vi.hoisted(() => ({ call: vi.fn(), auth: { profile: { organizationId: "org", status: "active", roleId: "purchasing_manager", roleIds: ["purchasing_manager"], directRoleIds: ["purchasing_manager"], effectivePermissions: [], branchIds: ["store", "other"], warehouseIds: [] }, user: { uid: "user" }, operatingContext: { type: "branch", id: "store" } } }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => state.auth }));
vi.mock("@/features/administration/api", () => ({ callAdministration: state.call }));
vi.mock("@/features/procurement/supplier-accounts", () => ({ SupplierAccounts: () => <div>Accounts mounted</div> }));
vi.mock("@/features/procurement/goods-received-note", () => ({ GoodsReceivedNotes: () => null }));
vi.mock("@/features/procurement/supplier-returns", () => ({ SupplierReturns: () => null }));
const options = { suppliers: [{ id: "supplier", name: "Supplier", active: true }], branches: [{ id: "store", name: "Store", branchType: "store" }, { id: "other", name: "Other", branchType: "store" }], warehouses: [], locations: [{ id: "stock", branchId: "store" }], products: [], bankAccounts: [] };
const order = { id: "po", purchaseOrderNumber: "PO-ONE", supplierName: "Supplier", branchId: "store", status: "received", grossAmountMinor: 10000, createdBy: "user", nextAction: "Review invoices" };
const items = [{ id: "item", purchaseOrderId: "po", productName: "Real product", orderedQuantity: 2, receivedQuantity: 2, invoicedQuantity: 2 }];
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); sessionStorage.clear(); state.call.mockReset(); state.auth.operatingContext = { type: "branch", id: "store" }; });
it("loads only the selected order, hides fully matched forms and links recorded invoices", async () => {
  state.call.mockImplementation((_name, input) => Promise.resolve(input.view === "options" ? options : input.view === "order_detail" ? { order, items } : input.view === "invoices_page" ? { invoices: [], nextCursor: null } : { orders: [order], nextCursor: null }));
  render(<ProcurementPage />);
  await screen.findByText("PO-ONE");
  expect(screen.queryByText("Accounts mounted")).toBeNull();
  expect(screen.queryByText("Real product")).toBeNull();
  expect(screen.queryByRole("button", { name: "Create draft order" })).toBeNull();
  expect(state.call.mock.calls.some(([, input]) => input.view === "order_detail")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Review invoices" }));
  await screen.findByText("Real product");
  expect(screen.queryByLabelText("Supplier invoice number")).toBeNull();
  expect(screen.getByText(/All received goods are already matched/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "View recorded invoices" }));
  await waitFor(() => expect(state.call).toHaveBeenCalledWith("getProcurementWorkspace", expect.objectContaining({ view: "invoices_page", workflow: "all", search: "PO-ONE" })));
  expect(screen.queryByText("Real product")).toBeNull();
});
it("does not reopen a dismissed pending detail and keeps its list filters/page", async () => {
  let finish: (result: unknown) => void = () => {};
  state.call.mockImplementation((_name, input) => input.view === "order_detail" ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(input.view === "options" ? options : { orders: [order], nextCursor: input.cursor ? null : "next" }));
  render(<ProcurementPage />);
  await screen.findByText("PO-ONE");
  fireEvent.click(screen.getByRole("button", { name: "Next", exact: true }));
  await screen.findByText("PO-ONE");
  fireEvent.click(screen.getByRole("button", { name: "Review invoices" }));
  await screen.findByText("Loading order details…");
  fireEvent.click(screen.getByRole("button", { name: "Close details" }));
  finish({ order, items });
  await waitFor(() => expect(screen.queryByText("Real product")).toBeNull());
  expect(screen.getByText("Page 2")).toBeTruthy();
});
it("discards late details across global working-location changes", async () => {
  let finish: (result: unknown) => void = () => {};
  state.call.mockImplementation((_name, input) => input.view === "order_detail" ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(input.view === "options" ? options : { orders: input.branchId === "store" ? [order] : [], nextCursor: null }));
  const { rerender } = render(<ProcurementPage />);
  await screen.findByText("PO-ONE");
  fireEvent.click(screen.getByRole("button", { name: "Review invoices" }));
  state.auth.operatingContext = { type: "branch", id: "other" };
  rerender(<ProcurementPage />);
  finish({ order, items });
  await waitFor(() => expect(state.call).toHaveBeenCalledWith("getProcurementWorkspace", expect.objectContaining({ view: "orders_page", branchId: "other", cursor: undefined })));
  expect(screen.queryByText("Real product")).toBeNull();
  expect(screen.queryByText("PO-ONE")).toBeNull();
});

it("opens invoice and new-order workflows from purchasing dashboard links", async () => {
  window.history.replaceState(null, "", "/procurement#supplier-invoices");
  state.call.mockImplementation((_name, input) => Promise.resolve(input.view === "options" ? options : input.view === "invoices_page" ? { invoices: [], nextCursor: null } : { orders: [], nextCursor: null }));
  render(<ProcurementPage />);
  await waitFor(() => expect(state.call).toHaveBeenCalledWith("getProcurementWorkspace", expect.objectContaining({ view: "invoices_page" })));
  expect(screen.getByRole("region", { name: "Invoice list" }).id).toBe("supplier-invoices");
  expect(screen.queryByRole("button", { name: "Create draft order" })).toBeNull();
  window.history.replaceState(null, "", "/procurement#new-purchase-order");
  fireEvent(window, new HashChangeEvent("hashchange"));
  await screen.findByRole("button", { name: "Create draft order" });
  expect(screen.getByRole("region", { name: "Order list" }).id).toBe("purchase-orders");
  fireEvent.click(screen.getByRole("button", { name: "Invoices & payments" }));
  expect(screen.queryByRole("button", { name: "Create draft order" })).toBeNull();
  expect(state.call.mock.calls.every(([name]) => name === "getProcurementWorkspace")).toBe(true);
});

const pendingInvoice = { id: "invoice", purchaseOrderId: "po", purchaseOrderNumber: "PO-ONE", supplierInvoiceNumber: "INV-ONE", supplierName: "Supplier", branchId: "store", status: "submitted", grossAmountMinor: 10000, outstandingAmountMinor: 10000, createdBy: "user" };
function matchingWorkspace(submit: () => Promise<unknown>, pending = false) {
  state.call.mockImplementation((name, input) => {
    if (name === "submitSupplierInvoice") return submit();
    return Promise.resolve(input.view === "options" ? options : input.view === "order_detail" ? { order, pendingInvoiceCount: pending ? 1 : 0, items: [{ ...items[0], invoicedQuantity: 0, pendingInvoiceQuantity: pending ? 2 : 0, matchableQuantity: pending ? 0 : 2 }] } : input.view === "invoice_detail" ? { invoice: pendingInvoice } : input.view === "invoices_page" ? { invoices: [pendingInvoice], nextCursor: null } : { orders: [order], nextCursor: null });
  });
}
async function openMatchForm() {
  render(<ProcurementPage />);
  await screen.findByText("PO-ONE");
  fireEvent.click(screen.getByRole("button", { name: "Review invoices" }));
  await screen.findByText("Real product");
}
it("shows pending quantities and review approval instead of inviting a duplicate match", async () => {
  matchingWorkspace(async () => { throw new Error("Must not submit"); }, true);
  await openMatchForm();
  expect(screen.queryByLabelText("Supplier invoice number")).toBeNull();
  expect(screen.getByText(/submitted invoice\(s\) are awaiting approval/)).toBeTruthy();
  expect(screen.getByText(/Awaiting invoice approval:/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Review submitted invoices" }));
  await waitFor(() => expect(state.call).toHaveBeenCalledWith("getProcurementWorkspace", expect.objectContaining({ view: "invoices_page", search: "PO-ONE" })));
  expect(state.call.mock.calls.some(([name]) => name === "submitSupplierInvoice")).toBe(false);
});
it("opens the saved invoice with visible feedback and its approval action", async () => {
  matchingWorkspace(async () => ({ supplierInvoiceId: "invoice", submitted: true }));
  await openMatchForm();
  fireEvent.change(screen.getByLabelText("Supplier invoice number"), { target: { value: "INV-ONE" } });
  fireEvent.click(screen.getByRole("button", { name: /Match received goods/ }));
  await screen.findByRole("button", { name: "Approve invoice" });
  expect(screen.getByText(/Invoice INV-ONE is saved/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Match received goods/ })).toBeNull();
  expect(state.call).toHaveBeenCalledWith("getProcurementWorkspace", { view: "invoice_detail", supplierInvoiceId: "invoice", branchId: "store" });
  expect(state.call.mock.calls.filter(([name]) => name === "submitSupplierInvoice")).toHaveLength(1);
});
it("reuses the exact matching key after an interrupted response and shows the error beside the form", async () => {
  let attempt = 0;
  matchingWorkspace(async () => { if (!attempt++) throw new Error("Connection interrupted"); return { supplierInvoiceId: "invoice", submitted: false }; });
  await openMatchForm();
  fireEvent.change(screen.getByLabelText("Supplier invoice number"), { target: { value: "INV-ONE" } });
  fireEvent.click(screen.getByRole("button", { name: /Match received goods/ }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Connection interrupted"));
  fireEvent.click(screen.getByRole("button", { name: /Match received goods/ }));
  await screen.findByRole("button", { name: "Approve invoice" });
  const calls = state.call.mock.calls.filter(([name]) => name === "submitSupplierInvoice");
  expect(calls).toHaveLength(2);
  expect(calls[0]![1]).toEqual(calls[1]![1]);
});
it("does not reopen a saved invoice after the user closes or changes the selected record", async () => {
  let finish: (value: unknown) => void = () => {};
  matchingWorkspace(() => new Promise(resolve => { finish = resolve; }));
  await openMatchForm();
  fireEvent.change(screen.getByLabelText("Supplier invoice number"), { target: { value: "INV-ONE" } });
  fireEvent.click(screen.getByRole("button", { name: /Match received goods/ }));
  fireEvent.click(screen.getByRole("button", { name: "Close details" }));
  finish({ supplierInvoiceId: "invoice", submitted: true });
  await waitFor(() => expect(screen.queryByText("Real product")).toBeNull());
  expect(screen.queryByText(/Invoice INV-ONE is saved/)).toBeNull();
  expect(state.call.mock.calls.some(([, input]) => input.view === "invoice_detail")).toBe(false);
});

it.each(["cancelled", "rejected"])("keeps %s history visible but never offers approval or payment", async status => {
  const historical = { ...pendingInvoice, status };
  state.call.mockImplementation((_name, input) => Promise.resolve(input.view === "options" ? options : { invoices: [historical], nextCursor: null }));
  window.history.replaceState(null, "", "/procurement#supplier-invoices");
  render(<ProcurementPage />);
  await screen.findByText("INV-ONE");
  fireEvent.click(screen.getByRole("button", { name: "View invoice" }));
  await screen.findByText(/invoice cannot be approved or paid/);
  expect(screen.queryByRole("button", { name: "Approve invoice" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Record payment / apply advance" })).toBeNull();
  expect(historical.outstandingAmountMinor).toBe(10000);
  expect(state.call.mock.calls.every(([name]) => name === "getProcurementWorkspace")).toBe(true);
});
