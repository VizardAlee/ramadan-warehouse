import { beforeEach, expect, it, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
const state = vi.hoisted(() => ({ rows: new Map<string, Record<string, unknown>>() }));
vi.mock("../functions/src/admin", () => {
  const reference = (path: string) => ({ path, id: path.split("/").at(-1)! });
  const snapshot = (path: string) => ({ ...reference(path), exists: state.rows.has(path), get: (field: string) => state.rows.get(path)?.[field], data: () => state.rows.get(path) });
  const scalar = (value: unknown) => value && typeof value === "object" && "toMillis" in value ? (value as { toMillis: () => number }).toMillis() : value;
  function query(name: string, filters: Array<[string, string, unknown]> = [], limit = Infinity, cursor = "") {
    return {
      where: (field: string, op: string, value: unknown) => query(name, [...filters, [field, op, value]], limit, cursor),
      orderBy: () => query(name, filters, limit, cursor), limit: (size: number) => query(name, filters, size, cursor),
      startAfter: (row: { id: string }) => query(name, filters, limit, row.id),
      get: async () => {
        const docs = [...state.rows.keys()].filter(path => path.startsWith(`${name}/`)).sort().map(snapshot).filter(row => row.id > cursor && filters.every(([field, op, value]) => {
          const a = scalar(row.get(field)), b = scalar(value);
          return op === "==" ? a === b : op === ">=" ? Number(a) >= Number(b) : op === "<" && Number(a) < Number(b);
        })).slice(0, limit);
        return { docs, empty: !docs.length, size: docs.length };
      },
    };
  }
  return { db: { collection: query, doc: reference, getAll: async (...refs: Array<{ path: string }>) => refs.map(ref => snapshot(ref.path)) } };
});
vi.mock("../functions/src/auth/authorize", async original => ({ ...await original<typeof import("../functions/src/auth/authorize")>(), requireAccess: async () => ({ userId: "reader", organizationId: "org", roleId: "system_administrator", directRoleIds: ["system_administrator"], branchIds: [], warehouseIds: [], authorizationVersion: 1 }) }));
import { generateFinancialStatement } from "../functions/src/callable/financial-reports";
function report(reportType: "cash_flow" | "receipts_payments", branchId?: string) {
  return generateFinancialStatement.run({ data: { reportType, fromDate: "2026-10-18", toDate: "2026-10-18", branchId } } as Parameters<typeof generateFinancialStatement.run>[0]);
}
beforeEach(() => {
  state.rows.clear();
  const at = Timestamp.fromDate(new Date("2026-10-18T10:00:00Z"));
  for (const [id, code] of [["source", "1031"], ["destination", "1032"]]) state.rows.set(`bankAccounts/${id}`, { organizationId: "org", ledgerAccountCode: code });
  for (const [id, branchId, code, debitMinor, creditMinor] of [["source", "a", "1031", 0, 100000], ["destination", "b", "1032", 100000, 0]] as const) {
    state.rows.set(`journalEntries/${id}`, { organizationId: "org", branchId, journalType: "internal_funds_transfer", referenceType: "companyFundsTransfer", referenceId: "source", details: { sourceBranchId: "a", destinationBranchId: "b" } });
    state.rows.set(`journalLines/${id}`, { organizationId: "org", branchId, journalEntryId: id, accountCode: code, debitMinor, creditMinor, effectiveAt: at });
  }
  state.rows.set("journalEntries/customer", { organizationId: "org", branchId: "a", journalType: "customer_payment" });
  state.rows.set("journalLines/customer", { organizationId: "org", branchId: "a", journalEntryId: "customer", accountCode: "1031", debitMinor: 20000, creditMinor: 0, effectiveAt: at });
});
it("consolidates paired transfer journals only within the actual report scope", async () => {
  await expect(report("receipts_payments")).resolves.toMatchObject({ receiptsMinor: 20000, paymentsMinor: 0, netCashMovementMinor: 20000 });
  const cash = await report("cash_flow");
  expect(cash.rows).toEqual(expect.arrayContaining([{ section: "Operating activities", amountMinor: 20000 }, { section: "Store funding transfers", amountMinor: 0 }]));
});
it("keeps source-only funding out of operating activity", async () => {
  await expect(report("receipts_payments", "a")).resolves.toMatchObject({ receiptsMinor: 20000, paymentsMinor: 100000, netCashMovementMinor: -80000 });
  expect((await report("cash_flow", "a")).rows).toEqual(expect.arrayContaining([{ section: "Operating activities", amountMinor: 20000 }, { section: "Store funding transfers", amountMinor: -100000 }]));
});
it("keeps destination-only funding out of operating activity", async () => {
  await expect(report("receipts_payments", "b")).resolves.toMatchObject({ receiptsMinor: 100000, paymentsMinor: 0, netCashMovementMinor: 100000 });
  expect((await report("cash_flow", "b")).rows).toEqual(expect.arrayContaining([{ section: "Operating activities", amountMinor: 0 }, { section: "Store funding transfers", amountMinor: 100000 }]));
});
it("keeps repeated reads stable and rejects mismatched journal ownership", async () => {
  const before = structuredClone([...state.rows.keys()]);
  expect(await report("receipts_payments")).toEqual(await report("receipts_payments"));
  expect([...state.rows.keys()]).toEqual(before);
  state.rows.set("journalEntries/source", { ...state.rows.get("journalEntries/source"), organizationId: "foreign" });
  await expect(report("cash_flow")).rejects.toMatchObject({ code: "failed-precondition" });
});
