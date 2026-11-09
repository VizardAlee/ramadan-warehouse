// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CollectionQueue } from "@/features/pos/collection-queue";
const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/features/administration/api", () => ({ callAdministration: api.call }));
vi.mock("@/features/pos/sale-document", () => ({ SaleDocumentDialog: () => null }));
afterEach(() => { cleanup(); sessionStorage.clear(); vi.clearAllMocks(); });
describe("physical collection queue", () => {
  it("requires eligible serials and freezes the exact selection during uncertain retries", async () => {
    api.call.mockImplementation(async (name, payload) => {
      if (name === "confirmPosSaleOrder") throw new Error("Network interrupted");
      if (payload.action === "list_collections") return { rows: [{ id: "s", saleNumber: "S", customerName: "Musa", totalQuantity: 2, collectedQuantity: 0 }], nextCursor: null };
      return { branch: { id: "b" }, sale: { id: "s", saleNumber: "S" }, items: [{ id: "i", productName: "Inverter", trackingType: "serial", quantity: 2, collectedQuantity: 0, serialNumbers: ["A", "B"], collectedSerialNumbers: [], cancelledSerialNumbers: [] }] };
    });
    render(<CollectionQueue branchId="b" ownerKey="org:user:b" canRelease online />);
    fireEvent.click(await screen.findByRole("button", { name: "Review collection" }));
    const serials = await screen.findByLabelText(/Serials handed over for Inverter/);
    fireEvent.change(screen.getByLabelText("Collect quantity for Inverter"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Collector name"), { target: { value: "Musa" } });
    const submit = screen.getByRole("button", { name: "Record physical collection" });
    expect(submit.hasAttribute("disabled")).toBe(true);
    fireEvent.change(serials, { target: { value: "C" } });
    expect(submit.hasAttribute("disabled")).toBe(true);
    fireEvent.change(serials, { target: { value: "a" } });
    expect(submit.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /physically been handed/ }));
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
      return { branch: { id: "branch1" }, official: true, sale: { id: "sale1", saleNumber: "SAL-1", collectionStatus: "awaiting_collection" }, items: [{ id: "item1", productName: "Panel", quantity: 4, collectedQuantity: 0 }] };
    });
    render(<CollectionQueue branchId="branch1" ownerKey="org:user:branch1" canRelease online />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Review collection" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Review collection" }));
    await waitFor(() => expect(screen.getByLabelText("Collect quantity for Panel")).toBeTruthy());
    const submit = screen.getByRole("button", { name: "Record physical collection" });
    expect(submit.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("Collect quantity for Panel"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Collector name"), { target: { value: "Amina Musa" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /physically been handed/ }));
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

const invoice = { branch: { id: "branch1" }, sale: { id: "sale1", saleNumber: "SAL-1", collectionStatus: "awaiting_collection" }, items: [{ id: "item1", productName: "Panel", trackingType: "quantity", quantity: 4, collectedQuantity: 1, cancelledQuantity: 1 }] };
function setupInvoice() {
  api.call.mockImplementation(async (name, payload) => {
    if (name === "confirmPosSaleOrder") return { recorded: true };
    if (payload.action === "list_collections") return { rows: [{ id: "sale1", saleNumber: "SAL-1", customerName: "Amina", totalQuantity: 4, collectedQuantity: 1, cancelledQuantity: 1, reservedAt: null }], nextCursor: null };
    return invoice;
  });
}
async function fillHandover() {
  await screen.findByLabelText("Collect quantity for Panel");
  fireEvent.click(screen.getByRole("button", { name: "Use all remaining quantities" }));
  fireEvent.change(screen.getByLabelText("Collector name"), { target: { value: "Amina Musa" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /physically been handed/ }));
}
describe("prominent physical handover", () => {
  it("opens the exact new invoice, requires an actual confirmation and fills only uncancelled remaining units", async () => {
    setupInvoice();
    render(<CollectionQueue branchId="branch1" ownerKey="org:user:branch1" canRelease online handover={{ saleId: "sale1", choice: "now" }} />);
    await fillHandover();
    expect((screen.getByLabelText("Collect quantity for Panel") as HTMLInputElement).value).toBe("2");
    expect(api.call.mock.calls.filter(([name]) => name === "confirmPosSaleOrder")).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Collect quantity for Panel"), { target: { value: "1" } });
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole("button", { name: "Record physical collection" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Record physical collection" }));
    await screen.findByText(/Physical handover recorded/);
    expect(api.call.mock.calls.filter(([name]) => name === "confirmPosSaleOrder")).toHaveLength(1);
    expect(api.call.mock.calls.find(([name]) => name === "confirmPosSaleOrder")![1]).toMatchObject({ saleId: "sale1", lines: [{ saleItemId: "item1", quantity: 1 }], collector: "Amina Musa" });
  });

  it("leaves collect-later and close/reopen as non-posting actions, clearing unconfirmed form details", async () => {
    setupInvoice(); const dismiss = vi.fn();
    const view = render(<CollectionQueue branchId="branch1" ownerKey="org:user:branch1" canRelease online handover={{ saleId: "sale1", choice: "later" }} onDismissHandover={dismiss} />);
    await fillHandover();
    expect(screen.getByText("Collect later selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close handover review" }));
    expect(dismiss).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText("Collector name")).toBeNull();
    expect(screen.getByText(/Review closed. Closing does not cancel the sale/)).toBeTruthy();
    view.rerender(<CollectionQueue branchId="branch1" ownerKey="org:user:branch1" canRelease online />);
    fireEvent.click(screen.getByRole("button", { name: "Review collection" }));
    expect((await screen.findByLabelText("Collector name") as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect(api.call.mock.calls.some(([name]) => name === "confirmPosSaleOrder")).toBe(false);
  });

  it("routes a payment-only user to store staff without exposing physical release", async () => {
    setupInvoice();
    render(<CollectionQueue branchId="branch1" ownerKey="org:cashier:branch1" canRelease={false} online handover={{ saleId: "sale1", choice: "now" }} />);
    expect((await screen.findByLabelText("Collect quantity for Panel")).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Next: authorized store handover")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Record physical collection" })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(api.call.mock.calls.some(([name]) => name === "confirmPosSaleOrder")).toBe(false);
  });

  it("recovers an uncertain collection after reload without auto-posting or changing its payload", async () => {
    setupInvoice();
    const normal = api.call.getMockImplementation()!;
    api.call.mockImplementation((name, payload) => name === "confirmPosSaleOrder" ? Promise.reject(new Error("Network interrupted")) : normal(name, payload));
    const view = render(<CollectionQueue branchId="branch1" ownerKey="org:user:branch1" canRelease online handover={{ saleId: "sale1", choice: "now" }} />);
    await fillHandover(); fireEvent.click(screen.getByRole("button", { name: "Record physical collection" }));
    await screen.findByRole("alert");
    const original = api.call.mock.calls.find(([name]) => name === "confirmPosSaleOrder")![1];
    expect(screen.getByRole("button", { name: "Close handover review" }).hasAttribute("disabled")).toBe(true);
    view.unmount();
    api.call.mockImplementation(normal);
    render(<CollectionQueue branchId="branch1" ownerKey="org:user:branch1" canRelease online />);
    const retry = await screen.findByRole("button", { name: "Retry same collection" });
    await waitFor(() => expect(retry.hasAttribute("disabled")).toBe(false));
    expect((screen.getByLabelText("Collector name") as HTMLInputElement).value).toBe("Amina Musa");
    expect(api.call.mock.calls.filter(([name]) => name === "confirmPosSaleOrder")).toHaveLength(1);
    fireEvent.click(retry);
    await screen.findByText(/Physical handover recorded/);
    expect(api.call.mock.calls.filter(([name]) => name === "confirmPosSaleOrder")[1]![1]).toEqual(JSON.parse(JSON.stringify(original)));
    expect(sessionStorage.getItem("abr-pos-collection:org:user:branch1:branch1")).toBeNull();
  });

  it("does not reuse another staff member's saved collection or accept a foreign-branch invoice", async () => {
    sessionStorage.setItem("abr-pos-collection:org:other:branch1:branch1", JSON.stringify({ action: "collect", saleId: "sale1", lines: [{ saleItemId: "item1", quantity: 1 }], collector: "Other collector", idempotencyKey: crypto.randomUUID() }));
    setupInvoice(); const normal = api.call.getMockImplementation()!;
    api.call.mockImplementation((name, payload) => payload.saleId ? Promise.resolve({ ...invoice, branch: { id: "foreign" } }) : normal(name, payload));
    render(<CollectionQueue branchId="branch1" ownerKey="org:user:branch1" canRelease online handover={{ saleId: "sale1", choice: "now" }} />);
    expect((await screen.findByRole("alert")).textContent).toContain("does not belong to the selected branch");
    expect(screen.queryByRole("button", { name: "Retry same collection" })).toBeNull();
    expect(screen.queryByLabelText("Collector name")).toBeNull();
  });

  it("distinguishes a successful release from a failed receipt refresh and prevents a double click", async () => {
    setupInvoice(); const normal = api.call.getMockImplementation()!;
    let released = false;
    api.call.mockImplementation(async (name, payload) => {
      if (name === "confirmPosSaleOrder") { released = true; return { recorded: true }; }
      if (released && payload.saleId) throw new Error("Invoice refresh unavailable");
      return normal(name, payload);
    });
    render(<CollectionQueue branchId="branch1" ownerKey="org:user:branch1" canRelease online handover={{ saleId: "sale1", choice: "now" }} />);
    await fillHandover(); const submit = screen.getByRole("button", { name: "Record physical collection" });
    fireEvent.click(submit); fireEvent.click(submit);
    expect((await screen.findByRole("alert")).textContent).toContain("Handover was recorded");
    expect(screen.queryByRole("button", { name: "Retry same collection" })).toBeNull();
    expect(api.call.mock.calls.filter(([name]) => name === "confirmPosSaleOrder")).toHaveLength(1);
  });
});


describe("newly confirmed invoice navigation", () => {
  it("refreshes the collection list so a new handover remains reachable after closing its review", async () => {
    setupInvoice(); const normal = api.call.getMockImplementation()!; let paid = false;
    api.call.mockImplementation((name, payload) => payload.action === "list_collections" && !paid ? Promise.resolve({ rows: [], nextCursor: null }) : normal(name, payload));
    const view = render(<CollectionQueue branchId="branch1" ownerKey="org:user:branch1" canRelease online />);
    await screen.findByText("No goods awaiting collection on this page.");
    paid = true;
    view.rerender(<CollectionQueue branchId="branch1" ownerKey="org:user:branch1" canRelease online handover={{ saleId: "sale1", choice: "now" }} />);
    await screen.findByLabelText("Collector name");
    expect(await screen.findByRole("button", { name: "Review collection" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close handover review" }));
    view.rerender(<CollectionQueue branchId="branch1" ownerKey="org:user:branch1" canRelease online />);
    fireEvent.click(screen.getByRole("button", { name: "Review collection" }));
    expect(await screen.findByLabelText("Collector name")).toBeTruthy();
    expect(api.call.mock.calls.some(([name]) => name === "confirmPosSaleOrder")).toBe(false);
  });
});
