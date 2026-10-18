import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessProfile } from "../functions/src/auth/authorize";
import { balanceDocumentId } from "../functions/src/inventory/calculations";
import type { StockTransfer } from "../functions/src/transfers/simple-model";
import { evaluateSimpleTransfer } from "../functions/src/transfers/validate-simple-transfer";
import { TransferFirestoreFixture } from "./helpers/transfer-firestore-fixture";

const state = vi.hoisted(() => ({ db: null as unknown as TransferFirestoreFixture, actor: null as unknown as AccessProfile }));
vi.mock("../functions/src/admin.js", () => ({ db: {
  doc: (path: string) => state.db.doc(path),
  collection: (path: string) => state.db.collection(path),
  getAll: (...refs: Parameters<TransferFirestoreFixture["getAll"]>) => state.db.getAll(...refs),
  runTransaction: (handler: Parameters<TransferFirestoreFixture["runTransaction"]>[0]) => state.db.runTransaction(handler),
} }));
vi.mock("../functions/src/auth/authorize.js", async importOriginal => ({
  ...await importOriginal<typeof import("../functions/src/auth/authorize")>(), requireAccess: async () => state.actor,
}));
vi.mock("../functions/src/config.js", () => ({ enforceAppCheck: false }));
import { stockTransfers } from "../functions/src/callable/stock-transfers";

const invoke = async <T = { transferId: string; repeated: boolean }>(data: object) =>
  await stockTransfers.run({ data } as Parameters<typeof stockTransfers.run>[0]) as T;
const manager = (side: "source" | "destination"): AccessProfile => ({
  userId: side, organizationId: "org", roleId: "branch_manager",
  roleIds: ["branch_manager"], directRoleIds: ["branch_manager"],
  branchIds: [side === "source" ? "source-branch" : "branch"], warehouseIds: [], authorizationVersion: 1,
});
function balance(location = "source", product = "product", lot?: string) {
  return `inventoryBalances/${balanceDocumentId("org", product, location, lot)}`;
}
const transfer = (id: string) => state.db.row(`stockTransfers/${id}`) as unknown as StockTransfer;
const key = () => crypto.randomUUID();
async function create(quantity = 5, extra: object = {}) {
  state.actor = manager("destination");
  return (await invoke({ action: "create", sourceLocationId: "source", destinationLocationId: "destination", items: [{ productId: "product", quantity }], idempotencyKey: key(), ...extra })).transferId;
}
async function approve(id: string, quantity = transfer(id).items[0]!.requested) {
  state.actor = manager("source");
  return invoke({ action: "approve", transferId: id, version: transfer(id).version, lines: [{ id: transfer(id).items[0]!.id, quantity }], idempotencyKey: key() });
}
async function receive(id: string, received: number, damaged = 0) {
  state.actor = manager("destination");
  return invoke({ action: "receive", transferId: id, version: transfer(id).version, lines: [{ id: transfer(id).items[0]!.id, received, damaged }], idempotencyKey: key() });
}
async function resolve(id: string, disposition: "never_left" | "lost" | "still_expected") {
  state.actor = manager("source");
  return invoke({ action: "resolve", transferId: id, version: transfer(id).version, disposition, note: "Fixture verified decision", idempotencyKey: key() });
}
function evidence(id: string) {
  const records = (collection: string) => state.db.all(collection).filter(row => row.transferId === id).map((row, index) => ({ ...row, id: String(index) }));
  return evaluateSimpleTransfer(transfer(id), records("stockTransferReceipts"), records("inventoryEntries"));
}
beforeEach(() => {
  state.db = new TransferFirestoreFixture();
  state.actor = manager("source");
  const active = { organizationId: "org", status: "active" };
  state.db.seed("warehouses/warehouse", { ...active, name: "Main warehouse" });
  state.db.seed("branches/branch", { ...active, name: "Receiving branch" });
  state.db.seed("branches/source-branch", { ...active, name: "Sending store" });
  state.db.seed("inventoryLocations/source", { ...active, name: "Sending stock", type: "branch", branchId: "source-branch" });
  state.db.seed("inventoryLocations/warehouse", { ...active, name: "Legacy warehouse", type: "warehouse", warehouseId: "warehouse" });
  state.db.seed("inventoryLocations/destination", { ...active, name: "Branch stock", type: "branch", branchId: "branch" });
  state.db.seed("products/product", { organizationId: "org", active: true, trackingType: "quantity", name: "Panel", sku: "PV" });
  state.db.seed(balance(), { organizationId: "org", productId: "product", locationId: "source", onHandQuantity: 10, reservedQuantity: 0, availableQuantity: 10, totalValueMinor: 101, version: 0 });
});

