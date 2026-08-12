import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { balanceDocumentId } from "../functions/src/inventory/calculations";
import { call, setupTransferHarness, type TransferHarness } from "./helpers/transfer-workflow";

let harness: TransferHarness;

beforeAll(async () => {
  harness = await setupTransferHarness({
    suffix: "return",
    openingQuantity: 2,
    trackingType: "serial",
    serialNumbers: ["RETURN-001", "RETURN-002"],
  });
}, 60_000);

afterAll(async () => harness?.cleanup());

describe.sequential("return-to-warehouse callable E2E", () => {
  it("moves an eligible received serial through a controlled return and separate disposition", async () => {
    const prepared = await harness.prepareTransfer(2, [2], harness.serialIds);
    const dispatched = await harness.dispatch(prepared.transferId, prepared.packageIds);
    const receiptBase = {
      transferId: prepared.transferId,
      expectedVersion: 1,
      dispatchId: dispatched.dispatchId,
      deliveryCondition: "good",
      lines: [{
        transferItemId: prepared.transferItemId,
        receivedQuantity: 2,
        damagedQuantity: 0,
        missingQuantity: 0,
        rejectedQuantity: 0,
        serialItemIds: harness.serialIds,
        damagedSerialItemIds: [],
        lotAllocations: [],
      }],
    };
    const receipt = await call<{ receiptId: string }>(harness.receiver, "createTransferReceipt", {
      ...receiptBase,
      idempotencyKey: crypto.randomUUID(),
    });
    await call(harness.receiver, "confirmTransferReceipt", {
      ...receiptBase,
      receiptId: receipt.receiptId,
      idempotencyKey: crypto.randomUUID(),
    });
    const immutableReceipt = await harness.db.doc(`transferReceipts/${receipt.receiptId}`).get();

    await expect(call(harness.receiver, "reportTransferDiscrepancy", {
      transferId: prepared.transferId,
      expectedVersion: 1,
      dispatchId: dispatched.dispatchId,
      receiptId: receipt.receiptId,
      type: "delivery_refused",
      description: "Attempted return exceeds the eligible received quantity",
      lines: [{ transferItemId: prepared.transferItemId, quantity: 3, serialItemIds: harness.serialIds }],
      idempotencyKey: crypto.randomUUID(),
    })).rejects.toMatchObject({ code: "functions/failed-precondition" });

    await expect(call(harness.foreign, "reportTransferDiscrepancy", {
      transferId: prepared.transferId,
      expectedVersion: 1,
      dispatchId: dispatched.dispatchId,
      receiptId: receipt.receiptId,
      type: "delivery_refused",
      description: "Foreign organization return attempt",
      lines: [{ transferItemId: prepared.transferItemId, quantity: 1, serialItemIds: [harness.serialIds[0]] }],
      idempotencyKey: crypto.randomUUID(),
    })).rejects.toMatchObject({ code: "functions/not-found" });

    const reported = await call<{ discrepancyId: string }>(harness.receiver, "reportTransferDiscrepancy", {
      transferId: prepared.transferId,
      expectedVersion: 1,
      dispatchId: dispatched.dispatchId,
      receiptId: receipt.receiptId,
      type: "delivery_refused",
      description: "Branch rejected one inverter after controlled inspection",
      lines: [{ transferItemId: prepared.transferItemId, quantity: 1, serialItemIds: [harness.serialIds[0]] }],
      idempotencyKey: crypto.randomUUID(),
    });
    const resolutionKey = crypto.randomUUID();
    const resolution = {
      transferId: prepared.transferId,
      expectedVersion: 1,
      discrepancyId: reported.discrepancyId,
      resolutionType: "returned_to_warehouse",
      resolutionLocationId: harness.returnLocationId,
      note: "Return approved into warehouse quarantine pending final inspection",
      idempotencyKey: resolutionKey,
    };
    await call(harness.manager, "resolveTransferDiscrepancy", resolution);
    const duplicate = await call<{ resolved: boolean }>(harness.manager, "resolveTransferDiscrepancy", resolution);
    expect(duplicate.resolved).toBe(false);

    expect((await harness.db.doc(`transferReceipts/${receipt.receiptId}`).get()).data()).toEqual(immutableReceipt.data());
    expect((await harness.db.doc(`serializedItems/${harness.serialIds[0]}`).get()).data()).toMatchObject({
      currentLocationId: harness.returnLocationId,
      status: "returned",
      active: true,
    });
    const branchBalance = await harness.db.doc(`inventoryBalances/${balanceDocumentId(harness.organizationId, harness.productId, harness.destinationLocationId)}`).get();
    const returnBalance = await harness.db.doc(`inventoryBalances/${balanceDocumentId(harness.organizationId, harness.productId, harness.returnLocationId)}`).get();
    expect(branchBalance.get("onHandQuantity")).toBe(1);
    expect(returnBalance.get("onHandQuantity")).toBe(1);
    expect(branchBalance.get("onHandQuantity") + returnBalance.get("onHandQuantity")).toBe(2);

    await expect(call(harness.receiver, "reportTransferDiscrepancy", {
      transferId: prepared.transferId,
      expectedVersion: 1,
      dispatchId: dispatched.dispatchId,
      receiptId: receipt.receiptId,
      type: "delivery_refused",
      description: "Duplicate return of the same serial",
      lines: [{ transferItemId: prepared.transferItemId, quantity: 1, serialItemIds: [harness.serialIds[0]] }],
      idempotencyKey: crypto.randomUUID(),
    })).rejects.toMatchObject({ code: "functions/failed-precondition" });

    await call(harness.creator, "moveInventoryBetweenLocations", {
      productId: harness.productId,
      sourceLocationId: harness.returnLocationId,
      destinationLocationId: harness.originLocationId,
      quantity: 1,
      serialNumbers: ["RETURN-001"],
      effectiveAt: new Date().toISOString(),
      reason: "Authorized post-return inspection release",
      idempotencyKey: crypto.randomUUID(),
    });
    expect((await harness.db.doc(`serializedItems/${harness.serialIds[0]}`).get()).data()).toMatchObject({
      currentLocationId: harness.originLocationId,
      status: "available",
    });
    await call(harness.manager, "closeTransfer", { transferId: prepared.transferId, expectedVersion: 1, idempotencyKey: crypto.randomUUID() });
    expect((await harness.db.doc(`transfers/${prepared.transferId}`).get()).get("status")).toBe("closed");
    expect((await harness.db.collection("inventoryTransactions").where("transferId", "==", prepared.transferId).get()).size).toBe(3);
    expect((await harness.db.collection("auditLogs").where("entityId", "==", reported.discrepancyId).get()).size).toBeGreaterThan(0);
  }, 90_000);
});
