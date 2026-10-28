// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ProformasPage from "@/app/(protected)/proformas/page";

const state = vi.hoisted(() => ({ api: vi.fn(), allowed: true, quote: null as Record<string, unknown> | null }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({ profile: { uid: "quoter", organizationId: "org", branchIds: ["a"] }, operatingContext: { type: "branch", id: "a" } }) }));
vi.mock("@/lib/permissions/roles", () => ({ hasPermission: (_profile: unknown, permission: string) => permission === "sales.order.create" ? state.allowed : true }));
vi.mock("@/features/administration/use-organization-collection", () => ({ useOrganizationCollection: () => ({ data: [{ id: "a", name: "Store A", status: "active" }] }) }));
vi.mock("@/features/administration/api", () => ({ callAdministration: state.api }));
const product = { id: "product", name: "Synthetic panel", unitPriceMinor: 10000, wholesalePriceMinor: 8000 };
beforeEach(() => {
  state.api.mockReset(); state.allowed = true; state.quote = null;
  state.api.mockImplementation(async (name, input) => {
    if (name === "getPosWorkspace") return { products: [product], customers: [] };
    if (input.action === "list_proformas") return { rows: state.quote ? [state.quote] : [], nextCursorId: null };
    if (input.action === "create_proforma") {
      state.quote = { id: "q", branchId: "a", branchName: "Store A", companyName: "Synthetic", customerName: "Prospective", number: "PF-Q", createdAt: "2026-10-28T10:00:00Z", validUntil: input.validUntil, expiresAt: "2099-01-01T00:00:00Z", subtotalAmountMinor: 49380, discountAmountMinor: 0, netAmountMinor: 49380, vatAmountMinor: 0, grossAmountMinor: 49380, lines: [{ ...input.lines[0], productName: product.name, sku: "SYN", unitOfMeasure: "unit", priceSource: "custom", vatAmountMinor: 0, grossAmountMinor: 49380 }] };
      return { proformaId: "q" };
    }
    if (input.action === "get_proforma") return state.quote;
    throw new Error("Unexpected API operation");
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function draft() {
  render(<ProformasPage />); await screen.findByRole("heading", { name: "Create proforma" });
  fireEvent.change(screen.getByLabelText("Valid through (Lagos date)"), { target: { value: "2099-01-01" } });
  fireEvent.click(screen.getByRole("button", { name: "Add quoted product" }));
  fireEvent.change(screen.getByLabelText("Quoted product 1"), { target: { value: "product" } });
}
it("retains custom decimals through quantity edits, save, reopen and print rendering", async () => {
  await draft();
  fireEvent.change(screen.getByLabelText("Custom quoted unit price 1 (₦)"), { target: { value: "123.45" } });
  fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "4" } });
  const print = vi.spyOn(window, "print").mockImplementation(() => {});
  fireEvent.click(screen.getByRole("button", { name: "Save nonposting proforma" }));
  await screen.findByRole("dialog", { name: "Proforma quotation" });
  expect(state.api).toHaveBeenCalledWith("createPosSaleOrder", expect.objectContaining({ lines: [{ productId: "product", quantity: 4, priceTier: "retail", unitPriceMinor: 12345 }] }));
  expect(screen.getByRole("dialog").textContent).toContain("Custom quoted price");
  expect(screen.getByRole("dialog").textContent).toContain("123.45");
  fireEvent.click(screen.getByRole("button", { name: "Close", exact: true }));
  fireEvent.click(await screen.findByRole("button", { name: "View proforma" }));
  expect(screen.getByRole("dialog").textContent).toContain("123.45");
  fireEvent.click(screen.getByRole("button", { name: "Print proforma / save PDF" }));
  expect(print).toHaveBeenCalledOnce();
});
it("clears custom pricing when a preset is selected and submits no override", async () => {
  await draft();
  fireEvent.change(screen.getByLabelText("Custom quoted unit price 1 (₦)"), { target: { value: "123.45" } });
  fireEvent.change(screen.getByLabelText("Price tier"), { target: { value: "wholesale" } });
  expect((screen.getByLabelText("Custom quoted unit price 1 (₦)") as HTMLInputElement).value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Save nonposting proforma" }));
  await waitFor(() => expect(state.api).toHaveBeenCalledWith("createPosSaleOrder", expect.objectContaining({ lines: [{ productId: "product", quantity: 1, priceTier: "wholesale" }] })));
});
it("blocks invalid decimals locally without sending a create request", async () => {
  await draft();
  fireEvent.change(screen.getByLabelText("Custom quoted unit price 1 (₦)"), { target: { value: "1.234" } });
  const button = screen.getByRole("button", { name: "Save nonposting proforma" });
  expect(button.hasAttribute("disabled")).toBe(true);
  expect(screen.getByText(/Quoted product 1: Enter a non-negative quoted unit price/).textContent).toContain("two decimal places");
  fireEvent.click(button);
  expect(state.api.mock.calls.some(([name]) => name === "createPosSaleOrder")).toBe(false);
});
it("explains a missing expiry, becomes saveable when completed, and points users to preview printing", async () => {
  await draft();
  fireEvent.change(screen.getByLabelText("Valid through (Lagos date)"), { target: { value: "" } });
  const button = screen.getByRole("button", { name: "Save nonposting proforma" });
  expect(button.hasAttribute("disabled")).toBe(true);
  expect(screen.getByText(/Choose Valid through \(Lagos date\) above/)).toBeTruthy();
  expect(screen.getByText(/Save the quotation to open its preview/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Valid through (Lagos date)"), { target: { value: "2099-01-01" } });
  expect(button.hasAttribute("disabled")).toBe(false);
});
it("retries an uncertain save using the identical custom price, quantity and idempotency key", async () => {
  const original = state.api.getMockImplementation()!;
  let interrupted = false;
  state.api.mockImplementation(async (name, input) => {
    if (input.action === "create_proforma" && !interrupted) { interrupted = true; throw new Error("Connection interrupted"); }
    return original(name, input);
  });
  await draft();
  fireEvent.change(screen.getByLabelText("Custom quoted unit price 1 (₦)"), { target: { value: "123.45" } });
  fireEvent.click(screen.getByRole("button", { name: "Save nonposting proforma" }));
  const retry = await screen.findByRole("button", { name: "Retry same proforma" });
  expect(screen.getByLabelText("Custom quoted unit price 1 (₦)").closest("fieldset")?.disabled).toBe(true);
  fireEvent.click(retry);
  await screen.findByRole("dialog", { name: "Proforma quotation" });
  const creates = state.api.mock.calls.filter(([name]) => name === "createPosSaleOrder");
  expect(creates).toHaveLength(2); expect(creates[1][1]).toEqual(creates[0][1]);
});
it("does not offer quote creation or custom pricing to read-only users", async () => {
  state.allowed = false; render(<ProformasPage />); await screen.findByRole("heading", { name: "Saved quotations" });
  expect(screen.queryByRole("heading", { name: "Create proforma" })).toBeNull();
  expect(state.api.mock.calls.some(([name]) => name === "getPosWorkspace")).toBe(false);
});