describe("offline manager transfer workflows", () => {
  it("preserves store-only discovery without exposing legacy warehouse, system or inactive areas", async () => {
    state.db.seed("warehouses/inactive", { organizationId: "org", status: "inactive", name: "Closed" });
    state.db.seed("inventoryLocations/closed", { organizationId: "org", status: "active", type: "warehouse", warehouseId: "inactive" });
    state.db.seed("inventoryLocations/transit", { organizationId: "org", status: "active", type: "goods_in_transit", branchId: "branch" });
    state.db.seed("inventoryLocations/foreign", { organizationId: "other", status: "active", type: "warehouse", warehouseId: "warehouse" });
    const result = await invoke<{ locations: Array<{ id: string; name: string; assigned: boolean }> }>({ action: "options" });
    expect(result.locations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "source", name: "Sending store", assigned: true }),
      expect.objectContaining({ id: "destination", name: "Receiving branch", assigned: false }),
    ]));
    expect(result.locations).toHaveLength(2);
    expect(result.locations.map(location => location.id)).not.toContain("warehouse");
  });

  it("holds approval stock, permits partial receipts, and conserves final-unit quantity and value", async () => {
    const id = await create(10);
    expect(state.db.row(balance())).toMatchObject({ onHandQuantity: 10, reservedQuantity: 0 });
    await approve(id);
    expect(state.db.row(balance())).toMatchObject({ onHandQuantity: 10, reservedQuantity: 10, availableQuantity: 0 });
    expect(state.db.all("inventoryEntries")).toHaveLength(0);
    await receive(id, 3);
    expect(transfer(id).status).toBe("partially_received");
    expect(state.db.row(balance())).toMatchObject({ onHandQuantity: 7, reservedQuantity: 7, availableQuantity: 0 });
    await expect(receive(id, 8)).rejects.toMatchObject({ code: "failed-precondition" });
    await receive(id, 7);
    expect(state.db.row(balance())).toMatchObject({ onHandQuantity: 0, reservedQuantity: 0, totalValueMinor: 0 });
    expect(state.db.row(balance("destination"))).toMatchObject({ onHandQuantity: 10, totalValueMinor: 101 });
    expect(transfer(id).status).toBe("completed");
    expect(evidence(id).status).toBe("clean");
  });

  it("keeps damaged stock unsaleable and records loss without freeing missing goods", async () => {
    const id = await create(5);
    await approve(id);
    await receive(id, 2, 1);
    expect(transfer(id).status).toBe("problem");
    expect(state.db.row(balance("simple_damaged_branch"))).toMatchObject({ onHandQuantity: 1 });
    expect(state.db.row(balance("destination"))).toMatchObject({ onHandQuantity: 2 });
    await resolve(id, "lost");
    expect(state.db.row(balance())).toMatchObject({ onHandQuantity: 5, reservedQuantity: 0, availableQuantity: 5 });
    expect(transfer(id).items[0]).toMatchObject({ received: 2, damaged: 1, writtenOff: 2 });
    expect(evidence(id).status).toBe("clean");
  });

  it("releases requested demand on cancellation, including before approval and after partial receipt", async () => {
    state.db.seed("branchRequests/request", { organizationId: "org", branchId: "branch", status: "approved", totalApprovedQuantity: 10, totalFulfilledQuantity: 0 });
    state.db.seed("branchRequestItems/item", { organizationId: "org", requestId: "request", productId: "product", approvedQuantity: 10, fulfilledQuantity: 0, transferAllocatedQuantity: 0 });
    const request = { sourceRequestId: "request", items: [{ productId: "product", quantity: 5, sourceRequestItemId: "item" }] };
    const cancelled = await create(5, request);
    await resolve(cancelled, "never_left");
    expect(transfer(cancelled)).toMatchObject({ status: "cancelled", items: [expect.objectContaining({ approved: 0, cancelled: 0 })] });
    expect(state.db.row("branchRequestItems/item").transferAllocatedQuantity).toBe(0);
    const id = await create(5, request);
    await approve(id, 4);
    expect(state.db.row("branchRequestItems/item").transferAllocatedQuantity).toBe(4);
    await receive(id, 2);
    await resolve(id, "never_left");
    expect(state.db.row("branchRequestItems/item")).toMatchObject({ approvedQuantity: 10, fulfilledQuantity: 2, transferAllocatedQuantity: 0, outstandingQuantity: 8 });
    expect(state.db.row(balance())).toMatchObject({ onHandQuantity: 8, reservedQuantity: 0 });
    expect(evidence(id).status).toBe("clean");
    expect(evidence(cancelled).status).toBe("clean");
  });

  it("checks source/destination scope and stale versions before touching stock", async () => {
    const id = await create();
    const line = transfer(id).items[0]!;
    await expect(invoke({ action: "approve", transferId: id, version: 0, lines: [{ id: line.id, quantity: 5 }], idempotencyKey: key() })).rejects.toMatchObject({ code: "permission-denied" });
    await approve(id);
    await expect(invoke({ action: "receive", transferId: id, version: 1, lines: [{ id: line.id, received: 5, damaged: 0 }], idempotencyKey: key() })).rejects.toMatchObject({ code: "permission-denied" });
    state.actor = manager("destination");
    await expect(invoke({ action: "receive", transferId: id, version: 0, lines: [{ id: line.id, received: 5, damaged: 0 }], idempotencyKey: key() })).rejects.toMatchObject({ code: "failed-precondition" });
    expect(state.db.row(balance())).toMatchObject({ onHandQuantity: 10, reservedQuantity: 5 });
    expect(state.db.all("stockTransferReceipts")).toHaveLength(0);
  });

  it("rolls back all lines on insufficient stock and rejects a competing approval after the hold", async () => {
    state.db.seed("products/empty", { organizationId: "org", active: true, trackingType: "quantity", name: "Empty", sku: "EMPTY" });
    const multi = await create(5, { items: [{ productId: "product", quantity: 5 }, { productId: "empty", quantity: 1 }] });
    state.actor = manager("source");
    await expect(invoke({ action: "approve", transferId: multi, version: 0, lines: transfer(multi).items.map(line => ({ id: line.id, quantity: line.requested })), idempotencyKey: key() })).rejects.toMatchObject({ code: "failed-precondition" });
    expect(state.db.row(balance()).reservedQuantity).toBe(0);
    expect(transfer(multi).status).toBe("requested");
    const a = await create(10), b = await create(10);
    const outcomes = await Promise.allSettled([approve(a), approve(b)]);
    expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
    expect(state.db.row(balance()).reservedQuantity).toBe(10);
  });

  it("discards a retried transaction attempt and binds replay to the original actor and payload", async () => {
    const id = await create(5);
    await approve(id);
    state.actor = manager("destination");
    const input = { action: "receive", transferId: id, version: 1, lines: [{ id: transfer(id).items[0]!.id, received: 5, damaged: 0 }], idempotencyKey: key() };
    state.db.retryNext = true;
    expect(await invoke(input)).toMatchObject({ repeated: false });
    expect(await invoke(input)).toMatchObject({ repeated: true });
    expect(state.db.all("stockTransferReceipts")).toHaveLength(1);
    expect(state.db.row(balance("destination")).onHandQuantity).toBe(5);
    await expect(invoke({ ...input, lines: [{ ...input.lines[0]!, received: 4 }] })).rejects.toMatchObject({ code: "failed-precondition" });
    state.actor = { ...manager("destination"), userId: "another-manager" };
    await expect(invoke(input)).rejects.toMatchObject({ code: "permission-denied" });
    expect(evidence(id).status).toBe("clean");
  });

  it.each(["serial", "batch"])("keeps %s identities and lot stock consistent across partial arrival and cancellation", async trackingType => {
    state.db.seed("products/tracked", { organizationId: "org", active: true, trackingType, name: "Tracked panel", sku: "TRACKED" });
    const lotId = trackingType === "batch" ? "lot" : undefined;
    state.db.seed(balance("source", "tracked", lotId), { organizationId: "org", productId: "tracked", locationId: "source", onHandQuantity: 2, reservedQuantity: 0, availableQuantity: 2, totalValueMinor: 200 });
    if (lotId) state.db.seed("inventoryLots/lot", { organizationId: "org", productId: "tracked", lotNumber: "LOT", remainingQuantity: 2, locationQuantities: { source: 2 } });
    const serialItemIds = trackingType === "serial" ? ["serial-one", "serial-two"] : [];
    for (const serial of serialItemIds) state.db.seed(`serializedItems/${serial}`, { organizationId: "org", productId: "tracked", serialNumber: serial, currentLocationId: "source", branchId: "source-branch", status: "at_branch", active: true, currentUnitCostMinor: 100 });
    const id = await create(2, { items: [{ productId: "tracked", quantity: 2, ...(lotId ? { lotId } : {}) }] });
    const lineId = transfer(id).items[0]!.id;
    state.actor = manager("source");
    const approval = { action: "approve", transferId: id, version: 0, lines: [{ id: lineId, quantity: 2, serialItemIds }], idempotencyKey: key() };
    if (trackingType === "serial") {
      await expect(invoke({ ...approval, lines: [{ id: lineId, quantity: 2, serialItemIds: [serialItemIds[0], serialItemIds[0]] }] })).rejects.toMatchObject({ code: "failed-precondition" });
      state.db.seed("serializedItems/serial-one", { ...state.db.row("serializedItems/serial-one"), reservedSaleId: "sale" });
      await expect(invoke(approval)).rejects.toMatchObject({ code: "failed-precondition" });
      state.db.seed("serializedItems/serial-one", { ...state.db.row("serializedItems/serial-one"), reservedSaleId: null });
    }
    await invoke(approval);
    state.actor = manager("destination");
    await invoke({ action: "receive", transferId: id, version: 1, lines: [{ id: lineId, received: 1, damaged: 0, serialItemIds: serialItemIds.slice(0, 1) }], idempotencyKey: key() });
    await resolve(id, "never_left");
    expect(state.db.row(balance("source", "tracked", lotId))).toMatchObject({ onHandQuantity: 1, reservedQuantity: 0, availableQuantity: 1, totalValueMinor: 100 });
    expect(state.db.row(balance("destination", "tracked", lotId))).toMatchObject({ onHandQuantity: 1, totalValueMinor: 100 });
    if (trackingType === "serial") {
      expect(state.db.row("serializedItems/serial-one")).toMatchObject({ status: "at_branch", currentLocationId: "destination", branchId: "branch" });
      expect(state.db.row("serializedItems/serial-two")).toMatchObject({ status: "at_branch", currentLocationId: "source", branchId: "source-branch" });
      expect(state.db.row("serializedItems/serial-two")).not.toHaveProperty("reservedTransferId");
    } else expect(state.db.row("inventoryLots/lot")).toMatchObject({ remainingQuantity: 2, locationQuantities: { source: 1, destination: 1 } });
    expect(evidence(id).status).toBe("clean");
  });
});
