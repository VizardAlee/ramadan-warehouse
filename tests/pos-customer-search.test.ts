import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown> & { id: string }> }));
function document(row?: Record<string, unknown> & { id: string }) {
  return { id: row?.id ?? "missing", exists: Boolean(row), get: (key: string) => row?.[key], data: () => row };
}
function query(organizationId?: string, after = "", count = 100) {
  return {
    where: (_field: string, _operator: string, value: string) => query(value, after, count),
    orderBy: () => query(organizationId, after, count),
    startAfter: (anchor: { id: string }) => query(organizationId, anchor.id, count),
    limit: (value: number) => query(organizationId, after, value),
    get: async () => {
      const rows = state.rows.filter(row => row.organizationId === organizationId && row.id > after).sort((a, b) => a.id.localeCompare(b.id)).slice(0, count).map(document);
      return { docs: rows, empty: rows.length === 0, size: rows.length };
    },
  };
}
vi.mock("../functions/src/admin.js", () => ({ db: { collection: () => query(), doc: (path: string) => ({ get: async () => document(state.rows.find(row => row.id === path.split("/")[1])) }) } }));
import { readPosCustomer, searchPosCustomers } from "../functions/src/sales/pos-customer-search";
import { posWorkspaceInput } from "../functions/src/validation/sales";
const scope = { organizationId: "org", userId: "cashier", branchId: "store" };
function customer(id: string, name: string, extra = {}) { return { id, name, customerNumber: `CUS-${id}`, organizationId: "org", active: true, ...extra }; }
beforeEach(() => { state.rows = []; });
describe("POS name search through existing authorized workspace", () => {
  it("finds a case-insensitive middle-name fragment beyond500 and explicitly continues past1000", async () => {
    state.rows = Array.from({ length: 1106 }, (_, index) => customer(String(index).padStart(4, "0"), index === 750 || index === 1105 ? "Alhaji Aliyu Ventures" : "Other buyer"));
    const first = await searchPosCustomers(scope, { query: "  aLiYu  ", limit: 25 });
    expect(first.customers.map(row => row.id)).toEqual(["0750"]);
    expect(first).toMatchObject({ scanned: 1000, scanLimited: true, complete: false });
    const next = await searchPosCustomers(scope, { query: "ALIYU", limit: 25, cursor: first.nextCursor! });
    expect(next.customers.map(row => row.id)).toEqual(["1105"]);
    expect(next).toMatchObject({ nextCursor: null, complete: true });
  });
  it("keeps an empty bounded scan distinct from an empty full search", async () => {
    state.rows = Array.from({ length: 1002 }, (_, index) => customer(String(index).padStart(4, "0"), index === 1001 ? "Late target" : "Other"));
    const page = await searchPosCustomers(scope, { query: "target", limit: 25 });
    expect(page.customers).toEqual([]); expect(page.nextCursor).toBeTruthy(); expect(page.complete).toBe(false);
    const next = await searchPosCustomers(scope, { query: "target", limit: 25, cursor: page.nextCursor! });
    expect(next.customers[0]?.id).toBe("1001"); expect(next.complete).toBe(true);
  });
  it("keeps duplicate names distinct, skips inactive/foreign records and returns only the old POS fields", async () => {
    state.rows = [customer("a", "Maryam Buyer", { email: "private@example.invalid", password: "not-returned" }), customer("b", "Maryam Buyer"), customer("c", "Maryam Buyer", { active: false }), customer("d", "Maryam Buyer", { organizationId: "foreign" })];
    const result = await searchPosCustomers(scope, { query: "yam", limit: 25 });
    expect(result.customers.map(row => [row.id, row.customerNumber])).toEqual([["a", "CUS-a"], ["b", "CUS-b"]]);
    expect(Object.keys(result.customers[0]!).sort()).toEqual(["id", "customerNumber", "name", "pricingTier", "arrangements", "advanceBalances", "phone", "creditStatus", "creditLimitMinor", "outstandingBalanceMinor", "availableCreditMinor"].sort());
    expect(await readPosCustomer("org", "c")).toBeNull(); expect(await readPosCustomer("org", "d")).toBeNull();
    expect(await readPosCustomer("org", "b")).toMatchObject({ id: "b", name: "Maryam Buyer" });
  });
  it("binds continuation to the viewer, branch, organization, search and page size", async () => {
    state.rows = [customer("a", "Buyer"), customer("b", "Buyer")];
    const page = await searchPosCustomers(scope, { query: "buy", limit: 1 });
    for (const [changedScope, input] of [
      [{ ...scope, userId: "other" }, { query: "buy", limit: 1 }],
      [{ ...scope, branchId: "other" }, { query: "buy", limit: 1 }],
      [{ ...scope, organizationId: "foreign" }, { query: "buy", limit: 1 }],
      [scope, { query: "other", limit: 1 }], [scope, { query: "buy", limit: 2 }],
    ] as const) await expect(searchPosCustomers(changedScope, { ...input, cursor: page.nextCursor! })).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(searchPosCustomers(scope, { query: "buy", limit: 1, cursor: "not-a-page" })).rejects.toMatchObject({ code: "invalid-argument" });
  });
  it("preserves default workspace input and bounds read-only search requests", () => {
    expect(posWorkspaceInput.parse({ branchId: "store" })).toEqual({ branchId: "store", limit: 200 });
    expect(posWorkspaceInput.safeParse({ branchId: "store", customerSearch: { query: "", limit: 25 } }).success).toBe(false);
    expect(posWorkspaceInput.safeParse({ branchId: "store", customerSearch: { query: "x", limit: 26 } }).success).toBe(false);
    expect(posWorkspaceInput.safeParse({ branchId: "store", customerSearch: { customerId: "foreign/path" } }).success).toBe(false);
    expect(posWorkspaceInput.safeParse({ branchId: "store", customerSearch: { query: "x", customerId: "mixed" } }).success).toBe(false);
  });
});
