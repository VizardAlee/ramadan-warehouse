import { afterEach, describe, expect, it, vi } from "vitest";
import type { CallableRequest } from "firebase-functions/v2/https";
import type { PostingRequest } from "../../functions/src/inventory/post-inventory-transaction";
import type { Transaction } from "firebase-admin/firestore";
import { balanceDocumentId } from "../../functions/src/inventory/calculations";
import { call, setupTransferHarness, type TransferHarness } from "./transfer-workflow";

// Inject only a lost response around the real posting engine. Its Firestore
// transactions, balances, entries and atomic progress extension remain real.
const fault = vi.hoisted(() => ({ phase: "" as "" | "before" | "after", referenceId: "" }));
vi.mock("../../functions/src/inventory/post-inventory-transaction.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../../functions/src/inventory/post-inventory-transaction")>();
  return { ...actual, postInventoryTransaction: async (...args: Parameters<typeof actual.postInventoryTransaction>) => {
    const input: PostingRequest = args[1];
    if (input.referenceId === fault.referenceId && fault.phase === "before") {
      fault.phase = "";
      throw new Error("Injected interruption before real stock commit");
    }
    const result = await actual.postInventoryTransaction(...args);
    if (input.referenceId === fault.referenceId && fault.phase === "after") {
      fault.phase = "";
      throw new Error("Injected lost response after real stock commit");
    }
    return result;
  } };
});
import { confirmTransferDispatch, confirmTransferReceipt, cancelTransfer, reserveTransferStock, releaseTransferReservation } from "../../functions/src/callable/transfers";
import { db as serverDb } from "../../functions/src/admin";

let h: TransferHarness | undefined;
afterEach(async () => { fault.phase = ""; await h?.cleanup(); h = undefined; });
const request = (uid: string, data: Record<string, unknown>) => ({ data, auth: { uid, token: {} } }) as CallableRequest;

// Fail only the response-cache transaction. The business operation has already
// committed to real Firestore; restore the SDK instance before transport retry.
async function interruptCommandCache(path: string, command: () => Promise<unknown>) {
  const original = serverDb.runTransaction.bind(serverDb);
  let interrupted = false;
  Object.defineProperty(serverDb, "runTransaction", { configurable: true, writable: true, value: (handler: (tx: Transaction) => Promise<unknown>) => original(async tx => {
    const update = tx.update.bind(tx);
    Object.defineProperty(tx, "update", { configurable: true, writable: true, value: (...args: unknown[]) => {
      const [reference, values] = args as [{ path?: string }, { status?: string }];
      if (!interrupted && reference?.path === path && values?.status === "completed") {
        interrupted = true;
        throw new Error("Injected cache interruption after real business commit");
      }
      return Reflect.apply(update, tx, args);
    } });
    return handler(tx);
  }) });
  try { await expect(command()).rejects.toThrow("cache interruption after real business commit"); }
  finally { Object.defineProperty(serverDb, "runTransaction", { configurable: true, writable: true, value: original }); }
  expect(interrupted).toBe(true);
}

async function approvedDraft() {
  const warehouseId = (await h!.db.doc(`inventoryLocations/${h!.originLocationId}`).get()).get("warehouseId") as string;
  const branchId = (await h!.db.doc(`inventoryLocations/${h!.destinationLocationId}`).get()).get("branchId") as string;
  const routing = { originWarehouseId: warehouseId, originLocationId: h!.originLocationId, destinationBranchId: branchId, destinationLocationId: h!.destinationLocationId };
  const created = await call<{ transferId: string }>(h!.creator, "createAdminTransfer", { ...routing, purpose: "Reviewed command recovery", priority: "normal", items: [{ productId: h!.productId, quantity: 2 }], directTransferReason: "Synthetic reviewer regression", idempotencyKey: crypto.randomUUID() });
  return { ...routing, transferId: created.transferId, transferItemId: `${created.transferId}__${h!.productId}` };
}

