// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProductsPage from "@/app/(protected)/products/page";

const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/features/administration/api", () => ({ callAdministration: api.call }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({ profile: { status: "active", roleId: "system_administrator", roleIds: ["system_administrator"] } }) }));
vi.mock("@/features/administration/use-organization-collection", () => ({
  useOrganizationCollection: (name: string) => ({
    data: name === "products" ? [{ id: "p1", name: "Solar panel", sku: "SOLAR-1", trackingType: "quantity", unitOfMeasure: "unit", active: true }] : name === "inventoryLocations" ? [{ id: "l1", name: "Head Office Stock" }] : [],
    loading: false,
    error: null,
  }),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("product catalogue history", () => {
  it("creates a catalogue service with no physical tracking or inventory unit cost", async () => {
    api.call.mockResolvedValue({ productId: "service", saved: true });
    render(<ProductsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Create product" }));
    fireEvent.change(screen.getByLabelText(/Catalogue item type/), { target: { value: "service" } });
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Installation service" } });
    expect((screen.getByLabelText("Tracking") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText("Default unit cost (₦)") as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save securely" }));
    await waitFor(() => expect(api.call).toHaveBeenCalledWith("saveProduct", expect.objectContaining({ itemKind: "service", name: "Installation service", trackingType: "quantity", defaultUnitCostMinor: 0, minimumStockLevel: 0, reorderLevel: 0 })));
  });
  it("expands a short history in place before opening the full detail", async () => {
    api.call.mockResolvedValue({ rows: [] });
    render(<ProductsPage />);
    const product = screen.getByRole("button", { name: /Solar panel/ });
    expect(product.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(product);
    expect(product.getAttribute("aria-expanded")).toBe("true");
    await waitFor(() => expect(api.call).toHaveBeenCalledWith("getSkuMovementHistory", expect.objectContaining({ productId: "p1" })));
    expect(screen.getByRole("link", { name: /Full product history/ }).getAttribute("href")).toBe("/products/p1#movement-history");
  });
});
