// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CollectionQueue } from "@/features/pos/collection-queue";
const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/features/administration/api", () => ({ callAdministration: api.call }));
vi.mock("@/features/pos/sale-document", () => ({ SaleDocumentDialog: () => null }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("physical collection queue", () => {
  it("requires eligible serials and freezes the exact selection during uncertain retries", async () => {
    api.call.mockImplementation(async (name, payload) => {
      if (name === "confirmPosSaleOrder") throw new Error("Network interrupted");
      if (payload.action === "list_collections") return { rows: [{ id: "s", saleNumber: "S", customerName: "Musa", totalQuantity: 2, collectedQuantity: 0 }], nextCursor: null };
      return { sale: { id: "s", saleNumber: "S" }, items: [{ id: "i", productName: "Inverter", trackingType: "serial", quantity: 2, collectedQuantity: 0, serialNumbers: ["A", "B"], collectedSerialNumbers: [], cancelledSerialNumbers: [] }] };
    });
    render(<CollectionQueue branchId="b" canRelease online />);
    fireEvent.click(screen.getByRole("button", { name: "Goods awaiting collection" }));
    fireEvent.click(await screen.findByRole("button", { name: "Review collection" }));
    const serials = await screen.findByLabelText(/Serials handed over for Inverter/);
    fireEvent.change(screen.getByLabelText("Collect quantity for Inverter"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Collector name"), { target: { value: "Musa" } });
    const submit = screen.getByRole("button", { name: "Record physical collection" });
    expect(submit.hasAttribute("disabled")).toBe(true);
    fireEvent.change(serials, { target: { value: "C" } });
    expect(submit.hasAttribute("disabled")).toBe(true);
    fireEvent.change(serials, { target: { value: "a" } });
    expect(submit.hasAttribute("disabled")).toBe(false);
    fireEvent.click(submit);
    await screen.findByRole("alert");
    expect(serials.hasAttribute("disabled")).toBe(true);
    expect(api.call.mock.calls.find(([name]) => name === "confirmPosSaleOrder")?.[1]).toMatchObject({ lines: [{ saleItemId: "i", quantity: 1, serialNumbers: ["A"] }] });
  });
  it("requires explicit quantity and collector, preserving the retry reference after an uncertain response", async () => {
    let attempt = 0;
    api.call.mockImplementation(async (name, payload) => {
      if (name === "confirmPosSaleOrder") { if (++attempt === 1) throw new Error("Network interrupted"); return { recorded: true }; }
      if (payload.action === "list_collections") return { rows: [{ id: "sale1", saleNumber: "SAL-1", customerName: "Amina", totalQuantity: 4, collectedQuantity: 0, reservedAt: null }], nextCursor: null };
      return { official: true, sale: { id: "sale1", saleNumber: "SAL-1", collectionStatus: "awaiting_collection" }, items: [{ id: "item1", productName: "Panel", quantity: 4, collectedQuantity: 0 }] };
    });
    render(<CollectionQueue branchId="branch1" canRelease online />);
    fireEvent.click(screen.getByRole("button", { name: "Goods awaiting collection" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Review collection" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Review collection" }));
    await waitFor(() => expect(screen.getByLabelText("Collect quantity for Panel")).toBeTruthy());
    const submit = screen.getByRole("button", { name: "Record physical collection" });
    expect(submit.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("Collect quantity for Panel"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Collector name"), { target: { value: "Amina Musa" } });
    fireEvent.click(submit);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Network interrupted"));
    expect(screen.getByLabelText("Collector name").hasAttribute("disabled")).toBe(true);
    expect(screen.getByLabelText("Collect quantity for Panel").hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Review collection" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Retry same collection" }));
    await waitFor(() => expect(attempt).toBe(2));
    expect(screen.getByLabelText("Collector name").hasAttribute("disabled")).toBe(false);
    const calls = api.call.mock.calls.filter(([name]) => name === "confirmPosSaleOrder");
    expect(calls[0]![1]).toMatchObject({ action: "collect", lines: [{ saleItemId: "item1", quantity: 2 }], collector: "Amina Musa" });
    expect(calls[1]![1].idempotencyKey).toBe(calls[0]![1].idempotencyKey);
  });
});
