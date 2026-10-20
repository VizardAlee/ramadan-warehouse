import { beforeEach, describe, expect, it, vi } from "vitest";
import { uniquenessDocumentId } from "../functions/src/inventory/calculations";
const state = vi.hoisted(() => ({ docs: new Map<string, Record<string, unknown>>(), query: vi.fn(), transaction: vi.fn(), reads: 0 }));
vi.mock("../functions/src/admin.js", () => {
  const snapshot = (data?: Record<string, unknown>) => ({ exists: Boolean(data), get: (path: string) => path.split(".").reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], data), data: () => data });
  return { db: {
    doc: (path: string) => ({ path, get: async () => { state.reads++; return snapshot(state.docs.get(path)); } }),
    runTransaction: async (work: (tx: unknown) => unknown) => {
      state.transaction();
      return work({ get: async (ref: { path: string }) => snapshot(state.docs.get(ref.path)), set: (ref: { path: string }, data: Record<string, unknown>) => state.docs.set(ref.path, data), update: (ref: { path: string }, data: Record<string, unknown>) => state.docs.set(ref.path, { ...state.docs.get(ref.path), ...data }) });
    },
    collection: () => {
      const query = { select: () => query, where: () => query, orderBy: () => query, limit: () => query, get: () => state.query() };
      return query;
    },
    getAll: () => { throw Error("Empty history must not read item/product evidence"); },
  } };
});
import { readPosFastMoving } from "../functions/src/sales/pos-fast-moving-store";
const key = (branch: string) => `posFastMovingSummaries/${uniquenessDocumentId("org", "posFastMoving", branch)}`;
function warm(branch: string) {
  state.docs.set(key(branch), { organizationId: "org", branchId: branch, version: 1, result: { version: 1, branchId: branch, status: "ready", productIds: ["safe-product"], asOf: new Date().toISOString(), expiresAt: new Date(Date.now() + 900000).toISOString(), privateRevenue: 100000, privateCost: 50000 } });
}
beforeEach(() => { state.docs.clear(); state.reads = 0; state.query.mockReset().mockResolvedValue({ docs: [], size: 0 }); state.transaction.mockClear(); });
describe("POS summary cache resource and privacy boundaries", () => {
  it("serves a warm cache with one direct read, no history scan and an explicit safe response", async () => {
    warm("one"); const result = await readPosFastMoving("org", "one");
    expect(result.productIds).toEqual(["safe-product"]);
    expect(Object.keys(result).sort()).toEqual(["version", "branchId", "status", "productIds", "asOf", "expiresAt"].sort());
    expect(state.reads).toBe(1); expect(state.query).not.toHaveBeenCalled(); expect(state.transaction).not.toHaveBeenCalled();
  });
  it("bounds cold calculations per instance while keeping a different warm branch responsive", async () => {
    let release!: (value: { docs: []; size: number }) => void;
    state.query.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const first = readPosFastMoving("org", "one");
    await vi.waitFor(() => expect(state.query).toHaveBeenCalledOnce());
    expect(await readPosFastMoving("org", "two")).toMatchObject({ status: "refreshing", productIds: [] });
    warm("three"); expect((await readPosFastMoving("org", "three")).status).toBe("ready");
    expect(state.query).toHaveBeenCalledOnce();
    release({ docs: [], size: 0 }); expect((await first).status).toBe("insufficient_history");
    expect((await readPosFastMoving("org", "two")).status).toBe("insufficient_history");
    expect(state.query).toHaveBeenCalledTimes(2);
  });
  it("releases the refresh slot after a failed calculation and caches no guessed ranking", async () => {
    state.query.mockRejectedValueOnce(Error("Synthetic read failure"));
    expect(await readPosFastMoving("org", "one")).toMatchObject({ status: "unavailable", productIds: [] });
    expect((await readPosFastMoving("org", "two")).status).toBe("insufficient_history");
  });
});
