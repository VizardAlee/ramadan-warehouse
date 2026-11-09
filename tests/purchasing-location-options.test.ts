import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProcurementAccess } from "../functions/src/procurement/authorize";
const state = vi.hoisted(() => ({ rows: new Map<string, Record<string, unknown>>(), queries: [] as Array<Array<[string, unknown]>> }));
vi.mock("../functions/src/admin.js", () => {
  const snapshot = (path: string) => ({ id: path.split("/").at(-1)!, exists: state.rows.has(path), get: (field: string) => state.rows.get(path)?.[field] });
  function query(collection: string, filters: Array<[string, unknown]> = [], cursor = "", limit = Infinity) {
    return { where: (field: string, _operator: string, value: unknown) => query(collection, [...filters, [field, value]], cursor, limit), orderBy: () => query(collection, filters, cursor, limit), startAfter: (row: { id: string }) => query(collection, filters, row.id, limit), limit: (value: number) => query(collection, filters, cursor, value), get: async () => {
      state.queries.push(filters);
      const docs = [...state.rows.keys()].filter(path => path.startsWith(`${collection}/`)).sort().map(snapshot).filter(row => row.id > cursor && filters.every(([field, value]) => row.get(field) === value)).slice(0, limit);
      return { docs, empty: !docs.length, size: docs.length };
    } };
  }
  return { db: { doc: (path: string) => ({ get: async () => snapshot(path) }), collection: query } };
});
import { selectedPurchasingLocationOptions } from "../functions/src/procurement/location-options";
const buyer: ProcurementAccess = { userId: "buyer", organizationId: "org", roleId: "purchasing_manager", directRoleIds: ["purchasing_manager"], branchIds: [], warehouseIds: [], authorizationVersion: 1, organizationProcurementPermissions: [], allBranchProcurementPermissions: ["procurement.read"], assignedProcurementPermissions: [] };
beforeEach(() => { state.rows.clear(); state.queries = []; });
describe("selected purchasing receiving-location options", () => {
  it("loads a future branch and all501 active receiving locations beyond old global limits", async () => {
    for (let i = 0; i < 150; i++) state.rows.set(`branches/old-${i}`, { organizationId: "org", status: "active" });
    state.rows.set("branches/z-future", { organizationId: "org", status: "active" });
    for (let i = 0; i < 501; i++) state.rows.set(`inventoryLocations/location-${String(i).padStart(3, "0")}`, { organizationId: "org", branchId: "z-future", status: "active" });
    state.rows.set("inventoryLocations/inactive", { organizationId: "org", branchId: "z-future", status: "inactive" });
    state.rows.set("inventoryLocations/other-branch", { organizationId: "org", branchId: "other", status: "active" });
    state.rows.set("inventoryLocations/warehouse", { organizationId: "org", warehouseId: "warehouse", status: "active" });
    state.rows.set("inventoryLocations/foreign", { organizationId: "foreign", branchId: "z-future", status: "active" });
    const options = await selectedPurchasingLocationOptions(buyer, { branchId: "z-future" });
    expect(options.branches.map(row => row.id)).toEqual(["z-future"]); expect(options.warehouses).toEqual([]); expect(options.locations).toHaveLength(501);
    expect(state.queries).toHaveLength(2); expect(state.queries.every(filters => filters.some(([field, value]) => field === "branchId" && value === "z-future"))).toBe(true);
  });
  it("rejects foreign/inactive branches and warehouse-only scopes before returning metadata", async () => {
    for (const data of [{ organizationId: "foreign", status: "active" }, { organizationId: "org", status: "inactive" }]) {
      state.rows.set("branches/unavailable", data);
      await expect(selectedPurchasingLocationOptions(buyer, { branchId: "unavailable" })).rejects.toMatchObject({ code: "not-found" });
    }
    await expect(selectedPurchasingLocationOptions({ ...buyer, warehouseIds: ["old-assignment"] }, { warehouseId: "old-assignment" })).rejects.toMatchObject({ code: "permission-denied" });
    await expect(selectedPurchasingLocationOptions(buyer, { branchId: "branch/nested/document" })).rejects.toMatchObject({ code: "invalid-argument" });
    expect(state.queries).toEqual([]);
  });
});
