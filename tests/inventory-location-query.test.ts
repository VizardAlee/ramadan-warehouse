import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessProfile } from "../functions/src/auth/authorize";

type Row = { id: string; [key: string]: unknown };
type Filter = [string, string, unknown];
const state = vi.hoisted(() => ({ rows: [] as Row[], actor: {} as AccessProfile, reads: [] as { count: number; projection?: string[]; filters: Filter[] }[], aggregates: 0, writes: vi.fn() }));
interface FixtureQuery {
  where: (key: string, operator: string, value: unknown) => FixtureQuery;
  orderBy: () => FixtureQuery;
  startAfter: (id: string) => FixtureQuery;
  limit: (count: number) => FixtureQuery;
  select: (...fields: string[]) => FixtureQuery;
  aggregate: (fields: Record<string, unknown>) => { get: () => Promise<{ data: () => Record<string, number> }> };
  get: () => Promise<{ docs: { id: string; get: (key: string) => unknown; data: () => Record<string, unknown> }[] }>;
}
function query(filters: Filter[] = [], maximum = Infinity, cursor?: string, projection?: string[]): FixtureQuery {
  const matching = () => state.rows.filter((row) => (!cursor || row.id > cursor) && filters.every(([key, operator, expected]) => operator === "in" ? (expected as unknown[]).includes(row[key]) : row[key] === expected)).sort((a, b) => Buffer.compare(Buffer.from(a.id), Buffer.from(b.id)));
  return {
    where: (key: string, operator: string, value: unknown) => query([...filters, [key, operator, value]], maximum, cursor, projection),
    orderBy: () => query(filters, maximum, cursor, projection),
    startAfter: (id: string) => query(filters, maximum, id, projection),
    limit: (count: number) => query(filters, count, cursor, projection),
    select: (...fields: string[]) => query(filters, maximum, cursor, fields),
    aggregate: (fields: Record<string, unknown>) => {
      state.aggregates++;
      return { get: async () => ({ data: () => Object.fromEntries(Object.entries(matching().reduce((total, row) => ({ count: total.count + 1, onHandQuantity: total.onHandQuantity + Number(row.onHandQuantity), reservedQuantity: total.reservedQuantity + Number(row.reservedQuantity), availableQuantity: total.availableQuantity + Number(row.availableQuantity), valueMinor: total.valueMinor + Number(row.totalValueMinor) }), { count: 0, onHandQuantity: 0, reservedQuantity: 0, availableQuantity: 0, valueMinor: 0 })).filter(([key]) => key in fields)) }) };
    },
    get: async () => {
      const values = matching().slice(0, maximum); state.reads.push({ count: values.length, projection, filters });
      return { docs: values.map((row) => ({ id: row.id, get: (key: string) => row[key], data: () => projection ? Object.fromEntries(projection.map((key) => [key, row[key]])) : Object.fromEntries(Object.entries(row).filter(([key]) => key !== "id")) })) };
    },
  };
}
vi.mock("../functions/src/admin.js", () => ({ db: { collection: () => query(), runTransaction: state.writes } }));
vi.mock("../functions/src/auth/authorize.js", async (original) => ({ ...await original<typeof import("../functions/src/auth/authorize")>(), requireAccess: async () => state.actor }));
vi.mock("../functions/src/config.js", () => ({ enforceAppCheck: false }));
import { generateStockPositionReport } from "../functions/src/callable/inventory-queries";
const invoke = (data: object) => generateStockPositionReport.run({ data } as never);
beforeEach(() => {
  state.rows = Array.from({ length: 1001 }, (_, index) => ({ id: `b-${String(index).padStart(4, "0")}`, organizationId: "org", branchId: "branch-a", warehouseId: null, locationId: "stock-a", productId: `p-${index}`, onHandQuantity: index ? 1 : 0, reservedQuantity: 0, availableQuantity: index ? 1 : 0, totalValueMinor: index ? 100 : 0, averageUnitCostMinor: 100 }));
  state.actor = { userId: "admin", organizationId: "org", roleId: "system_administrator", roleIds: ["system_administrator"], branchIds: [], warehouseIds: [], authorizationVersion: 1 };
  state.reads = []; state.aggregates = 0; state.writes.mockReset();
});
describe("bounded location inventory reads", () => {
  it("reads only one lookahead page, totals the full scope once, and never writes", async () => {
    const first = await invoke({ locationIds: ["stock-a"], limit: 25, includeCosts: true });
    expect(first.rows).toHaveLength(25); expect(first.summary).toMatchObject({ count: 1001, onHandQuantity: 1000, valueMinor: 100000 });
    expect(state.reads.map((r) => r.count)).toEqual([26]); expect(state.aggregates).toBe(1);
    const next = await invoke({ locationIds: ["stock-a"], limit: 25, cursor: first.nextCursor, withSummary: false });
    expect(next.rows).toHaveLength(25); expect(next.summary).toBeNull(); expect(state.aggregates).toBe(1); expect(state.writes).not.toHaveBeenCalled();
  });
  it("projects only membership IDs, preserves zero balances and performs no aggregates", async () => {
    const first = await invoke({ locationIds: ["stock-a"], view: "membership", limit: 500, includeCosts: true });
    expect(first.rows).toHaveLength(500); expect(first.rows[0]).toEqual({ id: "b-0000", productId: "p-0" });
    expect(first.includeCosts).toBe(false); expect(first.summary).toBeNull(); expect(state.aggregates).toBe(0);
    expect(state.reads[0]).toMatchObject({ count: 501, projection: ["productId"] });
  });
  it("does not require a final empty page on an exact page multiple", async () => {
    state.rows = state.rows.slice(0, 1000);
    const first = await invoke({ locationIds: ["stock-a"], view: "membership", limit: 500 });
    const second = await invoke({ locationIds: ["stock-a"], view: "membership", limit: 500, cursor: first.nextCursor });
    expect(second.rows).toHaveLength(500); expect(second.nextCursor).toBeNull(); expect(state.reads).toHaveLength(2);
  });
  it("merges more than 30 areas in global cursor order without duplicate rows", async () => {
    const ids = Array.from({ length: 35 }, (_, i) => `area-${i}`);
    state.rows = ids.map((locationId, i) => ({ ...state.rows[i], id: `b-${String(i).padStart(4, "0")}`, locationId }));
    const first = await invoke({ locationIds: [...ids, ids[0]], limit: 25 });
    const second = await invoke({ locationIds: ids, limit: 25, cursor: first.nextCursor, withSummary: false });
    expect(first.summary?.count).toBe(35); expect(first.rows).toHaveLength(25); expect(second.rows).toHaveLength(10); expect(second.nextCursor).toBeNull();
    expect(new Set([...first.rows, ...second.rows].map((r) => r.id)).size).toBe(35);
    expect(state.reads.every((r) => r.filters.filter(([key]) => key === "locationId").every(([, , values]) => (values as string[]).length <= 30))).toBe(true);
  });
  it("uses only an already assigned branch for a branch-context mixed-role reader", async () => {
    state.actor = { ...state.actor, roleId: "branch_manager", roleIds: ["warehouse_manager", "branch_manager"], branchIds: ["branch-a"], warehouseIds: [] };
    state.rows.push({ ...state.rows[0], id: "foreign", organizationId: "foreign-org" }, { ...state.rows[0], id: "other", branchId: "branch-b", warehouseId: "warehouse-b" });
    const result = await invoke({ locationIds: ["stock-a"], limit: 100, includeCosts: true });
    expect(result.rows.every((r) => r.branchId === "branch-a" && r.organizationId === "org")).toBe(true);
    expect(state.reads[0]!.filters).toContainEqual(["branchId", "in", ["branch-a"]]);
    expect(state.reads[0]!.filters.some(([key]) => key === "warehouseId")).toBe(false);
  });
  it("keeps costs redacted for a quantity-only warehouse reader", async () => {
    state.actor = { ...state.actor, roleId: "warehouse_officer", roleIds: ["warehouse_officer"], branchIds: [], warehouseIds: ["warehouse-a"] };
    state.rows = state.rows.map((row) => ({ ...row, warehouseId: "warehouse-a" }));
    const result = await invoke({ locationIds: ["stock-a"], includeCosts: true });
    expect(result.includeCosts).toBe(false); expect(result.rows[0]).not.toHaveProperty("totalValueMinor"); expect(result.rows[0]).not.toHaveProperty("averageUnitCostMinor"); expect(result.summary).not.toHaveProperty("valueMinor");
  });
  it("does not grant a branch read to warehouse-only roles with no warehouse assignment", async () => {
    state.actor = { ...state.actor, roleId: "warehouse_manager", roleIds: ["warehouse_manager"], branchIds: ["branch-a"], warehouseIds: [] };
    await expect(invoke({ locationIds: ["stock-a"] })).rejects.toMatchObject({ code: "permission-denied" });
    expect(state.reads).toHaveLength(0);
  });
  it.each([{ locationIds: [] }, { locationIds: ["a"], locationId: "b" }, { view: "positions", limit: 101 }, { locationIds: Array.from({ length: 301 }, (_, i) => `a-${i}`) }, { cursor: "bad/path" }])("rejects invalid bounds before querying: %j", async (input) => {
    await expect(invoke(input)).rejects.toMatchObject({ code: "invalid-argument" }); expect(state.reads).toHaveLength(0); expect(state.writes).not.toHaveBeenCalled();
  });
});
