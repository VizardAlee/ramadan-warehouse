// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SaleCorrections } from "@/features/returns/sale-corrections";
const api = vi.hoisted(() => ({ call: vi.fn(), administrator: true }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({ profile: { status: "active", roleId: api.administrator ? "system_administrator" : "branch_manager", roleIds: [api.administrator ? "system_administrator" : "branch_manager"] } }) }));
vi.mock("@/features/administration/api", () => ({ callAdministration: api.call }));
afterEach(() => { cleanup(); vi.resetAllMocks(); api.administrator = true; });
const source = { sale: { saleNumber: "SAL-001", receiptNumber: "RCP-001", customerId: null }, items: [{ productId: "panel", productName: "Solar panel", soldQuantity: 2, unitPriceMinor: 10000 }] };
describe("posted-order corrections", () => {
  it("retains exactly the same correction request after uncertain confirmation", async () => {
    let attempts = 0;
    api.call.mockImplementation((_name: string, input: { action: string }) => input.action === "request" ? ++attempts === 1 ? Promise.reject(new Error("Connection lost")) : Promise.resolve({ status: "submitted" }) : Promise.resolve({ records: [], nextCursor: null }));
    render(<SaleCorrections branchId="branch-1" source={source} canCreate canApprove />);
    await screen.findByText("No corrections in this view.");
    fireEvent.click(screen.getByText("Request correction to SAL-001"));
    fireEvent.change(screen.getByLabelText("Why is a correction needed?"), { target: { value: "Wrong quantity in original order" } });
    fireEvent.change(screen.getByLabelText("Proposed changes and settlement instructions"), { target: { value: "Return collected goods for inspection and reissue" } });
    fireEvent.change(screen.getByLabelText("Proposed quantity 1"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit correction request" }));
    await screen.findByRole("button", { name: "Retry same request" });
    expect((screen.getByLabelText("Proposed quantity 1") as HTMLInputElement).closest("fieldset")?.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Retry same request" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Retry same request" })).toBeNull());
    const requests = api.call.mock.calls.filter(([, input]) => input.action === "request");
    expect(requests).toHaveLength(2); expect(requests[0]![1]).toEqual(requests[1]![1]);
    expect(requests[0]![1]).toMatchObject({ receiptNumber: "RCP-001", proposedValues: { customerId: null, lines: [{ productId: "panel", quantity: 1, unitPriceMinor: 10000 }] } });
  });
  it("shows readable proposed values and never treats approval as posting", async () => {
    const record = { id: "correction-1", correctionNumber: "COR-001", saleNumber: "SAL-001", reason: "Wrong price", status: "approved", originalValues: { customerName: "Original customer", grossAmountMinor: 20000, lines: [{ productName: "Solar panel", quantity: 2, unitPriceMinor: 10000 }] }, proposedValues: { customerId: "customer-2", customerName: "Replacement customer", discountAmountMinor: 0, details: "Return and reissue", lines: [{ productId: "panel", productName: "Solar panel", quantity: 2, unitPriceMinor: 9000 }] } };
    api.call.mockResolvedValue({ records: [record], nextCursor: "correction-1" });
    render(<SaleCorrections branchId="branch-1" source={null} canCreate={false} canApprove={false} />);
    await screen.findByText("COR-001 · SAL-001 · Approved — processing required");
    expect(screen.getByText("Replacement customer")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Verify linked transactions and complete" })).toBeNull();
    expect(api.call.mock.calls.every(([, input]) => input.action === "list")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(api.call).toHaveBeenCalledWith("salesCorrections", expect.objectContaining({ action: "list", limit: 25, cursor: "correction-1" })));
  });
});

it("keeps erroneous-sale correction controls admin-only even when broader return props are allowed", async () => {
  api.administrator = false;
  api.call.mockResolvedValue({ records: [], nextCursor: null });
  render(<SaleCorrections branchId="branch-1" source={source} canCreate canApprove />);
  expect(screen.getByText("Only a System Administrator can correct a sale entered in error.")).toBeTruthy();
  expect(screen.queryByText("Request correction to SAL-001")).toBeNull();
  await screen.findByText("No corrections in this view.");
});

it("requests cancellation without replacement fields and retains its retry instructions", async () => {
  api.call.mockImplementation((_name: string, input: { action: string }) => input.action === "request_cancellation" ? Promise.resolve({ status: "submitted" }) : Promise.resolve({ records: [], nextCursor: null }));
  render(<SaleCorrections branchId="branch-1" source={source} canCreate canApprove />);
  await screen.findByText("No corrections in this view.");
  fireEvent.click(screen.getByText("Cancel mistaken sale SAL-001"));
  fireEvent.change(screen.getByLabelText("Why must this mistaken sale be cancelled?"), { target: { value: "Training order entered by mistake" } });
  fireEvent.click(screen.getByRole("button", { name: "Request cancellation without replacement" }));
  await waitFor(() => expect(api.call).toHaveBeenCalledWith("salesCorrections", expect.objectContaining({ action: "request_cancellation", receiptNumber: "RCP-001" })));
  const request = api.call.mock.calls.find(([, input]) => input.action === "request_cancellation")![1];
  expect(request).not.toHaveProperty("proposedValues");
});

it("completes approved cancellation without a replacement number", async () => {
  api.call.mockImplementation((_name: string, input: { action: string }) => Promise.resolve(input.action === "list" ? { records: [{ id: "cancel-1", kind: "cancel_without_replacement", correctionNumber: "COR-CANCEL", saleNumber: "SAL-001", reason: "Training mistake", status: "approved", originalValues: { customerName: null, grossAmountMinor: 100, lines: [] }, proposedValues: null }], nextCursor: null } : { status: "completed" }));
  render(<SaleCorrections branchId="branch-1" source={null} canCreate canApprove />);
  await screen.findByText("COR-CANCEL · SAL-001 · Approved — processing required");
  expect(screen.queryByLabelText("Replacement sale number")).toBeNull();
  fireEvent.change(screen.getByLabelText("Posted return/cancellation numbers (comma separated)"), { target: { value: "RTN-001" } });
  fireEvent.change(screen.getByLabelText("Review / completion reason"), { target: { value: "Verified original completely reversed" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify linked transactions and complete" }));
  await waitFor(() => expect(api.call).toHaveBeenCalledWith("salesCorrections", expect.objectContaining({ action: "complete_cancellation", returnNumbers: ["RTN-001"] })));
});
