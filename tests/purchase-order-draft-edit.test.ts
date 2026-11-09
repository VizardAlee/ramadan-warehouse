import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { ProcurementAccess } from "../functions/src/procurement/authorize";
const memory = vi.hoisted(() => ({ rows: new Map<string, Record<string, unknown>>(), writes: 0, ids: 0 }));
vi.mock("../functions/src/admin", () => {
  const ref = (path: string) => ({ path, id: path.split("/").at(-1)! });
  const snapshot = (path: string) => { const data = memory.rows.get(path); return { ...ref(path), ref: ref(path), exists: Boolean(data), get: (key: string) => data?.[key], data: () => data }; };
  const query = (collection: string, filters: Array<[string, unknown]> = [], size = Infinity): object => ({
    doc: () => ref(`${collection}/generated-${++memory.ids}`),
    where: (key: string, _operator: string, value: unknown) => query(collection, [...filters, [key, value]], size),
    limit: (limit: number) => query(collection, filters, limit),
    read: () => { const docs = [...memory.rows.keys()].filter(path => path.startsWith(`${collection}/`)).map(snapshot).filter(row => filters.every(([key, value]) => row.get(key) === value)).slice(0, size); return { docs, empty: !docs.length, size: docs.length }; },
  });
  return { db: { doc: ref, collection: query, runTransaction: async (callback: (transaction: object) => Promise<unknown>) => {
    const changes: Array<() => void> = [];
    const result = await callback({
      getAll: async (...refs: Array<{path: string}>) => refs.map(reference => snapshot(reference.path)),
      get: async (reference: {path?: string; read?: () => unknown}) => reference.path ? snapshot(reference.path) : reference.read!(),
      update: (reference: {path: string}, data: Record<string,unknown>) => changes.push(() => memory.rows.set(reference.path, { ...memory.rows.get(reference.path), ...data })),
      create: (reference: {path: string}, data: Record<string,unknown>) => changes.push(() => memory.rows.set(reference.path, data)),
      delete: (reference: {path: string}) => changes.push(() => memory.rows.delete(reference.path)),
    });
    changes.forEach(change => change()); memory.writes += changes.length; return result;
  } } };
});
import { editDraftPurchaseOrder } from "../functions/src/procurement/edit-draft-purchase-order";
import { createPurchaseOrderInput, editDraftPurchaseOrderInput } from "../functions/src/validation/procurement";
const actor: ProcurementAccess = { userId: "user", organizationId: "org", roleId: "warehouse_manager", branchIds: ["branch"], warehouseIds: [], authorizationVersion: 1, effectivePermissions: ["procurement.create"], organizationProcurementPermissions: [] };
const data = (extras: Record<string, unknown> = {}) => ({ action: "edit_draft", purchaseOrderId: "po", expectedRevision: 0, supplierId: "new-supplier", branchId: "branch", receivingLocationId: "stock-2", lines: [{ productId: "product", quantity: 3, unitCostMinor: 12345, vatRateBasisPoints: 750 }], notes: "New note", expectedAt: "2026-11-20T12:00:00.000Z", idempotencyKey: randomUUID(), ...extras });
const input = (extras: Record<string, unknown> = {}) => editDraftPurchaseOrderInput.parse(data(extras));
const patch = (path: string, values: Record<string, unknown>) => memory.rows.set(path, { ...memory.rows.get(path), ...values });
beforeEach(() => {
  memory.rows.clear(); memory.writes = 0; memory.ids = 0;
  memory.rows.set("purchaseOrders/po", { organizationId: "org", branchId: "branch", purchaseOrderNumber: "PO-ORIGINAL", supplierId: "old-supplier", supplierName: "Old supplier", receivingLocationId: "stock-1", createdBy: "creator", status: "draft", receivedNetAmountMinor: 0, invoicedNetAmountMinor: 0, netAmountMinor: 10000, vatAmountMinor: 0, grossAmountMinor: 10000 });
  memory.rows.set("purchaseOrderItems/original-item", { organizationId: "org", branchId: "branch", purchaseOrderId: "po", productId: "product", orderedQuantity: 1, receivedQuantity: 0, unitCostMinor: 10000 });
  memory.rows.set("suppliers/new-supplier", { organizationId: "org", name: "New supplier", active: true });
  memory.rows.set("branches/branch", { organizationId: "org", name: "Branch", status: "active" });
  memory.rows.set("inventoryLocations/stock-2", { organizationId: "org", branchId: "branch", name: "Stock 2", status: "active" });
  memory.rows.set("products/product", { organizationId: "org", active: true, name: "Product", sku: "SKU", trackingType: "quantity", unitOfMeasure: "unit" });
});
describe("draft purchase-order editing", () => {
  it("updates legacy revision-zero drafts atomically while preserving number, creator, and retained line IDs", async () => {
    const result = await editDraftPurchaseOrder(actor, input());
    expect(result).toMatchObject({ purchaseOrderId: "po", purchaseOrderNumber: "PO-ORIGINAL", revision: 1, updated: true });
    expect(memory.rows.get("purchaseOrders/po")).toMatchObject({ status: "draft", supplierId: "new-supplier", receivingLocationId: "stock-2", createdBy: "creator", revision: 1, netAmountMinor: 37035, vatAmountMinor: 2778, grossAmountMinor: 39813, notes: "New note" });
    expect(memory.rows.get("purchaseOrderItems/original-item")).toMatchObject({ orderedQuantity: 3, unitCostMinor: 12345, supplierId: "new-supplier" });
    const audit = [...memory.rows].find(([path]) => path.startsWith("auditLogs/"))![1];
    expect(audit).toMatchObject({ action: "purchase_order.draft_edited", before: { supplierId: "old-supplier" }, after: { supplierId: "new-supplier", revision: 1 } });
    expect(JSON.stringify(audit.after)).not.toContain("serverTimestamp");
  });
  it("adds/removes only untouched lines and can clear optional details", async () => {
    memory.rows.set("products/replacement", { organizationId: "org", active: true, name: "Replacement" });
    await editDraftPurchaseOrder(actor, input({ lines: [{ productId: "replacement", quantity: 1, unitCostMinor: 999, vatRateBasisPoints: 0 }], notes: undefined, expectedAt: undefined }));
    expect(memory.rows.has("purchaseOrderItems/original-item")).toBe(false);
    expect([...memory.rows].filter(([path]) => path.startsWith("purchaseOrderItems/"))).toHaveLength(1);
    expect(memory.rows.get("purchaseOrders/po")).toMatchObject({ notes: null, expectedAt: null });
  });
  it("replays exact retries without writes and rejects changed-payload/actor/key reuse", async () => {
    const command = input(); await editDraftPurchaseOrder(actor, command); const writes = memory.writes;
    expect(await editDraftPurchaseOrder(actor, command)).toMatchObject({ updated: false, revision: 1 });
    expect(memory.writes).toBe(writes);
    await expect(editDraftPurchaseOrder(actor, { ...command, notes: "Different" })).rejects.toMatchObject({ code: "already-exists" });
    await expect(editDraftPurchaseOrder({ ...actor, userId: "another" }, command)).rejects.toMatchObject({ code: "already-exists" });
    expect(memory.writes).toBe(writes);
  });
  it("rejects a second editor's stale revision without any partial changes", async () => {
    const stale = input(); await editDraftPurchaseOrder(actor, input()); const writes = memory.writes;
    await expect(editDraftPurchaseOrder(actor, stale)).rejects.toMatchObject({ code: "aborted" });
    expect(memory.writes).toBe(writes);
  });
  it.each(["submitted", "approved", "partially_received", "received", "cancelled"])("locks %s orders", async status => {
    patch("purchaseOrders/po", { status }); await expect(editDraftPurchaseOrder(actor, input())).rejects.toMatchObject({ code: "failed-precondition" }); expect(memory.writes).toBe(0);
  });
  it.each(["purchaseReceipts", "supplierInvoices", "supplierInvoiceItems", "purchaseInvoiceItemCounters", "supplierReturns", "inventoryTransactions"])("locks damaged draft headers with %s evidence", async collection => {
    memory.rows.set(`${collection}/existing`, { purchaseOrderId: "po", referenceId: "po" });
    await expect(editDraftPurchaseOrder(actor, input())).rejects.toMatchObject({ code: "failed-precondition" }); expect(memory.writes).toBe(0);
  });
  it.each([{ receivedQuantity: 1 }, { invoicedQuantity: 1 }, { receiptInProgressKey: "pending" }, { organizationId: "foreign" }, { branchId: "other" }])("locks inconsistent line evidence %o", async values => {
    patch("purchaseOrderItems/original-item", values); await expect(editDraftPurchaseOrder(actor, input())).rejects.toMatchObject({ code: "failed-precondition" }); expect(memory.writes).toBe(0);
  });
  it.each([{ submittedBy: "user" }, { approvedAt: "earlier" }, { receivedNetAmountMinor: 100 }, { invoicedNetAmountMinor: 100 }])("locks prior workflow evidence %o", async values => {
    patch("purchaseOrders/po", values); await expect(editDraftPurchaseOrder(actor, input())).rejects.toMatchObject({ code: "failed-precondition" }); expect(memory.writes).toBe(0);
  });
  it("enforces original scope, actor permission, current context, and tenant boundaries", async () => {
    await expect(editDraftPurchaseOrder({ ...actor, effectivePermissions: [] }, input())).rejects.toMatchObject({ code: "permission-denied" });
    await expect(editDraftPurchaseOrder({ ...actor, branchIds: ["elsewhere"] }, input())).rejects.toMatchObject({ code: "permission-denied" });
    await expect(editDraftPurchaseOrder({ ...actor, operatingContext: { type: "branch", id: "elsewhere" } }, input())).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(editDraftPurchaseOrder({ ...actor, organizationProcurementPermissions: ["procurement.create"] }, input({ branchId: "other" }))).rejects.toMatchObject({ code: "permission-denied" });
    patch("purchaseOrders/po", { organizationId: "foreign" }); await expect(editDraftPurchaseOrder(actor, input())).rejects.toMatchObject({ code: "not-found" }); expect(memory.writes).toBe(0);
  });
  it.each([["suppliers/new-supplier", { active: false }], ["products/product", { itemKind: "service" }], ["products/product", { active: false }], ["inventoryLocations/stock-2", { branchId: "other" }], ["branches/branch", { status: "inactive" }]])("validates catalogue/location %s before writing", async (path, values) => {
    patch(path as string, values as Record<string,unknown>); await expect(editDraftPurchaseOrder(actor, input())).rejects.toMatchObject({ code: "failed-precondition" }); expect(memory.writes).toBe(0);
  });
  it("validates revisions, paths, duplicate products and safe monetary totals", () => {
    for (const extras of [{ expectedRevision: -1 }, { expectedRevision: 1.5 }, { purchaseOrderId: "bad/path" }, { lines: [] }, { lines: [{ productId: "product", quantity: 2, unitCostMinor: Number.MAX_SAFE_INTEGER, vatRateBasisPoints: 0 }] }, { lines: [data().lines[0], data().lines[0]] }])
      expect(editDraftPurchaseOrderInput.safeParse(data(extras)).success).toBe(false);
    expect(createPurchaseOrderInput.safeParse(data({ action: "edit_typo" })).success).toBe(false);
    expect(createPurchaseOrderInput.safeParse(data({ action: undefined })).success).toBe(true);
  });
});
