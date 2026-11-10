import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserProfile } from "../src/types/domain";
const state = vi.hoisted(() => ({ call: vi.fn(), get: vi.fn() }));
vi.mock("@/lib/firebase/client", () => ({ getFirebaseServices: () => ({ db: {}, functions: {} }) }));
vi.mock("firebase/functions", () => ({ httpsCallable: () => state.call }));
vi.mock("firebase/firestore", () => ({ collection: vi.fn(), doc: (_db: unknown, collection: string, id: string) => `${collection}/${id}`, getDoc: state.get, getDocs: vi.fn(), query: vi.fn(), where: vi.fn() }));
import { loadOperatingBranches } from "../src/features/auth/operating-context-metadata";
const profile: UserProfile = { id: "buyer", uid: "buyer", organizationId: "org", email: "buyer@example.test", displayName: "Buyer", authDisabled: false, authorizationVersion: 1, createdAt: "2026-11-09", createdBy: "fixture", updatedAt: "2026-11-09", updatedBy: "fixture", status: "active", roleId: "purchasing_manager", roleIds: ["purchasing_manager"], directRoleIds: ["purchasing_manager"], branchIds: [], warehouseIds: [] };
beforeEach(() => { state.call.mockReset(); state.get.mockReset(); });
describe("Purchasing Manager branch selector", () => {
  it("loads every branch page, including a future branch, and warehouse pages without raw warehouse access", async () => {
    state.call.mockResolvedValueOnce({ data: { rows: Array.from({ length: 200 }, (_, index) => ({ id: `b-${index}`, name: `Branch ${index}` })), nextCursor: "next" } }).mockResolvedValueOnce({ data: { rows: [{ id: "future", name: "Future branch" }], nextCursor: null } }).mockResolvedValueOnce({ data: { rows: [{ type: "warehouse", id: "new-warehouse", name: "New warehouse" }], nextCursor: null } });
    const rows = await loadOperatingBranches({ ...profile, warehouseIds: ["stale-warehouse"] });
    expect(rows).toHaveLength(202); expect(rows.at(-1)?.id).toBe("new-warehouse");
    expect(state.call.mock.calls[1]?.[0]).toMatchObject({ view: "operating_branches", cursor: "next", operatingContext: { type: "all" } });
    expect(state.get).not.toHaveBeenCalled();
  });
  it("loads all warehouse metadata through purchasing authority, including mixed roles", async () => {
    state.call.mockResolvedValueOnce({ data: { rows: [{ id: "branch", name: "Branch" }], nextCursor: null } }).mockResolvedValueOnce({ data: { rows: [{ type: "warehouse", id: "future", name: "Future warehouse" }], nextCursor: null } });
    const rows = await loadOperatingBranches({ ...profile, roleIds: ["purchasing_manager", "warehouse_officer"], directRoleIds: ["purchasing_manager", "warehouse_officer"], warehouseIds: ["own"] });
    expect(rows).toContainEqual({ type: "warehouse", id: "future", name: "Future warehouse" });
    expect(state.call.mock.calls[1]?.[0]).toMatchObject({ view: "operating_warehouses" });
    expect(state.get).not.toHaveBeenCalled();
  });
  it("rejects a repeated cursor instead of reporting a partial location list", async () => {
    state.call.mockResolvedValue({ data: { rows: [], nextCursor: "same" } });
    await expect(loadOperatingBranches(profile)).rejects.toThrow(/complete purchasing location list/);
  });
});
