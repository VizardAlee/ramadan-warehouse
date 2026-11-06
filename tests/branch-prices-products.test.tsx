// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ProductsPage from "@/app/(protected)/products/page";
const fixture = vi.hoisted(() => ({
  profile: { uid: "admin", organizationId: "org", roleId: "system_administrator", roleIds: ["system_administrator"], authorizationVersion: 1, branchIds: [], warehouseIds: [] },
  products: [{ id: "new-product", name: "Imported unpriced panel", sku: "NEW-PANEL", active: true, unitOfMeasure: "unit", trackingType: "quantity", itemKind: "stock" }],
}));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({ profile: fixture.profile, accessProfile: fixture.profile, operatingContext: null }) }));
vi.mock("@/features/auth/use-operating-context-options", () => ({ useOperatingContextOptions: () => ({ options: [{ id: "civic", name: "Civic Center", type: "branch" }] }) }));
vi.mock("@/lib/permissions/roles", () => ({ hasPermission: () => true }));
vi.mock("@/features/administration/use-organization-collection", () => ({ useOrganizationCollection: (name: string) => ({ data: name === "products" ? fixture.products : [], loading: false, error: null }) }));
vi.mock("@/features/inventory/use-location-inventory", () => ({ useLocationProductMembership: () => ({ productIds: new Set(["new-product"]), loading: false, error: null }) }));
vi.mock("@/features/products/catalog-import-dialog", () => ({ CatalogImportDialog: () => null }));
afterEach(cleanup);
it("opens branch pricing for an imported product without any central selling-price record", () => {
  render(<ProductsPage />);
  expect(screen.getByText("active")).toBeTruthy();
  expect(screen.queryByText("[object Object]")).toBeNull();
  const central = screen.getByRole("cell", { name: "Not configured", exact: true });
  expect(central.getAttribute("data-label")).toBe("Central retail");
  fireEvent.click(screen.getByRole("button", { name: "Branch prices" }));
  fireEvent.change(screen.getByLabelText("Pricing branch"), { target: { value: "civic" } });
  fireEvent.click(screen.getByRole("button", { name: "Review branch prices" }));
  expect(screen.getByRole("dialog", { name: "Branch selling prices" }).textContent).toContain("No central price exists");
  expect((screen.getByLabelText("Branch VAT (%) — optional") as HTMLInputElement).value).toBe("");
});
