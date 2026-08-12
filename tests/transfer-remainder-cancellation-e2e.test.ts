import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { balanceDocumentId } from "../functions/src/inventory/calculations";
import { call, setupTransferHarness, type TransferHarness } from "./helpers/transfer-workflow";

let harness: TransferHarness;

beforeAll(async () => {
  harness = await setupTransferHarness({ suffix: "remainder", openingQuantity: 20 });
}, 60_000);

afterAll(async () => harness?.cleanup());

describe.sequential("partial-dispatch remainder cancellation callable E2E", () => {
  it("releases only the undispatched reservation and preserves the confirmed dispatch", async () => {
    const prepared = await harness.prepareTransfer(20, [12, 8]);
    const dispatched = await harness.dispatch(prepared.transferId, [prepared.packageIds[0]!]);
    const requestId = "remainder-request";
    const requestItemId = "remainder-request-item";
    const approvalId = "remainder-request-approval";
    await Promise.all([
      harness.db.doc(`branchRequests/${requestId}`).set({
        organizationId: harness.organizationId,
        branchId: "remainder-branch",
        status: "partially_fulfilled",
        version: 1,
        totalApprovedQuantity: 20,
        totalFulfilledQuantity: 0,
        totalOutstandingQuantity: 20,
      }),
      harness.db.doc(`branchRequestItems/${requestItemId}`).set({
        organizationId: harness.organizationId,
        requestId,
        branchId: "remainder-branch",
        productId: harness.productId,
        approvedQuantity: 20,
        fulfilledQuantity: 0,
        outstandingQuantity: 20,
        transferAllocatedQuantity: 20,
      }),
      harness.db.doc(`branchRequestApprovals/${approvalId}`).set({
        organizationId: harness.organizationId,
        requestId,
        requestVersion: 1,
        decision: "approved",
      }),
      harness.db.doc(`transfers/${prepared.transferId}`).update({ sourceType: "branch_request", sourceRequestId: requestId }),
      harness.db.doc(`transferItems/${prepared.transferItemId}`).update({ sourceRequestItemId: requestItemId }),
    ]);
    const draftBase = {
      transferId: prepared.transferId,
      expectedVersion: 1,
      packageIds: [prepared.packageIds[1]!],
      driverName: "Cancelled remainder driver",
      verifiedBy: harness.manager.uid,
    };
    const draft = await call<{ dispatchId: string }>(harness.logistics, "createTransferDispatch", {
      ...draftBase,
      idempotencyKey: crypto.randomUUID(),
    });
    const cancellationKey = crypto.randomUUID();
    const cancellation = {
      transferId: prepared.transferId,
      expectedVersion: 1,
      reason: "Destination reduced its final requirement before second dispatch",
      idempotencyKey: cancellationKey,
    };
    const first = await call<{ remainingCancelled: boolean }>(harness.creator, "cancelTransfer", cancellation);
    expect(first.remainingCancelled).toBe(true);
    expect(await call(harness.creator, "cancelTransfer", cancellation)).toMatchObject({ cancelled: false });

    const item = await harness.db.doc(`transferItems/${prepared.transferItemId}`).get();
    expect(item.data()).toMatchObject({ approvedQuantity: 20, dispatchedQuantity: 12, cancelledQuantity: 8, outstandingQuantity: 12 });
    const reservation = await harness.db.doc(`stockReservations/${prepared.transferId}__${prepared.transferItemId}`).get();
    expect(reservation.data()).toMatchObject({ consumedQuantity: 12, releasedQuantity: 8, remainingQuantity: 0, status: "released" });
    const origin = await harness.db.doc(`inventoryBalances/${balanceDocumentId(harness.organizationId, harness.productId, harness.originLocationId)}`).get();
    const transit = await harness.db.doc(`inventoryBalances/${balanceDocumentId(harness.organizationId, harness.productId, harness.transitLocationId)}`).get();
    expect(origin.data()).toMatchObject({ onHandQuantity: 8, reservedQuantity: 0, availableQuantity: 8 });
    expect(transit.get("onHandQuantity")).toBe(12);
    expect((await harness.db.doc(`branchRequestItems/${requestItemId}`).get()).data()).toMatchObject({
      fulfilledQuantity: 0,
      outstandingQuantity: 20,
      transferAllocatedQuantity: 12,
    });

    await expect(call(harness.logistics, "confirmTransferDispatch", {
      ...draftBase,
      dispatchId: draft.dispatchId,
      idempotencyKey: crypto.randomUUID(),
    })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect((await harness.db.doc(`transferDispatches/${draft.dispatchId}`).get()).get("status")).toBe("cancelled");

    const receiptBase = {
      transferId: prepared.transferId,
      expectedVersion: 1,
      dispatchId: dispatched.dispatchId,
      deliveryCondition: "good",
      lines: [{
        transferItemId: prepared.transferItemId,
        receivedQuantity: 12,
        damagedQuantity: 0,
        missingQuantity: 0,
        rejectedQuantity: 0,
        serialItemIds: [],
        damagedSerialItemIds: [],
        lotAllocations: [],
      }],
    };
    const receipt = await call<{ receiptId: string }>(harness.receiver, "createTransferReceipt", { ...receiptBase, idempotencyKey: crypto.randomUUID() });
    await call(harness.receiver, "confirmTransferReceipt", { ...receiptBase, receiptId: receipt.receiptId, idempotencyKey: crypto.randomUUID() });
    await call(harness.manager, "closeTransfer", { transferId: prepared.transferId, expectedVersion: 1, idempotencyKey: crypto.randomUUID() });
    const transfer = await harness.db.doc(`transfers/${prepared.transferId}`).get();
    expect(transfer.data()).toMatchObject({ status: "closed", totalReceivedQuantity: 12, cancelledRemainingQuantity: 8, totalOutstandingQuantity: 0 });
    expect((await harness.db.doc(`branchRequests/${requestId}`).get()).data()).toMatchObject({ totalFulfilledQuantity: 12, totalOutstandingQuantity: 8 });
    expect((await harness.db.doc(`branchRequestItems/${requestItemId}`).get()).data()).toMatchObject({ fulfilledQuantity: 12, outstandingQuantity: 8, transferAllocatedQuantity: 0 });

    const nextTransferInput = {
      sourceRequestId: requestId,
      sourceRequestVersion: 1,
      sourceApprovalId: approvalId,
      originWarehouseId: "remainder-warehouse",
      originLocationId: harness.originLocationId,
      destinationBranchId: "remainder-branch",
      destinationLocationId: harness.destinationLocationId,
      purpose: "Fulfil the approved request demand left after Transfer A cancellation",
      priority: "normal",
      items: [{ productId: harness.productId, quantity: 8, sourceRequestItemId: requestItemId }],
      idempotencyKey: crypto.randomUUID(),
    };
    await expect(call(harness.creator, "createTransferFromRequest", {
      ...nextTransferInput,
      items: [{ productId: harness.productId, quantity: 9, sourceRequestItemId: requestItemId }],
      idempotencyKey: crypto.randomUUID(),
    })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    const nextTransfer = await call<{ transferId: string }>(harness.creator, "createTransferFromRequest", nextTransferInput);
    expect((await harness.db.doc(`transfers/${nextTransfer.transferId}`).get()).data()).toMatchObject({
      sourceRequestId: requestId,
      totalPlannedQuantity: 8,
      totalOutstandingQuantity: 8,
    });
    expect((await harness.db.doc(`branchRequestItems/${requestItemId}`).get()).data()).toMatchObject({
      approvedQuantity: 20,
      fulfilledQuantity: 12,
      outstandingQuantity: 8,
      transferAllocatedQuantity: 8,
    });
    expect((await harness.db.collection("auditLogs").where("entityId", "==", prepared.transferId).where("action", "==", "transfer.cancelled").get()).size).toBe(1);
  }, 90_000);
});
