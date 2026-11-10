import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
const { Timestamp } = createRequire(new URL("../functions/package.json", import.meta.url))("firebase-admin/firestore") as typeof import("firebase-admin/firestore");
import type { ProcurementAccess } from "../functions/src/procurement/authorize";
const memory = vi.hoisted(() => ({ rows: new Map<string, Record<string, unknown>>(), reads: 0 }));
vi.mock("../functions/src/audit/record-actors", () => ({ withRecordActors: async (_org: string, rows: unknown[]) => rows }));
vi.mock("../functions/src/admin", () => {
  function record(path: string) { const data = memory.rows.get(path); return { id: path.split("/").at(-1)!, exists: Boolean(data), get: (field: string) => data?.[field], data: () => data }; }
  function query(collection: string, filters: Array<[string,string,unknown]> = [], cursor = "", limit = Infinity) {
    return { where: (field: string, operator: string, value: unknown) => query(collection, [...filters, [field,operator,value]], cursor, limit), orderBy: () => query(collection, filters, cursor, limit), startAfter: (row: { id: string }) => query(collection, filters, row.id, limit), limit: (size: number) => query(collection, filters, cursor, size), get: async () => { const docs = [...memory.rows.keys()].filter(path => path.startsWith(`${collection}/`)).sort().map(record).filter(row => row.id > cursor && filters.every(([field,op,value]) => op === "==" ? row.get(field) === value : op === ">=" ? Number((row.get(field) as {toMillis?():number})?.toMillis?.()) >= Number((value as {toMillis(): number}).toMillis()) : Number((row.get(field) as {toMillis?():number})?.toMillis?.()) < Number((value as {toMillis(): number}).toMillis()))).slice(0,limit); memory.reads += docs.length; return { docs, empty: !docs.length, size: docs.length }; } };
  }
  return { db: { collection: query, doc: (path: string) => ({ get: async () => record(path) }) } };
});
import { purchasingPage, purchasingOrderDetail, purchasingNeedsAction, purchasingPageInput, purchasingInvoiceDetail } from "../functions/src/procurement/purchasing-pages";
const actor: ProcurementAccess = { userId: "user", organizationId: "org", roleId: "warehouse_manager", branchIds: ["a"], warehouseIds: [], authorizationVersion: 1, effectivePermissions: ["procurement.read", "payables.read"], organizationProcurementPermissions: [] };
const input = (extras: Record<string,unknown> = {}) => purchasingPageInput.parse({ branchId: "a", view: "all", pageSize: 25, ...extras });
function add(id: string, data: Record<string, unknown> = {}, collection = "purchaseOrders") { memory.rows.set(`${collection}/${id}`, { organizationId: "org", branchId: "a", status: "draft", createdAt: Timestamp.fromDate(new Date("2026-11-06T23:30:00Z")), ...data }); }
beforeEach(() => { memory.rows.clear(); memory.reads = 0; });
describe("purchasing server pages", () => {
  it("reaches every one of 127 orders without duplicates or leaking unrelated stores", async () => {
    for (let i=0;i<127;i++) add(`order-${String(i).padStart(3,"0")}`);
    for (let i=0;i<700;i++) add(`foreign-${i}`, { branchId: "b" });
    add("other-org", { organizationId: "other" });
    const ids: string[] = []; let cursor: string | undefined;
    do { const page = await purchasingPage(actor, input({cursor}), "orders"); ids.push(...page.orders!.map(row => String(row.id))); cursor = page.nextCursor ?? undefined; } while (cursor);
    expect(ids).toHaveLength(127); expect(new Set(ids).size).toBe(127); expect(ids).not.toContain("other-org"); expect(memory.reads).toBeLessThan(700);
  });
  it("can continue beyond a 500-row empty search page", async () => {
    for (let i=0;i<620;i++) add(`order-${String(i).padStart(3,"0")}`, { supplierName: i === 619 ? "Needle" : "Other" });
    const first = await purchasingPage(actor, input({search: "needle"}), "orders");
    expect(first.orders).toEqual([]); expect(first.hasMore).toBe(true); expect(first.scanned).toBe(500);
    const second = await purchasingPage(actor, input({search: "needle", cursor:first.nextCursor}), "orders");
    expect(second.orders!.map(row => row.id)).toEqual(["order-619"]); expect(second.hasMore).toBe(false);
  });
  it("rejects cursor tampering, changed filters, changed actor, and unauthorized branch", async () => {
    add("a"); add("b"); const first = await purchasingPage(actor,input({pageSize:1}),"orders");
    await expect(purchasingPage(actor,input({pageSize:1,cursor:first.nextCursor,search:"changed"}),"orders")).rejects.toMatchObject({code:"invalid-argument"});
    const cursor = JSON.parse(Buffer.from(first.nextCursor!,"base64url").toString()); cursor.id="b";
    await expect(purchasingPage(actor,input({pageSize:1,cursor:Buffer.from(JSON.stringify(cursor)).toString("base64url")}),"orders")).rejects.toMatchObject({code:"invalid-argument"});
    await expect(purchasingPage({...actor,userId:"different"},input({pageSize:1,cursor:first.nextCursor}),"orders")).rejects.toMatchObject({code:"invalid-argument"});
    await expect(purchasingPage(actor,input({branchId:"b"}),"orders")).rejects.toMatchObject({code:"permission-denied"});
  });
  it("filters supplier, status, reference and Lagos creation date", async () => {
    add("match", {supplierId:"s",purchaseOrderNumber:"PO-999",status:"submitted"}); add("old",{supplierId:"s",purchaseOrderNumber:"PO-999",status:"submitted",createdAt:Timestamp.fromDate(new Date("2026-11-06T22:59:59Z"))}); add("wrong",{supplierId:"other",purchaseOrderNumber:"PO-999",status:"submitted"});
    const result = await purchasingPage(actor,input({supplierId:"s",status:"submitted",search:"po-999",startDate:"2026-11-07",endDate:"2026-11-07"}),"orders"); expect(result.orders!.map(row=>row.id)).toEqual(["match"]);
  });
  it("keeps partial receipts and uninvoiced receipts actionable and paid invoices in history", async () => {
    expect(purchasingNeedsAction("orders",{status:"partially_received",receivedNetAmountMinor:50,invoicedNetAmountMinor:50})).toBe(true);
    expect(purchasingNeedsAction("orders",{status:"received",receivedNetAmountMinor:100,invoicedNetAmountMinor:50})).toBe(true);
    expect(purchasingNeedsAction("orders",{status:"received",receivedNetAmountMinor:100,invoicedNetAmountMinor:100})).toBe(false);
    expect(purchasingNeedsAction("orders",{status:"received"})).toBe(true);
    for (const status of ["submitted","approved","partially_paid","paid"]) add(status,{status},"supplierInvoices");
    const action = await purchasingPage(actor,input({view:"needs_action"}),"invoices"), history = await purchasingPage(actor,input({view:"history"}),"invoices");
    expect(action.invoices).toHaveLength(3); expect(history.invoices!.map(row=>row.id)).toEqual(["paid"]);
    await expect(purchasingPage({...actor,effectivePermissions:["procurement.read"]},input(),"invoices")).rejects.toMatchObject({code:"permission-denied"});
  });
  it("uses line quantities for received historical orders with missing header counters", async () => {
    add("legacy", {status:"received"});
    add("legacy-line",{purchaseOrderId:"legacy",orderedQuantity:5,receivedQuantity:5,invoicedQuantity:5},"purchaseOrderItems");
    let page = await purchasingPage(actor,input({view:"history"}),"orders");
    expect(page.orders).toEqual([expect.objectContaining({id:"legacy",needsAction:false,nextAction:"Review invoices"})]);
    add("legacy-line",{purchaseOrderId:"legacy",orderedQuantity:5,receivedQuantity:5,invoicedQuantity:4},"purchaseOrderItems");
    page = await purchasingPage(actor,input({view:"needs_action"}),"orders");
    expect(page.orders).toEqual([expect.objectContaining({id:"legacy",needsAction:true,nextAction:"Match invoice"})]);
  });
  it("loads 620 selected-order lines rather than a shared 500-item pool and enforces detail scope", async () => {
    add("order"); add("other",{branchId:"b"});
    for(let i=0;i<620;i++) add(`line-${String(i).padStart(3,"0")}`,{purchaseOrderId:"order"},"purchaseOrderItems");
    for(let i=0;i<700;i++) add(`unrelated-${i}`,{purchaseOrderId:"unrelated"},"purchaseOrderItems");
    const detail = await purchasingOrderDetail(actor,{purchaseOrderId:"order",branchId:"a"}); expect(detail.items).toHaveLength(620);
    await expect(purchasingOrderDetail(actor,{purchaseOrderId:"other"})).rejects.toMatchObject({code:"permission-denied"});
    await expect(purchasingOrderDetail({...actor,operatingContext:{type:"branch",id:"b"}}, {purchaseOrderId:"order"})).rejects.toMatchObject({code:"failed-precondition"});
  });
});

