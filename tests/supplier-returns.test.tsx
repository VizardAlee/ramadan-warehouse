// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupplierReturns } from "@/features/procurement/supplier-returns";
const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/features/administration/api", () => ({ callAdministration: api.call }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const history = { invoiceNumber: "SUP-INV-001", lines: [{ id: "line-1", productId: "panel", productName: "Solar panel", quantity: 3, returnedQuantity: 0 }], returns: [], nextCursor: null };
function reads(_name: string, input: { view: string }) {
  return Promise.resolve(input.view === "supplier_return_receipts" ? { receipts: [{ id: "receipt-1", receiptNumber: "GRN-001", quantity: 3, returnedQuantity: 0, receivedAt: "2026-10-08T09:00:00Z" }], nextCursor: null } : history);
}
describe("supplier return dialog", () => {
  it("requires physical goods back and safely retries the exact linked correction", async () => {
    let attempts = 0;
    api.call.mockImplementation((name: string) => name === "postSupplierReturn" ? ++attempts === 1 ? Promise.reject(new Error("Connection lost")) : Promise.resolve({ journalNumber: "JRN-REV-1" }) : Promise.resolve({ ...history, returns: [{ id: "return-1", returnNumber: "SRT-1", productName: "Solar panel", quantity: 1, grossAmountMinor: 10000, payableReductionMinor: 7000, supplierCreditMinor: 3000, status: "posted" }] }));
    const complete = vi.fn();
    render(<SupplierReturns invoiceId="invoice-1" canPost canReverse onClose={vi.fn()} onComplete={complete} />);
    fireEvent.click(await screen.findByRole("button", { name: "Correct return" }));
    fireEvent.change(screen.getByLabelText("Reason for correction"), { target: { value: "Wrong product in credit note" } });
    expect((screen.getByRole("button", { name: "Reverse stock & credit" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("All goods in this return are physically back in the original store and inspected as resellable."));
    fireEvent.click(screen.getByRole("button", { name: "Reverse stock & credit" }));
    await screen.findByRole("button", { name: "Retry same correction" });
    expect((screen.getByRole("button", { name: "Cancel correction" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Close" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Post return & credit note" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry same correction" }));
    await screen.findByText(/reversal journal JRN-REV-1/);
    const posts = api.call.mock.calls.filter(([name]) => name === "postSupplierReturn");
    expect(posts).toHaveLength(2); expect(posts[0]![1]).toEqual(posts[1]![1]);
    expect(posts[0]![1]).toMatchObject({ action: "reverse_return", returnId: "return-1", goodsBackInStore: true });
    expect(complete).toHaveBeenCalledOnce();
  });

  it("shows reversed history but never offers stock restoration for held custody credits", async () => {
    api.call.mockResolvedValue({ ...history, returns: [
      { id: "held", returnNumber: "SRT-HELD", productName: "Panel", quantity: 1, heldHandover: true, status: "posted", grossAmountMinor: 10000 },
      { id: "reversed", returnNumber: "SRT-REV", productName: "Panel", quantity: 1, status: "reversed", grossAmountMinor: 10000, reversalJournalNumber: "JRN-1", reversalReason: "Incorrect original quantity" },
    ] });
    render(<SupplierReturns invoiceId="invoice-1" canPost canReverse onClose={vi.fn()} onComplete={vi.fn()} />);
    await screen.findByText(/Incorrect original quantity/);
    expect(screen.queryByRole("button", { name: "Correct return" })).toBeNull();
  });

  it("collects products into one atomic credit document and retries the complete unchanged payload", async () => {
    let attempts = 0;
    api.call.mockImplementation((name: string, input: { view: string; supplierInvoiceItemId?: string }) => {
      if (name === "postSupplierReturn") return ++attempts === 1 ? Promise.reject(new Error("Connection lost")) : Promise.resolve({ creditNoteReference: "MULTI-CN", returns: [{}, {}] });
      if (input.view === "supplier_returns") return Promise.resolve({ ...history, lines: [...history.lines, { id: "line-2", productId: "battery", productName: "Battery", quantity: 3, returnedQuantity: 0 }] });
      return Promise.resolve({ receipts: [{ id: input.supplierInvoiceItemId === "line-1" ? "receipt-1" : "receipt-2", receiptNumber: input.supplierInvoiceItemId === "line-1" ? "GRN-001" : "GRN-002", quantity: 3, returnedQuantity: 0 }], nextCursor: null });
    });
    const complete = vi.fn();
    render(<SupplierReturns invoiceId="invoice-1" canPost onClose={vi.fn()} onComplete={complete} />);
    await screen.findByRole("option", { name: /Solar panel/ });
    for (const [line, receipt, grn] of [["line-1", "receipt-1", "GRN-001"], ["line-2", "receipt-2", "GRN-002"]]) {
      fireEvent.change(screen.getByLabelText("Invoice product"), { target: { value: line } });
      await screen.findByRole("option", { name: new RegExp(grn!) });
      fireEvent.change(screen.getByLabelText("Original goods-received note"), { target: { value: receipt } });
      fireEvent.click(screen.getByRole("button", { name: "Add product to credit note" }));
    }
    expect(screen.getByRole("region", { name: "Credit note products" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Supplier credit-note reference"), { target: { value: "MULTI-CN" } });
    fireEvent.change(screen.getByLabelText("Reason for return"), { target: { value: "Supplier accepted both products" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Post return & credit note" }));
    await screen.findByRole("button", { name: "Retry same return" });
    expect((screen.getByRole("button", { name: "Remove Battery" }).closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Retry same return" }));
    await screen.findByText(/recorded for 2 products/);
    const posts = api.call.mock.calls.filter(([name]) => name === "postSupplierReturn");
    expect(posts).toHaveLength(2); expect(posts[0]![1]).toEqual(posts[1]![1]);
    expect(posts[0]![1].lines).toHaveLength(2);
    expect(posts[0]![1].lines.map((line: { receiptId: string }) => line.receiptId)).toEqual(["receipt-1", "receipt-2"]);
    expect(complete).toHaveBeenCalledOnce();
  });

  it("links held credit to the existing handover, restricts product/quantity and preserves its exact serial", async () => {
    api.call.mockImplementation((name: string, input: { view: string }) => name === "postSupplierReturn" ? Promise.resolve({ returnNumber: "SRT-HELD" }) : input.view === "supplier_returns" ? Promise.resolve({ ...history, lines: [{ ...history.lines[0], productId: "panel" }, { id: "other", productId: "other", productName: "Other product", quantity: 3, returnedQuantity: 0 }] }) : reads(name, input));
    render(<SupplierReturns invoiceId="invoice-1" canPost heldHandover={{ id: "handover-1", remaining: 1, productId: "panel", serialNumber: "SERIAL-1" }} onClose={vi.fn()} onComplete={vi.fn()} />);
    await screen.findByRole("option", { name: /Solar panel/ });
    expect(screen.queryByRole("option", { name: /Other product/ })).toBeNull();
    expect((screen.getByLabelText(/Serial numbers, if tracked/) as HTMLTextAreaElement).readOnly).toBe(true);
    fireEvent.change(screen.getByLabelText("Invoice product"), { target: { value: "line-1" } });
    await screen.findByRole("option", { name: /GRN-001/ });
    fireEvent.change(screen.getByLabelText("Original goods-received note"), { target: { value: "receipt-1" } });
    fireEvent.change(screen.getByLabelText("Supplier credit-note reference"), { target: { value: "HELD-CN-1" } });
    fireEvent.change(screen.getByLabelText("Reason for return"), { target: { value: "Supplier approved held unit credit" } });
    fireEvent.click(screen.getByRole("checkbox"));
    const quantity = screen.getByLabelText(/Quantity returned/);
    fireEvent.change(quantity, { target: { value: "2" } });
    expect((screen.getByRole("button", { name: "Post return & credit note" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(quantity, { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Post return & credit note" }));
    await screen.findByText(/physical stock was not issued again/);
    expect(api.call).toHaveBeenCalledWith("postSupplierReturn", expect.objectContaining({ heldHandoverId: "handover-1", quantity: 1, serialNumbers: ["SERIAL-1"] }));
  });
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
