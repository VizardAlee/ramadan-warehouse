import { beforeEach, expect, it, vi } from "vitest";
const store = vi.hoisted(() => ({ getAll: vi.fn(), products: new Map<string, Record<string, unknown>>() }));
vi.mock("../functions/src/admin.js", () => ({ db: { doc: (path: string) => path, getAll: (...paths: string[]) => store.getAll(...paths) } }));
import { inventoryProductLabels } from "../functions/src/inventory/product-labels";
beforeEach(() => { store.products.clear(); store.getAll.mockReset(); store.getAll.mockImplementation(async (...paths: string[]) => paths.map(path => ({ id: path.split("/").at(-1), get: (key: string) => store.products.get(path)?.[key] }))); });
it("adds human names without modifying movement snapshots or exposing another organization's catalogue", async () => {
  store.products.set("products/panel", { organizationId: "org", name: "620W Solar Panel", defaultUnitCostMinor: 9000 });
  store.products.set("products/foreign", { organizationId: "other", name: "Private foreign name" });
  const rows = [{ productId: "panel", sku: "P-620" }, { productId: "panel", productName: "Historical panel name" }, { productId: "foreign" }, { productId: "missing" }];
  const result = await inventoryProductLabels("org", rows);
  expect(result[0]).toEqual({ productId: "panel", sku: "P-620", productName: "620W Solar Panel" });
  expect(result[1]!.productName).toBe("Historical panel name");
  expect(result[2]!.productName).toBe("Product name unavailable");
  expect(result[3]!.productName).toBe("Product name unavailable");
  expect(rows[0]).not.toHaveProperty("productName");
  expect(store.getAll.mock.calls[0]).toHaveLength(3);
});
it("bounds catalogue lookups to the supplied page and does not read product names for an empty membership page", async () => {
  expect(await inventoryProductLabels("org", [])).toEqual([]);
  expect(store.getAll).not.toHaveBeenCalled();
  await inventoryProductLabels("org", Array.from({ length: 205 }, (_, index) => ({ productId: `p-${index}` })));
  expect(store.getAll.mock.calls.map(call => call.length)).toEqual([100, 100, 5]);
});