describe.sequential("real posting engine interruption and retry security", () => {
  it("rejects a W2 inventory location substituted under an unchanged W1 draft warehouse", async () => {
    h = await setupTransferHarness({ suffix: "review-route", openingQuantity: 4 });
    const draft = await approvedDraft();
    await h.db.doc(`transfers/${draft.transferId}`).update({ createdBy: h.manager.uid });
    await h.db.doc("warehouses/review-w2").set({ organizationId: h.organizationId, status: "active" });
    await h.db.doc("inventoryLocations/review-w2-bin").set({ organizationId: h.organizationId, warehouseId: "review-w2", status: "active", type: "warehouse" });
    const input = { ...draft, expectedVersion: 0, originLocationId: "review-w2-bin", purpose: "Attempt wrong warehouse bin", priority: "normal", items: [{ productId: h.productId, quantity: 2 }], idempotencyKey: crypto.randomUUID() };
    await expect(call(h.manager, "updateTransferDraft", input)).rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect((await h.db.doc(`transfers/${draft.transferId}`).get()).data()).toMatchObject({ originWarehouseId: draft.originWarehouseId, originLocationId: h.originLocationId, destinationBranchId: draft.destinationBranchId });
    await h.db.doc("inventoryLocations/review-w1-bin").set({ organizationId: h.organizationId, warehouseId: draft.originWarehouseId, status: "active", type: "warehouse" });
    expect(await call(h.manager, "updateTransferDraft", { ...input, originLocationId: "review-w1-bin", idempotencyKey: crypto.randomUUID() })).toMatchObject({ updated: true });
  }, 120_000);

  it.each(["cancelTransfer", "reserveTransferStock", "releaseTransferReservation"] as const)("recovers %s after real business commit but before cache completion", async action => {
    h = await setupTransferHarness({ suffix: `review-${action.toLowerCase()}`, openingQuantity: 4 });
    const draft = await approvedDraft();
    await call(h.creator, "submitTransfer", { transferId: draft.transferId, expectedVersion: 0, idempotencyKey: crypto.randomUUID() });
    await call(h.manager, "approveTransfer", { transferId: draft.transferId, expectedVersion: 1, idempotencyKey: crypto.randomUUID() });
    if (action !== "reserveTransferStock") await call(h.manager, "reserveTransferStock", { transferId: draft.transferId, expectedVersion: 1, idempotencyKey: crypto.randomUUID() });
    const input = { transferId: draft.transferId, expectedVersion: 1, reason: "Original reviewed command", idempotencyKey: crypto.randomUUID() };
    const cachePath = `idempotencyKeys/${h.organizationId}_transferCommand_${input.idempotencyKey}`;
    const callable = { cancelTransfer, reserveTransferStock, releaseTransferReservation }[action];
    await interruptCommandCache(cachePath, () => callable.run(request(h!.manager.uid, input)));
    expect((await h.db.doc(cachePath).get()).get("status")).toBe("pending");
    const transferRef = h.db.doc(`transfers/${draft.transferId}`);
    expect((await transferRef.get()).get("status")).toBe(action === "cancelTransfer" ? "cancelled" : action === "reserveTransferStock" ? "reserved" : "approved");
    const sourceRef = h.db.doc(`inventoryBalances/${balanceDocumentId(h.organizationId, h.productId, h.originLocationId)}`);
    const balance = (await sourceRef.get()).data();
    const events = await h.db.collection("transferEvents").where("transferId", "==", draft.transferId).get();
    await h.db.doc(`users/${h.manager.uid}`).update({ warehouseIds: [] });
    await expect(call(h.manager, action, input)).rejects.toMatchObject({ code: "functions/permission-denied" });
    await h.db.doc(`users/${h.manager.uid}`).update({ warehouseIds: [draft.originWarehouseId] });
    await expect(call(h.creator, action, input)).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(call(h.manager, action, { ...input, reason: "Changed command" })).rejects.toMatchObject({ code: "functions/permission-denied" });
    await transferRef.update({ version: 2 });
    expect(await call(h.manager, action, input)).toMatchObject({ repeated: true, [action === "cancelTransfer" ? "cancelled" : action === "reserveTransferStock" ? "reserved" : "released"]: false, ...(action === "cancelTransfer" ? { remainingCancelled: false } : { quantity: 2 }) });
    expect((await sourceRef.get()).data()).toEqual(balance);
    expect((await h.db.collection("transferEvents").where("transferId", "==", draft.transferId).get()).size).toBe(events.size);
    expect((await h.db.doc(cachePath).get()).get("status")).toBe("completed");
  }, 120_000);

  it("recovers before/after dispatch commit and after partial receipt commit without repeating stock", async () => {
    h = await setupTransferHarness({ suffix: "recover", openingQuantity: 4 });
    const prepared = await h.prepareTransfer(4, [2, 2]);
    const base = { transferId: prepared.transferId, expectedVersion: 1, packageIds: prepared.packageIds, driverName: "Recovery driver", verifiedBy: h.manager.uid };
    const created = await call<{ dispatchId: string }>(h.logistics, "createTransferDispatch", { ...base, idempotencyKey: crypto.randomUUID() });
    const confirmation = { ...base, dispatchId: created.dispatchId, idempotencyKey: crypto.randomUUID() };
    fault.referenceId = created.dispatchId;
    fault.phase = "before";
    await expect(confirmTransferDispatch.run(request(h.logistics.uid, confirmation))).rejects.toThrow("before real stock commit");
    const balance = async (location: string) => Number((await h!.db.doc(`inventoryBalances/${balanceDocumentId(h!.organizationId, h!.productId, location)}`).get()).get("onHandQuantity") ?? 0);
    expect(await balance(h.originLocationId)).toBe(4);
    expect(await balance(h.transitLocationId)).toBe(0);
    fault.phase = "after";
    await expect(confirmTransferDispatch.run(request(h.logistics.uid, confirmation))).rejects.toThrow("after real stock commit");
    expect(await balance(h.originLocationId)).toBe(0);
    expect(await balance(h.transitLocationId)).toBe(4);
    expect((await h.db.doc(`transfers/${prepared.transferId}`).get()).get("activeStockExecutionId")).toBeTruthy();
    expect((await h.db.doc(`transferDispatches/${created.dispatchId}`).get()).get("status")).toBe("draft");
    await expect(call(h.manager, "confirmTransferDispatch", confirmation)).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(call(h.logistics, "confirmTransferDispatch", { ...confirmation, driverName: "Changed driver" })).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(call(h.logistics, "confirmTransferDispatch", { ...confirmation, driverName: "Changed driver", idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect(await call(h.logistics, "confirmTransferDispatch", confirmation)).toMatchObject({ confirmed: true });
    expect(await call(h.logistics, "confirmTransferDispatch", confirmation)).toMatchObject({ confirmed: false, repeated: true });
    expect(await balance(h.transitLocationId)).toBe(4);
    expect((await h.db.collection("inventoryTransactions").where("referenceId", "==", created.dispatchId).get()).size).toBe(1);
    expect((await h.db.doc(`transfers/${prepared.transferId}`).get()).get("activeStockExecutionId")).toBeUndefined();

    const receiptBase = { transferId: prepared.transferId, expectedVersion: 1, dispatchId: created.dispatchId, deliveryCondition: "good", lines: [{ transferItemId: prepared.transferItemId, receivedQuantity: 2, damagedQuantity: 0, missingQuantity: 0, rejectedQuantity: 0, serialItemIds: [], damagedSerialItemIds: [], lotAllocations: [] }] };
    const receipt = await call<{ receiptId: string }>(h.receiver, "createTransferReceipt", { ...receiptBase, idempotencyKey: crypto.randomUUID() });
    const receiptConfirmation = { ...receiptBase, receiptId: receipt.receiptId, idempotencyKey: crypto.randomUUID() };
    fault.referenceId = receipt.receiptId;
    fault.phase = "after";
    await expect(confirmTransferReceipt.run(request(h.receiver.uid, receiptConfirmation))).rejects.toThrow("after real stock commit");
    expect(await balance(h.destinationLocationId)).toBe(2);
    expect(await balance(h.transitLocationId)).toBe(2);
    expect((await h.db.doc(`transferReceipts/${receipt.receiptId}`).get()).get("status")).toBe("draft");
    expect(await call(h.receiver, "confirmTransferReceipt", receiptConfirmation)).toMatchObject({ confirmed: true });
    await h.db.doc(`users/${h.receiver.uid}`).update({ branchIds: [] });
    await expect(call(h.receiver, "confirmTransferReceipt", receiptConfirmation)).rejects.toMatchObject({ code: "functions/permission-denied" });
    await h.db.doc(`users/${h.receiver.uid}`).update({ branchIds: ["recover-branch"] });
    expect(await call(h.receiver, "confirmTransferReceipt", receiptConfirmation)).toMatchObject({ confirmed: false, repeated: true });
    const lastReceipt = await call<{ receiptId: string }>(h.receiver, "createTransferReceipt", { ...receiptBase, idempotencyKey: crypto.randomUUID() });
    await call(h.receiver, "confirmTransferReceipt", { ...receiptBase, receiptId: lastReceipt.receiptId, idempotencyKey: crypto.randomUUID() });
    expect(await balance(h.destinationLocationId)).toBe(4);
    expect(await balance(h.transitLocationId)).toBe(0);
    expect((await h.db.collection("inventoryTransactions").where("referenceId", "==", receipt.receiptId).get()).size).toBe(1);
    expect((await h.db.doc(`transferItems/${prepared.transferItemId}`).get()).get("receivedQuantity")).toBe(4);
  }, 120_000);

  it("limits partial serial receipts to their own dispatch and rejects duplicate claims", async () => {
    h = await setupTransferHarness({ suffix: "recover-serial", openingQuantity: 4, trackingType: "serial", serialNumbers: ["REC-1", "REC-2", "REC-3", "REC-4"] });
    const prepared = await h.prepareTransfer(4, [2, 2], h.serialIds);
    const dispatched = await h.dispatch(prepared.transferId, [prepared.packageIds[0]!]);
    const base = { transferId: prepared.transferId, expectedVersion: 1, dispatchId: dispatched.dispatchId, deliveryCondition: "good" };
    const line = (id: string) => ({ transferItemId: prepared.transferItemId, receivedQuantity: 1, damagedQuantity: 0, missingQuantity: 0, rejectedQuantity: 0, serialItemIds: [id], damagedSerialItemIds: [], lotAllocations: [] });
    const attemptReceipt = async (serialId: string) => {
      const receiptBase = { ...base, lines: [line(serialId)] };
      const receipt = await call<{ receiptId: string }>(h!.receiver, "createTransferReceipt", { ...receiptBase, idempotencyKey: crypto.randomUUID() });
      return call(h!.receiver, "confirmTransferReceipt", { ...receiptBase, receiptId: receipt.receiptId, idempotencyKey: crypto.randomUUID() });
    };
    // Drafts may retain unverified counts. The stock-committing confirmation
    // must reject identities belonging to another dispatch or already claimed.
    await expect(attemptReceipt(h.serialIds[2]!)).rejects.toMatchObject({ code: "functions/failed-precondition" });
    for (const serialId of h.serialIds.slice(0, 2)) {
      const receiptBase = { ...base, lines: [line(serialId)] };
      const receipt = await call<{ receiptId: string }>(h.receiver, "createTransferReceipt", { ...receiptBase, idempotencyKey: crypto.randomUUID() });
      const confirmation = { ...receiptBase, receiptId: receipt.receiptId, idempotencyKey: crypto.randomUUID() };
      const results = await Promise.allSettled([confirmTransferReceipt.run(request(h.receiver.uid, confirmation)), confirmTransferReceipt.run(request(h.receiver.uid, confirmation))]);
      expect(results.filter(result => result.status === "fulfilled"), JSON.stringify(results.map(result => result.status === "rejected" ? { message: result.reason?.message, code: result.reason?.code, details: result.reason?.details } : result.value))).toHaveLength(2);
      expect(results.filter(result => result.status === "fulfilled" && result.value.confirmed)).toHaveLength(1);
      await expect(attemptReceipt(serialId)).rejects.toMatchObject({ code: "functions/failed-precondition" });
    }
    for (const serialId of h.serialIds.slice(0, 2)) expect((await h.db.doc(`serializedItems/${serialId}`).get()).get("currentLocationId")).toBe(h.destinationLocationId);
    for (const serialId of h.serialIds.slice(2)) expect((await h.db.doc(`serializedItems/${serialId}`).get()).get("currentLocationId")).toBe(h.originLocationId);
    expect((await h.db.doc(`transferItems/${prepared.transferItemId}`).get()).get("receivedQuantity")).toBe(2);
    const events = await h.db.collection("integrationOutbox").where("entityId", "==", prepared.transferId).get();
    const partialReceipts = events.docs.filter(event => event.get("eventType") === "warehouse.transfer.partially_received.v1");
    expect(partialReceipts).toHaveLength(2);
    expect(new Set(partialReceipts.map(event => event.get("idempotencyKey"))).size).toBe(2);
  }, 120_000);
});
