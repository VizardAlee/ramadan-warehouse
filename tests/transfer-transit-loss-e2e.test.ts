import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { balanceDocumentId } from "../functions/src/inventory/calculations";
import { call, setupTransferHarness, type TransferHarness } from "./helpers/transfer-workflow";

let harness: TransferHarness;

beforeAll(async () => {
  harness = await setupTransferHarness({ suffix: "loss", openingQuantity: 5 });
}, 60_000);

afterAll(async () => harness?.cleanup());

describe.sequential("confirmed transit-loss callable E2E", () => {
  it("keeps missing stock in transit until one authorized immutable write-off wins", async () => {
    const prepared = await harness.prepareTransfer(5, [5]);
    const dispatched = await harness.dispatch(prepared.transferId, prepared.packageIds);
    const dispatchDocument = await harness.db.doc(`transferDispatches/${dispatched.dispatchId}`).get();
    const dispatchTransactionId = (dispatchDocument.get("inventoryTransactionIds") as string[])[0]!;
    const immutableDispatch = await harness.db.doc(`inventoryTransactions/${dispatchTransactionId}`).get();
    const receiptBase = {
      transferId: prepared.transferId,
      expectedVersion: 1,
      dispatchId: dispatched.dispatchId,
      deliveryCondition: "partially_damaged",
      lines: [{
        transferItemId: prepared.transferItemId,
        receivedQuantity: 3,
        damagedQuantity: 0,
        missingQuantity: 2,
        rejectedQuantity: 0,
        serialItemIds: [],
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
    const transitBalanceRef = harness.db.doc(`inventoryBalances/${balanceDocumentId(harness.organizationId, harness.productId, harness.transitLocationId)}`);
    expect((await transitBalanceRef.get()).get("onHandQuantity")).toBe(2);
    const discrepancies = await harness.db.collection("transferDiscrepancies")
      .where("transferId", "==", prepared.transferId)
      .where("status", "==", "open")
      .get();
    expect(discrepancies.size).toBe(1);
    const discrepancyId = discrepancies.docs[0]!.id;
    expect(discrepancies.docs[0]!.get("quantity")).toBe(2);

    await expect(call(harness.manager, "closeTransfer", {
      transferId: prepared.transferId,
      expectedVersion: 1,
      idempotencyKey: crypto.randomUUID(),
    })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await expect(call(harness.unauthorized, "resolveTransferDiscrepancy", {
      transferId: prepared.transferId,
      expectedVersion: 1,
      discrepancyId,
      resolutionType: "written_off",
      note: "Unauthorized loss confirmation attempt",
      idempotencyKey: crypto.randomUUID(),
    })).rejects.toMatchObject({ code: "functions/permission-denied" });
    expect((await transitBalanceRef.get()).get("onHandQuantity")).toBe(2);

    const keys = [crypto.randomUUID(), crypto.randomUUID()];
    const attempts = await Promise.allSettled(keys.map((idempotencyKey) =>
      call<{ resolved: boolean; inventoryTransactionIds: string[] }>(harness.creator, "resolveTransferDiscrepancy", {
        transferId: prepared.transferId,
        expectedVersion: 1,
        discrepancyId,
        resolutionType: "written_off",
        note: "Investigation confirmed two units lost in transit",
        idempotencyKey,
      }),
    ));
    const successfulResolutions = attempts.filter(
      (result): result is PromiseFulfilledResult<{ resolved: boolean; inventoryTransactionIds: string[] }> =>
        result.status === "fulfilled" && result.value.resolved,
    );
    expect(successfulResolutions).toHaveLength(1);
    expect(attempts.filter((result) => result.status === "rejected").length).toBeLessThanOrEqual(1);
    expect((await transitBalanceRef.get()).get("onHandQuantity")).toBe(0);
    const resolved = await harness.db.doc(`transferDiscrepancies/${discrepancyId}`).get();
    expect(resolved.data()).toMatchObject({ status: "resolved", resolutionType: "written_off", quantity: 2 });
    const writeOffIds = resolved.get("resolutionTransactionIds") as string[];
    expect(writeOffIds).toHaveLength(1);
    expect((await harness.db.doc(`inventoryTransactions/${writeOffIds[0]}`).get()).data()).toMatchObject({
      transactionType: "discrepancy_resolution",
      sourceLocationId: harness.transitLocationId,
    });
    const writeOffEntries = await harness.db.collection("inventoryEntries").where("transactionId", "==", writeOffIds[0]).get();
    expect(writeOffEntries.docs.reduce((sum, entry) => sum + Number(entry.get("quantityDelta")), 0)).toBe(0);
    expect(writeOffEntries.docs.find((entry) => entry.get("externalAccount") === "transfer_loss_write_off")?.get("quantityDelta")).toBe(2);
    expect((await harness.db.doc(`inventoryTransactions/${dispatchTransactionId}`).get()).data()).toEqual(immutableDispatch.data());
    const duplicate = await call<{ resolved: boolean }>(harness.creator, "resolveTransferDiscrepancy", {
      transferId: prepared.transferId,
      expectedVersion: 1,
      discrepancyId,
      resolutionType: "written_off",
      note: "Investigation confirmed two units lost in transit",
      idempotencyKey: keys[attempts.findIndex((result) => result.status === "fulfilled" && result.value.resolved)]!,
    });
    expect(duplicate.resolved).toBe(false);
    expect((await harness.db.collection("inventoryTransactions").where("transferId", "==", prepared.transferId).get()).size).toBe(3);
    expect((await harness.db.collection("branchRequestEvents").where("transferId", "==", prepared.transferId).get()).size).toBe(0);
    await call(harness.manager, "closeTransfer", { transferId: prepared.transferId, expectedVersion: 1, idempotencyKey: crypto.randomUUID() });
    expect((await harness.db.doc(`transfers/${prepared.transferId}`).get()).get("status")).toBe("closed");
  }, 90_000);
});
