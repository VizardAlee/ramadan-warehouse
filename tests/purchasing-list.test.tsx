// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PurchasingList } from "@/features/procurement/purchasing-list";

const call = vi.hoisted(() => vi.fn());
vi.mock("@/features/administration/api", () => ({ callAdministration: call }));
const first = { id: "po-1", purchaseOrderNumber: "PO-001", supplierName: "Solar supplier", supplierId: "supplier", branchId: "store", status: "received", grossAmountMinor: 12500, nextAction: "Review invoices", createdAt: { _seconds: 1780000000 } };
const base = { kind: "orders" as const, scope: { branchId: "store" }, suppliers: [{ id: "supplier", name: "Solar supplier" }], branches: [{ id: "store", name: "Main store" }, { id: "other", name: "Other store" }], warehouses: [], revision: 0, onOrder: vi.fn(), onInvoice: vi.fn(), onDismiss: vi.fn() };
beforeEach(() => { call.mockReset(); base.onOrder.mockClear(); base.onDismiss.mockClear(); });
afterEach(cleanup);
it("requests 25 scoped actionable rows, opens only the selected record and keeps page on dismissal", async () => {
  call.mockImplementation((_name, input) => Promise.resolve({ orders: input.cursor ? [{ ...first, id: "po-2", purchaseOrderNumber: "PO-002" }] : [first], nextCursor: input.cursor ? null : "cursor-one", hasMore: !input.cursor }));
  const { rerender } = render(<PurchasingList {...base} />);
  await screen.findByText("PO-001");
  expect(call).toHaveBeenLastCalledWith("getProcurementWorkspace", expect.objectContaining({ view: "orders_page", workflow: "needs_action", pageSize: 25, branchId: "store", cursor: undefined }));
  expect((screen.getByLabelText("Filter location") as HTMLSelectElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Next", exact: true }));
  await screen.findByText("PO-002");
  fireEvent.click(screen.getByRole("button", { name: "Review invoices", exact: true }));
  expect(base.onOrder).toHaveBeenCalledWith("po-2");
  rerender(<PurchasingList {...base} />);
  expect(screen.getByText("PO-002")).toBeTruthy();
  expect(screen.getByText("Page 2")).toBeTruthy();
  expect(call).toHaveBeenCalledTimes(2);
});
it("resets cursor for server filters and allows searching completed history", async () => {
  call.mockResolvedValue({ orders: [first], nextCursor: "next", hasMore: true });
  render(<PurchasingList {...base} />);
  await screen.findByText("PO-001");
  fireEvent.click(screen.getByRole("button", { name: "Next", exact: true }));
  await screen.findByText("PO-001");
  fireEvent.click(screen.getByRole("button", { name: "History", exact: true }));
  fireEvent.change(screen.getByLabelText("Search reference or supplier"), { target: { value: "PO-OLD" } });
  fireEvent.change(screen.getByLabelText("Filter supplier"), { target: { value: "supplier" } });
  fireEvent.change(screen.getByLabelText("Created from"), { target: { value: "2026-01-01" } });
  fireEvent.change(screen.getByLabelText("Created through"), { target: { value: "2026-02-01" } });
  await waitFor(() => expect(call).toHaveBeenLastCalledWith("getProcurementWorkspace", expect.objectContaining({ workflow: "history", search: "PO-OLD", supplierId: "supplier", startDate: "2026-01-01", endDate: "2026-02-01", cursor: undefined })));
  expect(screen.getByText("Page 1")).toBeTruthy();
});
it("ignores a late prior search result", async () => {
  let finish: (value: unknown) => void = () => {};
  call.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ orders: [{ ...first, purchaseOrderNumber: "NEW-RESULT" }], nextCursor: null });
  render(<PurchasingList {...base} />);
  await waitFor(() => expect(call).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText("Search reference or supplier"), { target: { value: "NEW" } });
  await screen.findByText("NEW-RESULT");
  finish({ orders: [{ ...first, purchaseOrderNumber: "STALE-RESULT" }], nextCursor: null });
  await waitFor(() => expect(screen.queryByText("STALE-RESULT")).toBeNull());
  expect(screen.getByText("NEW-RESULT")).toBeTruthy();
});
it("keeps Next available for an empty server scan page and displays recoverable errors", async () => {
  for (let i = 1; i <= 5; i++) call.mockResolvedValueOnce({ orders: [], nextCursor: `continue-${i}`, hasMore: true });
  call.mockRejectedValueOnce(new Error("Temporary failure")).mockResolvedValue({ orders: [first], nextCursor: null });
  render(<PurchasingList {...base} />);
  await screen.findByText(/No matches in the records searched so far/);
  expect(call).toHaveBeenCalledTimes(5);
  fireEvent.click(screen.getByRole("button", { name: "Next", exact: true }));
  await screen.findByText("Temporary failure");
  fireEvent.click(screen.getByRole("button", { name: "Retry list", exact: true }));
  await screen.findByText("PO-001");
  expect(call).toHaveBeenLastCalledWith("getProcurementWorkspace", expect.objectContaining({ cursor: "continue-5" }));
});
it("uses invoice paging and does not request order details or supplier statements", async () => {
  call.mockResolvedValue({ invoices: [{ ...first, supplierInvoiceNumber: "INV-PAID", outstandingAmountMinor: 0, status: "paid" }], nextCursor: null });
  render(<PurchasingList {...base} kind="invoices" initialSearch="PO-001" />);
  await screen.findByText("INV-PAID");
  expect(call).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledWith("getProcurementWorkspace", expect.objectContaining({ view: "invoices_page", workflow: "all", search: "PO-001" }));
  fireEvent.click(screen.getByRole("button", { name: "View settlement" }));
  expect(base.onInvoice).toHaveBeenCalledWith(expect.objectContaining({ supplierInvoiceNumber: "INV-PAID" }));
});

it("automatically follows sparse pages but stops a cancelled scan before another request", async () => {
  let finish: (value: unknown) => void = () => {};
  call.mockResolvedValueOnce({ orders: [], nextCursor: "scan-two" })
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue({ orders: [{ ...first, purchaseOrderNumber: "CURRENT" }], nextCursor: null });
  render(<PurchasingList {...base} />);
  await waitFor(() => expect(call).toHaveBeenCalledTimes(2));
  expect(call).toHaveBeenLastCalledWith("getProcurementWorkspace", expect.objectContaining({ cursor: "scan-two" }));
  fireEvent.change(screen.getByLabelText("Search reference or supplier"), { target: { value: "CURRENT" } });
  finish({ orders: [], nextCursor: "cancelled-scan-three" });
  await screen.findByText("CURRENT");
  expect(call).toHaveBeenCalledTimes(3);
  expect(call.mock.calls.some(([, input]) => input.cursor === "cancelled-scan-three")).toBe(false);
});
it("finds a match during bounded continuation and retains the original previous anchor", async () => {
  call.mockImplementation((_name, input) => Promise.resolve(input.cursor === "one" ? { orders: [first], nextCursor: "two" } : input.cursor === "two" ? { orders: [{ ...first, purchaseOrderNumber: "SECOND" }], nextCursor: null } : { orders: [], nextCursor: "one" }));
  render(<PurchasingList {...base} />);
  await screen.findByText("PO-001");
  expect(call).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "Next", exact: true }));
  await screen.findByText("SECOND");
  fireEvent.click(screen.getByRole("button", { name: "Previous", exact: true }));
  await screen.findByText("PO-001");
  expect(call.mock.calls[3]?.[1].cursor).toBeUndefined();
  expect(call.mock.calls[4]?.[1].cursor).toBe("one");
});
