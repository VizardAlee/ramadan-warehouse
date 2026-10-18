import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
const { Timestamp } = createRequire(new URL("../functions/package.json", import.meta.url))("firebase-admin/firestore") as typeof import("firebase-admin/firestore");
import type { ProcurementAccess } from "../functions/src/procurement/authorize";
const memory = vi.hoisted(() => ({ rows: new Map<string, Record<string, unknown>>() }));
vi.mock("../functions/src/admin", () => {
  function record(path: string) { const data = memory.rows.get(path); return { id: path.split("/").at(-1)!, exists: Boolean(data), get: (field: string) => data?.[field], data: () => data }; }
  function query(collection: string, filters: Array<[string, unknown]> = [], cursor = "", limit = Infinity) {
    return { where: (field: string, _operator: string, value: unknown) => query(collection, [...filters, [field, value]], cursor, limit), orderBy: () => query(collection, filters, cursor, limit), startAfter: (row: { id: string }) => query(collection, filters, row.id, limit), limit: (size: number) => query(collection, filters, cursor, size), get: async () => { const docs = [...memory.rows.keys()].filter(path => path.startsWith(`${collection}/`)).sort().map(record).filter(row => row.id > cursor && filters.every(([field, value]) => row.get(field) === value)).slice(0,limit); return { docs, empty: !docs.length, size: docs.length }; } };
  }
  return { db: { collection: query, doc: (path: string) => ({ get: async () => record(path) }) } };
});
import { supplierDirectory, supplierStatement, supplierSummary } from "../functions/src/procurement/supplier-workspace";
const local: ProcurementAccess = { userId: "user", organizationId: "org", roleId: "branch_manager", branchIds: ["a"], warehouseIds: [], authorizationVersion: 1, effectivePermissions: ["procurement.read", "payables.read"], organizationProcurementPermissions: [] };
const global: ProcurementAccess = { ...local, roleId: "system_administrator", organizationProcurementPermissions: ["procurement.read", "payables.read"] };
beforeEach(() => { memory.rows.clear(); memory.rows.set("suppliers/supplier", { organizationId: "org", name: "Supplier", supplierNumber: "SUP-1", active: true }); });
describe("supplier history projections", () => {
  it("can continue an empty 500-record search page and find legacy records beyond the old directory limit", async () => {
    for (let i=0;i<620;i++) memory.rows.set(`suppliers/s-${String(i).padStart(3,"0")}`, { organizationId: "org", name: i === 619 ? "Legacy needle" : "Other", active: true });
    memory.rows.set("suppliers/s-999", { organizationId: "foreign", name: "Legacy needle", active: true });
    const first = await supplierDirectory(local, { search: "needle", limit: 25 });
    expect(first.rows).toEqual([]); expect(first.scanned).toBe(500); expect(first.nextCursor).toBeTruthy();
    const second = await supplierDirectory(local, { search: "needle", limit: 25, cursor: first.nextCursor! });
    expect(second.rows.map(row => row.id)).toEqual(["s-619"]); expect(second.nextCursor).toBeNull();
  });
  it("withholds global debt and other stores' credit sources from local readers", () => {
    const data = { outstandingBalanceMinor: 900, advanceBalanceMinor: 500, advanceBalancesByLocation: { "branch:a": 200, "branch:b": 300 }, advanceSourceBalancesByLocation: { "branch:a": { cashAdvanceMinor: 200 }, "branch:b": { returnCreditMinor: 300 } } };
    const record = { id: "supplier", data: () => data } as unknown as FirebaseFirestore.DocumentSnapshot;
    expect(supplierSummary(local, record)).toMatchObject({ advanceBalancesByLocation: { "branch:a": 200 }, advanceSourceBalancesByLocation: { "branch:a": { cashAdvanceMinor: 200 } } });
    expect(supplierSummary(local, record)).not.toHaveProperty("outstandingBalanceMinor");
    expect(JSON.stringify(supplierSummary(local, record))).not.toContain("branch:b");
    expect(supplierSummary(global, record).outstandingBalanceMinor).toBe(900);
  });
  it("uses prior scoped opening balances and stable ties at the Lagos date boundary for full export", async () => {
    const add = (id: string, at: string, branchId: string, amountMinor: number) => memory.rows.set(`supplierAccountEntries/${id}`, { organizationId: "org", supplierId: "supplier", branchId, amountMinor, advanceAmountMinor: 0, effectiveAt: Timestamp.fromDate(new Date(at)), balanceAfterMinor: 999999 });
    add("opening", "2026-10-16T22:59:59.999Z", "a", 123);
    add("foreign", "2026-10-16T23:00:00Z", "b", 555);
    for (let i=0;i<121;i++) add(`line-${String(i).padStart(3,"0")}`, "2026-10-16T23:00:00Z", "a", 101);
    add("next-day", "2026-10-17T23:00:00Z", "a", 777);
    const input = { supplierId: "supplier", branchId: "a", from: "2026-10-17", through: "2026-10-17", limit: 25 };
    const full = await supplierStatement(local, { ...input, complete: true }), page = await supplierStatement(local, input);
    expect(full.entries).toHaveLength(121); expect(full.openingPayableMinor).toBe(123); expect(full.closingPayableMinor).toBe(12344);
    expect(full.entries[0]).toMatchObject({ id: "line-000", runningPayableMinor: 224 }); expect(full.entries.at(-1)).toMatchObject({ id: "line-120", runningPayableMinor: 12344 });
    expect(full.nextCursor).toBeNull(); expect(page.entries).toHaveLength(25); expect(page.entries[0]!.id).toBe("line-120"); expect(full.statementVersion).toBe(page.statementVersion);
    expect(JSON.stringify(full)).not.toContain("balanceAfterMinor");
    add("new", "2026-10-17T02:00:00Z", "a", -17);
    expect((await supplierStatement(local, input)).statementVersion).not.toBe(full.statementVersion);
    await expect(supplierStatement(local, { ...input, branchId: "b" })).rejects.toMatchObject({ code: "permission-denied" });
  });
  it("rejects undated ledger history rather than claiming a complete statement", async () => {
    memory.rows.set("supplierAccountEntries/undated", { organizationId: "org", supplierId: "supplier", branchId: "a", amountMinor: 10 });
    await expect(supplierStatement(local, { supplierId: "supplier", branchId: "a", limit: 25, complete: true })).rejects.toThrow(/Undated/);
  });
});
