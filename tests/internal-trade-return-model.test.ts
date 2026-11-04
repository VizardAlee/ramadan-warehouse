import { internalTradeBalanceId } from "../functions/src/branch-trading/identity";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessProfile } from "../functions/src/auth/authorize";
import { balanceDocumentId, uniquenessDocumentId } from "../functions/src/inventory/calculations";
import { TransferFirestoreFixture } from "./helpers/transfer-firestore-fixture";
const state = vi.hoisted(() => ({ db: null as unknown as TransferFirestoreFixture }));
vi.mock("../functions/src/admin.js", () => ({ db: {
  doc: (path: string) => state.db.doc(path), collection: (path: string) => state.db.collection(path),
  getAll: (...refs: Parameters<TransferFirestoreFixture["getAll"]>) => state.db.getAll(...refs),
  runTransaction: (handler: Parameters<TransferFirestoreFixture["runTransaction"]>[0]) => state.db.runTransaction(handler),
} }));
import { canReturnInternalTradeGoods, internalTradeReturnInput, returnInternalTradeGoods } from "../functions/src/branch-trading/returns";
const actor: AccessProfile = { organizationId: "org", userId: "admin", roleId: "operations_administrator", roleIds: ["operations_administrator"], directRoleIds: ["operations_administrator"], effectivePermissions: ["inventory.move_internal"], branchIds: [], warehouseIds: [], authorizationVersion: 1 };
const balance = (location: string) => `inventoryBalances/${balanceDocumentId("org", "product", location)}`;
const input = (quantity = 1) => ({ action: "return_goods" as const, confirmedReceived:true as const,confirmedResellable:true as const, invoiceId: "invoice", lines: [{ id: "line", quantity, serialItemIds: [] as string[] }], note: "Goods inspected back at HQ", idempotencyKey: crypto.randomUUID() });
beforeEach(() => {
  state.db = new TransferFirestoreFixture();
  state.db.seed("products/product", { organizationId: "org", active: true, name: "Panel", sku: "PV", trackingType: "quantity" });
  state.db.seed("inventoryLocations/branch-stock", { organizationId: "org", status: "active", type: "branch", branchId: "branch" });
  state.db.seed("inventoryLocations/hq-stock", { organizationId: "org", status: "active", type: "warehouse", warehouseId: "hq-warehouse" });
  state.db.seed(balance("branch-stock"), { organizationId: "org", productId: "product", onHandQuantity: 10, reservedQuantity: 0, availableQuantity: 10, averageUnitCostMinor: 10, totalValueMinor: 101, version: 0 });
  state.db.seed("internalTradeInvoices/invoice", { organizationId: "org", branchId: "branch", headOfficeBranchId: "hq", sourceLocationId: "hq-stock", destinationLocationId: "branch-stock", totalMinor: 2000, paidMinor: 0, returnedMinor: 0, balanceMinor: 2000, version: 0,
    lines: [{ id: "line", productId: "product", productName: "Panel", sku: "PV", trackingType: "quantity", unitPriceMinor: 200, receivedQuantity: 10, returnedQuantity: 0, serialItemIds: [], returnedSerialItemIds: [] }] });
  state.db.seed(`internalTradeBalances/${internalTradeBalanceId("org","hq","branch")}`, { organizationId: "org", branchId: "branch", headOfficeBranchId: "hq", invoicedMinor: 2000, paidMinor: 0, returnedMinor: 0, balanceMinor: 2000, version: 0 });
});
describe("controlled internal-trade returns", () => {
  it("requires a direct administrator with existing inventory movement permission", async () => {
    expect(canReturnInternalTradeGoods(actor)).toBe(true);
    const custom = { ...actor, directRoleIds: [] };
    expect(canReturnInternalTradeGoods(custom)).toBe(false);
    await expect(returnInternalTradeGoods(custom, input())).rejects.toMatchObject({ code: "permission-denied" });
    expect(canReturnInternalTradeGoods({ ...actor, effectivePermissions: [] })).toBe(false);
  });
  it("bounds payloads and rejects client-supplied price or cost", () => {
    expect(internalTradeReturnInput.safeParse({ ...input(), unitPriceMinor: 1 }).success).toBe(false);
    expect(internalTradeReturnInput.safeParse({ ...input(), lines: [] }).success).toBe(false);
    expect(internalTradeReturnInput.safeParse(input(0)).success).toBe(false);
  });
  it("atomically returns stock, reduces invoice and branch debt, and exactly retries", async () => {
    const request = input(3);
    const result = await returnInternalTradeGoods(actor, request);
    expect(result).toMatchObject({ amountMinor: 600, posted: true });
    expect(state.db.row("internalTradeInvoices/invoice")).toMatchObject({ returnedMinor: 600, balanceMinor: 1400 });
    expect(state.db.row(`internalTradeBalances/${internalTradeBalanceId("org","hq","branch")}`)).toMatchObject({ returnedMinor: 600, balanceMinor: 1400 });
    expect(state.db.row(balance("branch-stock"))).toMatchObject({ onHandQuantity: 7 });
    expect(state.db.row(balance("hq-stock"))).toMatchObject({ onHandQuantity: 3 });
    expect(state.db.all("internalTradeEntries")).toHaveLength(1);
    expect(state.db.all("journalEntries")).toHaveLength(0);
    expect(await returnInternalTradeGoods(actor, request)).toEqual({ ...result, posted: false });
    await expect(returnInternalTradeGoods(actor, { ...request, note: "Changed request" })).rejects.toMatchObject({ code: "already-exists" });
  });
  it("conserves every company-cost minor unit when returning the final quantity", async () => {
    await returnInternalTradeGoods(actor, input(3));
    await returnInternalTradeGoods(actor, input(7));
    expect(state.db.row(balance("branch-stock"))).toMatchObject({ onHandQuantity: 0, totalValueMinor: 0 });
    expect(state.db.row(balance("hq-stock"))).toMatchObject({ onHandQuantity: 10, totalValueMinor: 101 });
    expect(state.db.all("inventoryEntries").reduce((sum, entry) => sum + Number(entry.valueDeltaMinor), 0)).toBe(0);
  });
  it("creates a branch credit after the original invoice has been fully paid", async () => {
    for (const path of ["internalTradeInvoices/invoice", `internalTradeBalances/${internalTradeBalanceId("org","hq","branch")}`]) state.db.seed(path, { ...state.db.row(path), paidMinor: 2000, balanceMinor: 0 });
    await returnInternalTradeGoods(actor, input(2));
    expect(state.db.row("internalTradeInvoices/invoice")).toMatchObject({ returnedMinor: 400, balanceMinor: -400 });
    expect(state.db.row(`internalTradeBalances/${internalTradeBalanceId("org","hq","branch")}`)).toMatchObject({ balanceMinor: -400 });
  });
  it("rolls back stock on over-return, period lock and transaction-finalization failure", async () => {
    await expect(returnInternalTradeGoods(actor, input(11))).rejects.toThrow();
    state.db.seed(`accountingPeriods/${uniquenessDocumentId("org", new Date().toISOString().slice(0, 7))}`, { status: "closed" });
    await expect(returnInternalTradeGoods(actor, input())).rejects.toMatchObject({ code: "failed-precondition" });
    expect(state.db.row(balance("branch-stock"))).toMatchObject({ onHandQuantity: 10, totalValueMinor: 101 });
    state.db.rows.delete(`accountingPeriods/${uniquenessDocumentId("org", new Date().toISOString().slice(0, 7))}`);
    state.db.failNextCommitFor = "internalTradeReturns/";
    await expect(returnInternalTradeGoods(actor, input())).rejects.toThrow(/Injected/);
    expect(state.db.row(balance("branch-stock"))).toMatchObject({ onHandQuantity: 10, totalValueMinor: 101 });
    expect(state.db.all("internalTradeEntries")).toHaveLength(0);
  });
  it("does not create an invoice for a legacy transfer", async () => {
    state.db.rows.delete("internalTradeInvoices/invoice");
    await expect(returnInternalTradeGoods(actor, input())).rejects.toMatchObject({ code: "not-found" });
    expect(state.db.all("inventoryTransactions")).toHaveLength(0);
  });
  it("credits only original invoiced serials still unreserved in the receiving branch", async () => {
    const original = uniquenessDocumentId("org", "SERIAL-1"), foreign = uniquenessDocumentId("org", "SERIAL-2");
    state.db.seed("products/product", { ...state.db.row("products/product"), trackingType: "serial" });
    for (const [serialId, serialNumber] of [[original, "SERIAL-1"], [foreign, "SERIAL-2"]]) state.db.seed(`serializedItems/${serialId}`, {
      organizationId: "org", productId: "product", serialNumber, currentLocationId: "branch-stock", currentUnitCostMinor: 10, active: true, status: "at_branch",
    });
    const invoice = state.db.row("internalTradeInvoices/invoice"), line = (invoice.lines as Array<Record<string, unknown>>)[0]!;
    state.db.seed("internalTradeInvoices/invoice", { ...invoice, lines: [{ ...line, trackingType: "serial", serialItemIds: [original] }] });
    const request = { ...input(), lines: [{ id: "line", quantity: 1, serialItemIds: [foreign] }] };
    await expect(returnInternalTradeGoods(actor, request)).rejects.toThrow(/original invoiced serials/);
    request.lines[0]!.serialItemIds = [original];
    state.db.seed(`serializedItems/${original}`, { ...state.db.row(`serializedItems/${original}`), reservedSaleId: "sale" });
    await expect(returnInternalTradeGoods(actor, request)).rejects.toThrow(/unavailable/);
    const unreserved = { ...state.db.row(`serializedItems/${original}`) }; delete unreserved.reservedSaleId;
    state.db.seed(`serializedItems/${original}`, unreserved);
    await returnInternalTradeGoods(actor, request);
    expect(state.db.row(`serializedItems/${original}`)).toMatchObject({ currentLocationId: "hq-stock", currentUnitCostMinor: 10 });
    expect(state.db.row("internalTradeInvoices/invoice")).toMatchObject({ returnedMinor: 200 });
    expect(state.db.all("internalTradeReturns")).toHaveLength(1);
  });
  it("returns the original lot without changing company value or another lot", async () => {
    state.db.seed("products/product", { ...state.db.row("products/product"), trackingType: "batch" });
    const branchLot = `inventoryBalances/${balanceDocumentId("org", "product", "branch-stock", "lot-1")}`;
    state.db.seed(branchLot, { ...state.db.row(balance("branch-stock")), lotId: "lot-1" });
    state.db.rows.delete(balance("branch-stock"));
    state.db.seed("inventoryLots/lot-1", { organizationId: "org", productId: "product", lotNumber: "LOT-1", locationQuantities: { "branch-stock": 10 }, remainingQuantity: 10 });
    const invoice = state.db.row("internalTradeInvoices/invoice"), line = (invoice.lines as Array<Record<string, unknown>>)[0]!;
    state.db.seed("internalTradeInvoices/invoice", { ...invoice, lines: [{ ...line, trackingType: "batch", lotId: "lot-1" }] });
    await returnInternalTradeGoods(actor, input(3));
    expect(state.db.row("inventoryLots/lot-1")).toMatchObject({ locationQuantities: { "branch-stock": 7, "hq-stock": 3 }, remainingQuantity: 10 });
    expect(state.db.row(branchLot)).toMatchObject({ onHandQuantity: 7, totalValueMinor: 71 });
  });
  it("replays Firestore transaction attempts without double credit or movement", async () => {
    state.db.retryNext = true;
    await returnInternalTradeGoods(actor, input(2));
    expect(state.db.row("internalTradeInvoices/invoice")).toMatchObject({ returnedMinor: 400, balanceMinor: 1600 });
    expect(state.db.all("internalTradeReturns")).toHaveLength(1);
    expect(state.db.all("inventoryTransactions")).toHaveLength(1);
  });
});
