import { beforeEach, expect, it, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import type { ProcurementAccess } from "../functions/src/procurement/authorize";
const state = vi.hoisted(() => ({ rows: new Map<string, Record<string, unknown>>(), queries: [] as string[] }));
vi.mock("../functions/src/admin", () => {
  const snapshot = (path: string) => ({ id: path.split("/").at(-1)!, exists: state.rows.has(path), get: (field: string) => state.rows.get(path)?.[field], data: () => state.rows.get(path) });
  const reference = (path: string) => ({ path, get: async () => snapshot(path) });
  function query(name: string, filters: Array<[string, unknown]> = [], limit = Infinity) {
    return { where: (field: string, _op: string, value: unknown) => query(name, [...filters, [field, value]], limit), orderBy: () => query(name, filters, limit), limit: (value: number) => query(name, filters, value), get: async () => {
      state.queries.push(name);
      const docs = [...state.rows.keys()].filter(path => path.startsWith(`${name}/`)).sort().map(snapshot).filter(row => filters.every(([field, value]) => row.get(field) === value)).slice(0, limit);
      return { docs, size: docs.length, empty: !docs.length };
    } };
  }
  return { db: { doc: reference, collection: query, getAll: async (...refs: Array<{ path: string }>) => refs.map(ref => snapshot(ref.path)) } };
});
vi.mock("../functions/src/auth/authorize", async original => ({ ...await original<typeof import("../functions/src/auth/authorize")>(), requireAccess: async () => ({ userId: "reader", organizationId: "org", roleId: "system_administrator", directRoleIds: ["system_administrator"], branchIds: [], warehouseIds: [], authorizationVersion: 1 }) }));
import { db } from "../functions/src/admin";
import { supplierReceiptEvidence } from "../functions/src/procurement/supplier-receipt-evidence";
import { accountReceipt } from "../functions/src/accounting/account-receipt";
import { getProcurementWorkspace } from "../functions/src/callable/procurement";
const local: ProcurementAccess = { userId: "reader", organizationId: "org", roleId: "branch_manager", branchIds: ["a"], warehouseIds: [], authorizationVersion: 1, effectivePermissions: ["procurement.read", "payables.read"], organizationProcurementPermissions: [] };
const global: ProcurementAccess = { ...local, roleId: "system_administrator", organizationProcurementPermissions: ["procurement.read", "payables.read"] };
const payment = () => db.doc("supplierPayments/legacy").get();
beforeEach(() => {
  state.rows.clear(); state.queries = [];
  state.rows.set("organizations/org", { tradingName: "Company" });
  state.rows.set("supplierPayments/legacy", { organizationId: "org", supplierId: "supplier", branchId: "a", status: "recorded", purpose: "payment", amountMinor: 10000, method: "bank_transfer", bankName: "Original Bank", bankAccountName: "Original Account", accountNumberLast4: "4321", journalEntryId: "journal", paidAt: Timestamp.fromMillis(1000) });
  state.rows.set("supplierPaymentAllocations/allocation", { organizationId: "org", supplierId: "supplier", supplierPaymentId: "legacy", supplierInvoiceId: "invoice", amountMinor: 10000 });
  state.rows.set("supplierAccountEntries/entry", { organizationId: "org", supplierId: "supplier", branchId: "a", referenceType: "supplierPayment", referenceId: "legacy", entryType: "supplier_payment", journalEntryId: "journal", allocations: [{ supplierInvoiceId: "invoice", amountMinor: 10000 }], balanceAfterMinor: 3210, advanceBalanceAfterMinor: 500 });
  state.rows.set("supplierInvoices/invoice", { organizationId: "org", supplierId: "supplier", branchId: "a", supplierInvoiceNumber: "INV-ORIGINAL", outstandingAmountMinor: 987654 });
});
it("retrieves historical allocations through the actual authorized receipt endpoint without writes", async () => {
  const before = JSON.stringify([...state.rows]);
  const result = await getProcurementWorkspace.run({ data: { view: "supplier_payment_receipt", supplierId: "supplier", paymentId: "legacy", branchId: "a" } } as Parameters<typeof getProcurementWorkspace.run>[0]);
  expect(result).toMatchObject({ allocations: [{ invoiceNumber: "INV-ORIGINAL", amountMinor: 10000, outstandingAfterMinor: null }], outstandingAfterMinor: 3210, advanceAfterMinor: 500, tenders: [{ bankName: "Original Bank", accountName: "Original Account" }] });
  expect(state.queries).toEqual(["supplierPaymentAllocations", "supplierAccountEntries"]);
  expect(JSON.stringify(result)).not.toContain("987654");
  expect(JSON.stringify([...state.rows])).toBe(before);
});
it("keeps historical invoice balances unknown and redacts global control snapshots for a local reader", async () => {
  const row = await payment(), evidence = await supplierReceiptEvidence(local, row);
  expect(accountReceipt(row, "supplier", "Company", false, evidence)).toMatchObject({ allocations: [{ amountMinor: 10000, outstandingAfterMinor: null }], outstandingAfterMinor: null, advanceAfterMinor: null });
});
it("uses the saved ledger allocation when the older separate allocation record is absent", async () => {
  state.rows.delete("supplierPaymentAllocations/allocation");
  expect((await supplierReceiptEvidence(local, await payment()))?.invoiceAllocations).toMatchObject([{ supplierInvoiceId: "invoice", amountMinor: 10000, outstandingAfterMinor: null }]);
});
it("leaves absent historical evidence unknown and never uses current invoice debt", async () => {
  state.rows.delete("supplierAccountEntries/entry");
  const row = await payment(), evidence = await supplierReceiptEvidence(global, row);
  expect(accountReceipt(row, "supplier", "Company", true, evidence)).toMatchObject({ allocations: [{ outstandingAfterMinor: null }], outstandingAfterMinor: null, advanceAfterMinor: null });
  state.rows.delete("supplierPaymentAllocations/allocation");
  expect((await supplierReceiptEvidence(global, row))?.invoiceAllocations).toEqual([]);
});
it("preserves explicit unknown snapshots and avoids legacy scans for inline evidence", async () => {
  state.rows.set("supplierPayments/legacy", { ...state.rows.get("supplierPayments/legacy"), outstandingAfterMinor: null, advanceBalanceAfterMinor: null });
  const row = await payment();
  expect(accountReceipt(row, "supplier", "Company", true, await supplierReceiptEvidence(global, row))).toMatchObject({ outstandingAfterMinor: null, advanceAfterMinor: null });
  state.rows.set("supplierPayments/legacy", { ...state.rows.get("supplierPayments/legacy"), invoiceAllocations: [] }); state.queries = [];
  expect(await supplierReceiptEvidence(global, await payment())).toBeUndefined(); expect(state.queries).toEqual([]);
});
it("validates linked invoice tenant, supplier and actual authorized store", async () => {
  const original = state.rows.get("supplierInvoices/invoice")!;
  for (const changed of [{ organizationId: "foreign" }, { supplierId: "other" }]) {
    state.rows.set("supplierInvoices/invoice", { ...original, ...changed });
    await expect(supplierReceiptEvidence(global, await payment())).rejects.toMatchObject({ code: "failed-precondition" });
  }
  state.rows.set("supplierInvoices/invoice", { ...original, branchId: "b" });
  await expect(supplierReceiptEvidence(local, await payment())).rejects.toMatchObject({ code: "permission-denied" });
  expect((await supplierReceiptEvidence(global, await payment()))?.invoiceAllocations).toHaveLength(1);
});
it("rejects mismatched account-entry store, journal, type and conflicting allocation evidence", async () => {
  const original = state.rows.get("supplierAccountEntries/entry")!;
  for (const changed of [{ branchId: "b" }, { journalEntryId: "other" }, { entryType: "unrelated" }, { allocations: [{ supplierInvoiceId: "invoice", amountMinor: 9999 }] }]) {
    state.rows.set("supplierAccountEntries/entry", { ...original, ...changed });
    await expect(supplierReceiptEvidence(global, await payment())).rejects.toMatchObject({ code: "failed-precondition" });
  }
});
it("rejects ambiguous or oversized history rather than returning a truncated receipt", async () => {
  state.rows.set("supplierAccountEntries/duplicate", { ...state.rows.get("supplierAccountEntries/entry") });
  await expect(supplierReceiptEvidence(global, await payment())).rejects.toMatchObject({ code: "failed-precondition" });
  state.rows.delete("supplierAccountEntries/duplicate");
  for (let i = 0; i < 201; i++) state.rows.set(`supplierPaymentAllocations/extra-${i}`, { ...state.rows.get("supplierPaymentAllocations/allocation") });
  await expect(supplierReceiptEvidence(global, await payment())).rejects.toMatchObject({ code: "failed-precondition" });
});
