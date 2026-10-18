// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ProformaLoader } from "@/features/pos/proforma-loader";
const api = vi.hoisted(() => vi.fn());
vi.mock("@/features/administration/api", () => ({ callAdministration: api }));
afterEach(() => { cleanup(); api.mockReset(); window.history.replaceState({}, "", "/pos"); });
const quote = { id: "quote", number: "PF-1", branchId: "a", expiresAt: "2099-01-01T00:00:00Z", customerId: "customer", lines: [{ productId: "product", productName: "Product", quantity: 2, priceTier: "retail", unitPriceMinor: 100 }] };
const current = { branch: { id: "a" }, products: [{ id: "product", availableQuantity: 10, unitPriceMinor: 500, itemKind: "goods" }], customers: [{ id: "customer" }] };
it("loads a fresh workspace for explicit review, retaining current prices rather than posting the quoted price", async () => {
  window.history.replaceState({}, "", "/pos?proformaId=quote");
  api.mockResolvedValueOnce(quote).mockResolvedValueOnce(current); const onLoad = vi.fn(() => true);
  render(<ProformaLoader branchId="a" online disabled={false} queued={new Map()} onLoad={onLoad} />);
  const button = await screen.findByRole("button", { name: "Load proforma into empty basket" });
  // The quote first loads asynchronously; wait for its heading before clicking.
  await screen.findByRole("heading", { name: "PF-1" }); fireEvent.click(button);
  await screen.findByRole("status"); expect(onLoad).toHaveBeenCalledExactlyOnceWith(quote, current);
  expect(api.mock.calls.map(call => call[0])).toEqual(["getSaleDocument", "getPosWorkspace"]);
});
it("rejects stock already queued on the device without loading or creating a sale", async () => {
  window.history.replaceState({}, "", "/pos?proformaId=quote");
  api.mockResolvedValueOnce(quote).mockResolvedValueOnce(current); const onLoad = vi.fn(() => true);
  render(<ProformaLoader branchId="a" online disabled={false} queued={new Map([["product", 9]])} onLoad={onLoad} />);
  await screen.findByRole("heading", { name: "PF-1" }); fireEvent.click(screen.getByRole("button", { name: "Load proforma into empty basket" }));
  expect((await screen.findByRole("alert")).textContent).toContain("quote reserved no goods"); expect(onLoad).not.toHaveBeenCalled();
});
it("rejects expired quotes before fetching stock and keeps offline conversion disabled", async () => {
  window.history.replaceState({}, "", "/pos?proformaId=quote"); api.mockResolvedValueOnce({ ...quote, expiresAt: "2000-01-01T00:00:00Z" });
  const view = render(<ProformaLoader branchId="a" online disabled={false} queued={new Map()} onLoad={() => true} />);
  await screen.findByRole("heading", { name: "PF-1" }); fireEvent.click(screen.getByRole("button", { name: "Load proforma into empty basket" }));
  expect((await screen.findByRole("alert")).textContent).toContain("expired"); expect(api).toHaveBeenCalledTimes(1);
  view.rerender(<ProformaLoader branchId="a" online={false} disabled={false} queued={new Map()} onLoad={() => true} />);
  expect(screen.getByRole("button", { name: "Load proforma into empty basket" }).hasAttribute("disabled")).toBe(true);
});
