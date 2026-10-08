// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GoodsReceivedNotes } from "@/features/procurement/goods-received-note";
const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/features/administration/api", () => ({ callAdministration: api.call }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks(); });
describe("goods-received note", () => {
  it("pages recorded receipts and prints the selected handover without receiving more stock", async () => {
    const receipt = { id: "receipt", receiptNumber: "GRN-INV-001", productName: "Solar panel", quantity: 2, unitOfMeasure: "unit", receivedAt: "2026-10-08T09:00:00Z" };
    api.call.mockImplementation((_name: string, input: { receiptId?: string }) => Promise.resolve(input.receiptId ? { document: { ...receipt, organization: { legalName: "AB Ramadan", phoneNumbers: [] }, purchaseOrderNumber: "PO-001", supplierName: "Supplier", receivingStore: "Head Office", receivingLocationName: "Store stock", receivedByName: "Receiving staff", inventoryReference: "INV-001", serialNumbers: ["SERIAL-1", "SERIAL-2"] } } : { receipts: [receipt], nextCursor: "receipt" }));
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    render(<GoodsReceivedNotes purchaseOrderId="order" onClose={vi.fn()} />);
    await screen.findByText("Solar panel");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(api.call).toHaveBeenCalledWith("getProcurementWorkspace", expect.objectContaining({ purchaseOrderId: "order", cursor: "receipt", limit: 25 })));
    await screen.findByRole("button", { name: "Open note" });
    fireEvent.click(screen.getByRole("button", { name: "Open note" }));
    await screen.findByRole("dialog", { name: "Goods received note" });
    expect(screen.getByText("SERIAL-1, SERIAL-2")).toBeTruthy();
    expect(screen.getByText("GRN-INV-001")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Print / save PDF" }));
    expect(print).toHaveBeenCalledOnce();
    expect(api.call.mock.calls.every(([name]) => name === "getProcurementWorkspace")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Back to history" }));
    expect(screen.getByRole("dialog", { name: "Receiving history" })).toBeTruthy();
  });
});
