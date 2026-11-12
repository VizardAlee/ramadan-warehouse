// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StockHandoverQueue } from "@/features/pos/stock-handover-queue";
const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/features/administration/api", () => ({ callAdministration: api.call }));
afterEach(() => { cleanup(); sessionStorage.clear(); vi.clearAllMocks(); });
function setup() {
  let attempt = 0;
  api.call.mockImplementation(async (name, payload) => {
    if (name === "confirmPosSaleOrder") { if (++attempt === 1) throw new Error("Network interrupted"); return { recorded: true }; }
    if (payload.action === "stock_collections") return { rows: [{ id: "s", saleNumber: "SAL-1", customerName: "Amina", remaining: 2 }], nextCursor: null };
    return { id: "s", saleNumber: "SAL-1", customerName: "Amina", items: [{ id: "i", productName: "Panel", unitOfMeasure: "piece", remaining: 2, trackingType: "quantity", serialNumbers: [] }] };
  });
}
it("requires explicit actual handover and retries one frozen request after interruption", async () => {
  setup(); render(<StockHandoverQueue branchId="b" scope="org:u" />);
  fireEvent.click(await screen.findByRole("button", { name: "Review handover" }));
  const input = await screen.findByLabelText("Quantity for Panel");
  const button = screen.getByRole("button", { name: "Record physical handover" });
  expect(button.hasAttribute("disabled")).toBe(true);
  fireEvent.change(input, { target: { value: "3" } });
  fireEvent.change(screen.getByLabelText("Collector name"), { target: { value: "Amina" } });
  fireEvent.click(screen.getByRole("checkbox"));
  expect(button.hasAttribute("disabled")).toBe(true);
  fireEvent.change(input, { target: { value: "1" } });
  expect(button.hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(button);
  await screen.findByRole("alert");
  expect(screen.queryByLabelText("Quantity for Panel")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry saved handover" }));
  await waitFor(() => expect(api.call.mock.calls.filter(([n]) => n === "confirmPosSaleOrder")).toHaveLength(2));
  const calls = api.call.mock.calls.filter(([n]) => n === "confirmPosSaleOrder");
  expect(calls[1][1]).toEqual(calls[0][1]);
  expect(calls[0][1].lines).toEqual([{ saleItemId: "i", quantity: 1 }]);
});
it("closing the review makes no release and leaves the queue available", async () => {
  setup(); render(<StockHandoverQueue branchId="b" scope="org:u" />);
  fireEvent.click(await screen.findByRole("button", { name: "Review handover" }));
  fireEvent.click(await screen.findByRole("button", { name: "Close without releasing" }));
  expect(api.call.mock.calls.some(([n]) => n === "confirmPosSaleOrder")).toBe(false);
  expect(screen.queryByLabelText("Collector name")).toBeNull();
});
