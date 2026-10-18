// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProductsPage from "@/app/(protected)/products/page";
import { ProductHistoryPreview } from "@/features/reports/product-history-preview";
import type { InventoryEntry } from "@/types/domain";

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

function movement(id: string, locationId: string, day: number, quantityDelta = day, overrides: Partial<InventoryEntry> = {}): InventoryEntry {
  return { id, organizationId: "org", productId: "p1", sku: "SOLAR-1", transactionId: id, transactionNumber: id,
    transactionType: "stock_adjustment", locationId, quantityDelta, unitCostMinor: 0, valueDeltaMinor: 0,
    currency: "NGN", balanceBefore: 0, balanceAfter: Math.max(0, quantityDelta), postedBy: "staff",
    reason: "Synthetic movement history", effectiveAt: `2026-10-${String(day).padStart(2, "0")}T10:00:00.000Z`,
    createdAt: "2026-10-18T10:00:00.000Z", ...overrides };
}
async function previewAcrossAreas(areaA: InventoryEntry[], areaB: InventoryEntry[]) {
  api.call.mockImplementation(async (_name: string, input: { locationId?: string }) => ({ rows: input.locationId === "area-a" ? areaA : areaB }));
  const view = render(<ProductHistoryPreview productId="p1" productName="Solar panel" locationIds={["area-b", "area-a"]}
    locations={{ "area-a": "Area A", "area-b": "Area B" }} reportRow={{}} />);
  await waitFor(() => expect(screen.queryByText("Loading recent activity…")).toBeNull());
  return [...view.container.querySelectorAll("ol > li")].map((item) => item.querySelector("p")?.textContent);
}

describe("multi-area product history chronology", () => {
  it("shows the newest five transactions globally across interleaved location pages", async () => {
    const descriptions = await previewAcrossAreas(
      [9, 7, 5, 3, 1].map(day => movement(`a-${day}`, "area-a", day)),
      [10, 8, 6, 4, 2].map(day => movement(`b-${day}`, "area-b", day)),
    );
    expect(descriptions).toEqual(["10 added to Area B.", "9 added to Area A.", "8 added to Area B.", "7 added to Area A.", "6 added to Area B."]);
  });
  it("groups both sides of an area-spanning transaction before taking five recent events", async () => {
    const descriptions = await previewAcrossAreas(
      [movement("move-source", "area-a", 10, -3, { transactionId: "move", transactionType: "location_transfer" }),
        ...[8, 6, 4, 2].map(day => movement(`a-${day}`, "area-a", day))],
      [movement("move-destination", "area-b", 10, 3, { transactionId: "move", transactionType: "location_transfer" }),
        ...[9, 7, 5, 3].map(day => movement(`b-${day}`, "area-b", day))],
    );
    expect(descriptions).toEqual(["Moved 3 from Area A to Area B.", "9 added to Area B.", "8 added to Area A.", "7 added to Area B.", "6 added to Area A."]);
    expect(screen.getAllByText("Stock moved")).toHaveLength(1);
  });
  it("orders timestamp objects precisely and breaks equal-time ties by entry ID", async () => {
    const seconds = Date.parse("2026-10-10T10:00:00Z") / 1000;
    const descriptions = await previewAcrossAreas(
      [movement("z-tie", "area-a", 10, 1, { effectiveAt: { seconds, nanoseconds: 500000000 } })],
      [movement("a-tie", "area-b", 10, 2, { effectiveAt: "2026-10-10T10:00:00.500Z" }),
        movement("newest-nanosecond", "area-b", 10, 3, { effectiveAt: { seconds, nanoseconds: 500000001 } })],
    );
    expect(descriptions).toEqual(["3 added to Area B.", "2 added to Area B.", "1 added to Area A."]);
  });
});