it("serves a newly added selected branch for purchasing-only managers without legacy warehouse authority", async () => {
  add("new-order", { branchId: "new-branch" });
  const manager: ProcurementAccess = { ...actor, roleId: "purchasing_manager", directRoleIds: ["purchasing_manager"], branchIds: [], warehouseIds: [], allBranchProcurementPermissions: ["procurement.read", "payables.read"], assignedProcurementPermissions: [] };
  const result = await purchasingPage(manager, input({ branchId: "new-branch" }), "orders");
  expect(result.orders?.map(row => row.id)).toEqual(["new-order"]);
  await expect(purchasingPage(manager, input({ branchId: undefined }), "orders")).rejects.toMatchObject({ code: "failed-precondition" });
  await expect(purchasingPage(manager, input({ branchId: undefined, warehouseId: "legacy" }), "orders")).rejects.toMatchObject({ code: "permission-denied" });
  await expect(purchasingPage({ ...manager, roleId: "branch_manager", directRoleIds: ["branch_manager"] }, input({ branchId: "new-branch" }), "orders")).rejects.toMatchObject({ code: "permission-denied" });
});

it("shows existing pending matches and routes the order to invoice approval", async () => {
  add("pending-order", { status: "received", receivedNetAmountMinor: 100, invoicedNetAmountMinor: 0 });
  add("pending-line", { purchaseOrderId: "pending-order", orderedQuantity: 2, receivedQuantity: 2, invoicedQuantity: 0 }, "purchaseOrderItems");
  add("pending-invoice", { purchaseOrderId: "pending-order", status: "submitted" }, "supplierInvoices");
  add("invoice-line", { purchaseOrderId: "pending-order", supplierInvoiceId: "pending-invoice", purchaseOrderItemId: "pending-line", quantity: 2 }, "supplierInvoiceItems");
  const page = await purchasingPage(actor, input(), "orders");
  expect(page.orders?.[0]).toMatchObject({ nextAction: "Review invoice approval" });
  const detail = await purchasingOrderDetail(actor, { purchaseOrderId: "pending-order", branchId: "a" });
  expect(detail.pendingInvoiceCount).toBe(1);
  expect(detail.items[0]).toMatchObject({ pendingInvoiceQuantity: 2, matchableQuantity: 0 });
});
it("loads only the saved invoice inside the caller's authorized scope", async () => {
  add("saved", { purchaseOrderId: "order", status: "submitted" }, "supplierInvoices");
  add("foreign", { organizationId: "other", status: "submitted" }, "supplierInvoices");
  const invoice = await purchasingInvoiceDetail(actor, { supplierInvoiceId: "saved", branchId: "a" });
  expect(invoice.invoice).toMatchObject({ id: "saved" });
  await expect(purchasingInvoiceDetail(actor, { supplierInvoiceId: "foreign" })).rejects.toMatchObject({ code: "not-found" });
  await expect(purchasingInvoiceDetail(actor, { supplierInvoiceId: "saved", branchId: "b" })).rejects.toMatchObject({ code: "permission-denied" });
  await expect(purchasingInvoiceDetail({ ...actor, effectivePermissions: ["procurement.read"] }, { supplierInvoiceId: "saved" })).rejects.toMatchObject({ code: "permission-denied" });
});

it("keeps cancelled and rejected invoices searchable only as inactive history", async () => {
  for (const status of ["submitted", "approved", "cancelled", "rejected", "void"]) add(status, { status, outstandingAmountMinor: 10000 }, "supplierInvoices");
  const actionable = await purchasingPage(actor, input({ view: "needs_action" }), "invoices");
  expect(actionable.invoices?.map(invoice => invoice.id)).toEqual(["approved", "submitted"]);
  const history = await purchasingPage(actor, input({ view: "history" }), "invoices");
  expect(history.invoices?.map(invoice => invoice.id)).toEqual(["cancelled", "rejected", "void"]);
  expect(memory.rows.get("supplierInvoices/cancelled")?.outstandingAmountMinor).toBe(10000);
});
