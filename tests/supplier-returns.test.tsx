// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupplierReturns } from "@/features/procurement/supplier-returns";
const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/features/administration/api", () => ({ callAdministration: api.call }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const history = { invoiceNumber: "SUP-INV-001", lines: [{ id: "line-1", productName: "Solar panel", quantity: 3, returnedQuantity: 0 }], returns: [], nextCursor: null };
function reads(_name: string, input: { view: string }) {
  return Promise.resolve(input.view === "supplier_return_receipts" ? { receipts: [{ id: "receipt-1", receiptNumber: "GRN-001", quantity: 3, returnedQuantity: 0, receivedAt: "2026-10-08T09:00:00Z" }], nextCursor: null } : history);
}
describe("supplier return dialog", () => {
  it("requires original receipt and acknowledgement; retries an uncertain posting with exactly the same key", async () => {
    let attempts = 0;
    api.call.mockImplementation((name: string, input: { view: string }) => name === "postSupplierReturn" ? ++attempts === 1 ? Promise.reject(new Error("Connection lost")) : Promise.resolve({ returnNumber: "SRT-001" }) : reads(name, input));
    const complete = vi.fn();
    render(<SupplierReturns invoiceId="invoice-1" canPost onClose={vi.fn()} onComplete={complete} />);
    await screen.findByText("SUP-INV-001", { exact: false });
    fireEvent.change(screen.getByLabelText("Invoice product"), { target: { value: "line-1" } });
    await screen.findByRole("option", { name: /GRN-001/ });
    fireEvent.change(screen.getByLabelText("Original goods-received note"), { target: { value: "receipt-1" } });
    fireEvent.change(screen.getByLabelText("Supplier credit-note reference"), { target: { value: "CN-001" } });
    fireEvent.change(screen.getByLabelText("Reason for return"), { target: { value: "Damaged goods" } });
    expect((screen.getByRole("button", { name: "Post return & credit note" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Post return & credit note" }));
    await screen.findByRole("button", { name: "Retry same return" });
    expect((screen.getByRole("button", { name: "Close" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Retry same return" }));
    await waitFor(() => expect(complete).toHaveBeenCalledOnce());
    const posts = api.call.mock.calls.filter(([name]) => name === "postSupplierReturn");
    expect(posts).toHaveLength(2); expect(posts[0]![1]).toEqual(posts[1]![1]);
    expect(posts[0]![1]).toMatchObject({ supplierInvoiceId: "invoice-1", supplierInvoiceItemId: "line-1", receiptId: "receipt-1", quantity: 1, creditNoteReference: "CN-001" });
  });
  it("lets read-only users page return history without exposing posting controls", async () => {
    api.call.mockResolvedValue({ ...history, nextCursor: "older-return" });
    render(<SupplierReturns invoiceId="invoice-1" canPost={false} onClose={vi.fn()} onComplete={vi.fn()} />);
    await screen.findByText("No goods returned for this invoice.");
    expect(screen.queryByText("Post return & credit note")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(api.call).toHaveBeenCalledWith("getProcurementWorkspace", expect.objectContaining({ cursor: "older-return", limit: 25 })));
  });
  it("keeps a definitive business rejection editable instead of trapping the user in retry", async () => {
    api.call.mockImplementation((name: string, input: { view: string }) => name === "postSupplierReturn" ? Promise.reject(Object.assign(new Error("Serial does not belong to this receipt"), { diagnosticCode: "SUPPLIER_RETURN_ACTION_REQUIRED" })) : reads(name, input));
    render(<SupplierReturns invoiceId="invoice-1" canPost onClose={vi.fn()} onComplete={vi.fn()} />);
    await screen.findByRole("option", { name: /Solar panel/ });
    fireEvent.change(screen.getByLabelText("Invoice product"), { target: { value: "line-1" } });
    await screen.findByRole("option", { name: /GRN-001/ });
    fireEvent.change(screen.getByLabelText("Original goods-received note"), { target: { value: "receipt-1" } });
    fireEvent.change(screen.getByLabelText("Supplier credit-note reference"), { target: { value: "CN-001" } });
    fireEvent.change(screen.getByLabelText("Reason for return"), { target: { value: "Damaged goods" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Post return & credit note" }));
    await screen.findByText("Serial does not belong to this receipt");
    expect(screen.queryByRole("button", { name: "Retry same return" })).toBeNull();
    expect((screen.getByRole("button", { name: "Close" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
