// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PostingForm } from "@/features/inventory/posting-form";
const state = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/features/administration/api", () => ({ callAdministration: state.call }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({ profile: { status: "active", roleId: "system_administrator", roleIds: ["system_administrator"] } }) }));
vi.mock("@/features/administration/use-organization-collection", () => ({ useOrganizationCollection: (name: string) => ({ loading: false, error: null, data: name === "products" ? [{ id: "panel", name: "620W Solar Panel", sku: "P-620", active: true, trackingType: "quantity", unitOfMeasure: "unit" }] : name === "productCosts" ? [{ id: "panel", productId: "panel", defaultUnitCostMinor: 50000 }] : name === "inventoryLocations" ? [{ id: "stock", branchId: "civic", name: "Civic stock", type: "branch", status: "active" }] : name === "branches" ? [{ id: "civic", name: "Civic Center", code: "CC", status: "active" }] : [] }) }));
vi.mock("@/features/finance/financial-privacy", () => ({ FinancialText: ({children}: {children: React.ReactNode}) => <>{children}</>, FinancialValue: ({children}: {children: React.ReactNode}) => <>{children}</>, FinancialMessage: ({children}: {children: React.ReactNode}) => <>{children}</>, FinancialInput: ({children}: {children: React.ReactNode}) => <>{children}</> }));
afterEach(() => { cleanup(); state.call.mockReset(); });
it("posts a reviewed entry cost while retaining the product default and reuses the same key after an interrupted response", async () => {
  state.call.mockRejectedValueOnce(new Error("Response interrupted"));
  state.call.mockResolvedValueOnce({ transactionNumber: "INV-NEW", posted: false });
  render(<PostingForm mode="opening" initialProductId="panel" initialLocationId="stock" replacementReference="INV-ORIGINAL" />);
  expect(screen.getByRole("option", {name:"620W Solar Panel · P-620"})).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox", {name:/Use a different unit cost/}));
  fireEvent.change(screen.getByLabelText("Replacement unit cost (₦)"), {target:{value:"450"}});
  fireEvent.change(screen.getByRole("spinbutton", {name:/3. Quantity/}), {target:{value:"5"}});
  fireEvent.click(screen.getByRole("button", {name:"Add stock to inventory"}));
  await screen.findByText("Response interrupted");
  expect(state.call.mock.calls[0]).toEqual(["postOpeningStock", expect.objectContaining({ productId: "panel", destinationLocationId: "stock", quantity: 5, unitCostMinor: 45000, referenceNumber: "Correction of INV-ORIGINAL" })]);
  fireEvent.click(screen.getByRole("button", {name:"Add stock to inventory"}));
  await waitFor(() => expect(state.call).toHaveBeenCalledTimes(2));
  expect(state.call.mock.calls[1]).toEqual(state.call.mock.calls[0]);
  await screen.findByText(/already recorded/);
});
it("explains the server's five-character reason requirement before submitting an adjustment", async () => {
  render(<PostingForm mode="adjustment" initialProductId="panel" />);
  fireEvent.change(screen.getByLabelText("Location"), {target:{value:"stock"}});
  fireEvent.change(screen.getByLabelText("Reason"), {target:{value:"fix"}});
  fireEvent.click(screen.getByRole("button", {name:"Save inventory record"}));
  await screen.findByRole("alert");
  expect(screen.getByRole("alert").textContent).toContain("at least 5 characters");
  expect(state.call).not.toHaveBeenCalled();
});
