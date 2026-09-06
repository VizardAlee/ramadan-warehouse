import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { balanceDocumentId } from "../functions/src/inventory/calculations";
import {
  pendingStock,
  type StockTransfer,
} from "../functions/src/transfers/simple-model";
import {
  call,
  setupTransferHarness,
  type TestActor,
  type TransferHarness,
} from "./helpers/transfer-workflow";

let h: TransferHarness;
const key = () => crypto.randomUUID();
const api = <T = { transferId: string; repeated: boolean }>(
  actor: TestActor,
  input: object,
) => call<T>(actor, "stockTransfers", JSON.parse(JSON.stringify(input)));
const read = async (id: string) =>
  (await h.db.doc(`stockTransfers/${id}`).get()).data() as StockTransfer;
const balance = async (
  locationId: string,
  productId = h.productId,
  lotId?: string,
) =>
  (
    await h.db
      .doc(
        `inventoryBalances/${balanceDocumentId(h.organizationId, productId, locationId, lotId)}`,
      )
      .get()
  ).data();
async function create(quantity: number, extra: object = {}, actor?: TestActor) {
  return (
    await api(actor ?? h.receiver, {
      action: "create",
      sourceLocationId: h.originLocationId,
      destinationLocationId: h.destinationLocationId,
      items: [{ productId: h.productId, quantity }],
      idempotencyKey: key(),
      ...extra,
    })
  ).transferId;
}
async function approve(id: string, extra: object = {}) {
  const t = await read(id);
  return api(h.creator, {
    action: "approve",
    transferId: id,
    version: t.version,
    lines: t.items.map((i) => ({
      id: i.id,
      quantity: i.requested,
      serialItemIds: [],
    })),
    idempotencyKey: key(),
    ...extra,
  });
}
async function receive(
  id: string,
  quantity?: number,
  damaged = 0,
  actor?: TestActor,
  extra: object = {},
) {
  const t = await read(id);
  return api(actor ?? h.receiver, {
    action: "receive",
    transferId: id,
    version: t.version,
    lines: t.items.map((i) => ({
      id: i.id,
      received: quantity ?? pendingStock(i),
      damaged,
      serialItemIds: i.serialItemIds,
      damagedSerialItemIds: [],
    })),
    idempotencyKey: key(),
    ...extra,
  });
}
async function resolve(id: string, disposition: string) {
  const t = await read(id);
  return api(h.creator, {
    action: "resolve",
    transferId: id,
    version: t.version,
    disposition,
    note: "Verified by the administrator in emulator test",
    idempotencyKey: key(),
  });
}

beforeAll(async () => {
  if (
    !process.env.FIRESTORE_EMULATOR_HOST ||
    !process.env.FIREBASE_AUTH_EMULATOR_HOST
  )
    throw new Error("These tests require isolated Firebase emulators.");
  h = await setupTransferHarness({ suffix: "simple", openingQuantity: 500 });
}, 60_000);
afterAll(async () => h?.cleanup());

describe.sequential("simple manager stock transfers", () => {
  it("finishes in three tasks without logistics records or extra staff", async () => {
    const before = await balance(h.originLocationId);
    const id = await create(20, {}, h.creator);
    await approve(id); // An administrator can approve their own request.
    expect(await balance(h.originLocationId)).toMatchObject({
      onHandQuantity: before!.onHandQuantity,
      reservedQuantity: 20,
      availableQuantity: before!.onHandQuantity - 20,
    });
    expect((await read(id)).status).toBe("awaiting_receipt");
    await receive(id);
    expect(await read(id)).toMatchObject({ status: "completed", version: 2 });
    expect(await balance(h.originLocationId)).toMatchObject({
      onHandQuantity: before!.onHandQuantity - 20,
      reservedQuantity: 0,
    });
    expect(await balance(h.destinationLocationId)).toMatchObject({
      onHandQuantity: 20,
      availableQuantity: 20,
      totalValueMinor: 200_000,
    });
    const entries = await h.db
      .collection("inventoryEntries")
      .where("transferId", "==", id)
      .get();
    expect(
      entries.docs.reduce((sum, e) => sum + e.get("quantityDelta"), 0),
    ).toBe(0);
    expect(
      entries.docs.reduce((sum, e) => sum + e.get("valueDeltaMinor"), 0),
    ).toBe(0);
    for (const collection of [
      "transferPackages",
      "transferDispatches",
      "transferPicks",
      "sales",
    ])
      expect((await h.db.collection(collection).get()).empty).toBe(true);
    expect(
      (
        await h.db
          .collection("stockTransferEvents")
          .where("transferId", "==", id)
          .get()
      ).size,
    ).toBe(3);
  });

  it("checks destination authority, approval authority and organization isolation", async () => {
    const id = await create(3);
    const t = await read(id);
    await expect(
      api(h.receiver, {
        action: "approve",
        transferId: id,
        version: 0,
        lines: [{ id: t.items[0]!.id, quantity: 3 }],
        idempotencyKey: key(),
      }),
    ).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(
      api(h.foreign, { action: "get", transferId: id }),
    ).rejects.toMatchObject({ code: "functions/not-found" });
    await expect(
      api(h.unauthorized, { action: "get", transferId: id }),
    ).rejects.toMatchObject({ code: "functions/permission-denied" });
    await approve(id);
    await expect(receive(id, 3, 0, h.manager)).rejects.toMatchObject({
      code: "functions/permission-denied",
    });
    await resolve(id, "never_left");
  });

  it("makes retry idempotency bind to actor and exact payload, including transfer ID", async () => {
    const id = await create(2);
    await approve(id);
    const t = await read(id),
      token = key();
    const input = {
      action: "receive",
      transferId: id,
      version: t.version,
      lines: [{ id: t.items[0]!.id, received: 2, damaged: 0 }],
      idempotencyKey: token,
    };
    const results = await Promise.all([
      api(h.receiver, input),
      api(h.receiver, input),
    ]);
    expect(results.filter((r) => r.repeated)).toHaveLength(1);
    expect(
      (
        await h.db
          .collection("stockTransferReceipts")
          .where("transferId", "==", id)
          .get()
      ).size,
    ).toBe(1);
    await expect(
      api(h.receiver, { ...input, transferId: "different" }),
    ).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await expect(
      api(h.receiver, { ...input, idempotencyKey: key() }),
    ).rejects.toMatchObject({ code: "functions/failed-precondition" });
  });

  it("keeps partial deliveries held, accepts later arrival, and does not fulfil missing stock", async () => {
    const id = await create(20);
    await approve(id);
    await receive(id, 18);
    expect(await read(id)).toMatchObject({
      status: "partially_received",
      items: [expect.objectContaining({ received: 18, approved: 20 })],
    });
    expect((await balance(h.originLocationId))!.reservedQuantity).toBe(2);
    await expect(receive(id, 3)).rejects.toMatchObject({
      code: "functions/failed-precondition",
    });
    await receive(id, 2);
    expect((await read(id)).status).toBe("completed");
    expect((await balance(h.originLocationId))!.reservedQuantity).toBe(0);
  });

  it("quarantines damaged arrivals and requires explicit administrator review", async () => {
    const id = await create(5);
    await approve(id);
    await receive(id, 3, 2);
    expect((await read(id)).status).toBe("problem");
    expect(await balance("simple_damaged_simple-branch")).toMatchObject({
      onHandQuantity: 2,
      totalValueMinor: 20_000,
    });
    await resolve(id, "still_expected");
    expect(await read(id)).toMatchObject({
      status: "completed",
      completedAt: expect.any(String),
    });
  });

  it("preserves approved request demand when remainder is cancelled, then reallocates it", async () => {
    const requestId = "simple-demand",
      sourceRequestItemId = "simple-demand-item";
    await h.db
      .doc(`branchRequests/${requestId}`)
      .set({
        organizationId: h.organizationId,
        branchId: "simple-branch",
        status: "approved",
        totalApprovedQuantity: 20,
        totalFulfilledQuantity: 0,
        totalOutstandingQuantity: 20,
      });
    await h.db
      .doc(`branchRequestItems/${sourceRequestItemId}`)
      .set({
        organizationId: h.organizationId,
        requestId,
        productId: h.productId,
        approvedQuantity: 20,
        fulfilledQuantity: 0,
        outstandingQuantity: 20,
        transferAllocatedQuantity: 0,
      });
    const extra = {
      sourceRequestId: requestId,
      items: [{ productId: h.productId, quantity: 20, sourceRequestItemId }],
    };
    const id = await create(20, extra);
    await approve(id);
    await receive(id, 12);
    await resolve(id, "never_left");
    expect(await read(id)).toMatchObject({
      status: "completed",
      items: [
        expect.objectContaining({ approved: 20, received: 12, cancelled: 8 }),
      ],
    });
    expect((await read(id)).items.map(pendingStock)).toEqual([0]);
    expect(
      (await h.db.doc(`branchRequests/${requestId}`).get()).data(),
    ).toMatchObject({
      totalApprovedQuantity: 20,
      totalFulfilledQuantity: 12,
      totalOutstandingQuantity: 8,
    });
    expect(
      (
        await h.db.doc(`branchRequestItems/${sourceRequestItemId}`).get()
      ).data(),
    ).toMatchObject({
      approvedQuantity: 20,
      fulfilledQuantity: 12,
      outstandingQuantity: 8,
      transferAllocatedQuantity: 0,
    });
    await expect(
      create(9, {
        ...extra,
        items: [{ productId: h.productId, quantity: 9, sourceRequestItemId }],
      }),
    ).rejects.toMatchObject({ code: "functions/failed-precondition" });
    const b = await create(8, {
      ...extra,
      items: [{ productId: h.productId, quantity: 8, sourceRequestItemId }],
    });
    expect(
      (await h.db.doc(`branchRequestItems/${sourceRequestItemId}`).get()).get(
        "transferAllocatedQuantity",
      ),
    ).toBe(8);
    await resolve(b, "never_left");
    expect(
      (await h.db.doc(`branchRequestItems/${sourceRequestItemId}`).get()).get(
        "transferAllocatedQuantity",
      ),
    ).toBe(0);
  });

  it("moves directly from a branch to another branch without warehouse or sales records", async () => {
    await h.db
      .doc("branches/simple-second")
      .set({
        organizationId: h.organizationId,
        name: "Second branch",
        status: "active",
      });
    await h.db
      .doc("inventoryLocations/simple-second-stock")
      .set({
        organizationId: h.organizationId,
        branchId: "simple-second",
        name: "Second stock",
        type: "branch",
        status: "active",
      });
    const id = await create(4, {
      sourceLocationId: h.destinationLocationId,
      destinationLocationId: "simple-second-stock",
    });
    await approve(id);
    await expect(receive(id, 4)).rejects.toMatchObject({
      code: "functions/permission-denied",
    });
    await receive(id, 4, 0, h.creator);
    expect(await read(id)).toMatchObject({
      sourceBranchId: "simple-branch",
      destinationBranchId: "simple-second",
      status: "completed",
    });
    expect((await read(id)).sourceWarehouseId).toBeUndefined();
    expect(await balance("simple-second-stock")).toMatchObject({
      onHandQuantity: 4,
      totalValueMinor: 40_000,
    });
    expect((await h.db.collection("sales").get()).empty).toBe(true);
  });

  it("records confirmed loss without releasing missing goods for sale", async () => {
    const before = await balance(h.originLocationId);
    const id = await create(3);
    await approve(id);
    await resolve(id, "lost");
    expect(await balance(h.originLocationId)).toMatchObject({
      onHandQuantity: before!.onHandQuantity - 3,
      reservedQuantity: 0,
    });
    expect(await read(id)).toMatchObject({
      status: "completed",
      items: [expect.objectContaining({ received: 0, writtenOff: 3 })],
    });
    const entries = await h.db
      .collection("inventoryEntries")
      .where("transferId", "==", id)
      .get();
    expect(
      entries.docs
        .find((e) => e.get("externalAccount") === "inventory_loss")
        ?.get("quantityDelta"),
    ).toBe(3);
    expect(
      entries.docs.reduce((sum, e) => sum + e.get("valueDeltaMinor"), 0),
    ).toBe(0);
  });

  it("prevents oversubscription under concurrent approvals and rolls back invalid multi-line requests", async () => {
    const available = (await balance(h.originLocationId))!.availableQuantity;
    const a = await create(available),
      b = await create(available);
    const results = await Promise.allSettled([approve(a), approve(b)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const id of [a, b]) await resolve(id, "never_left");
    await h.db
      .doc("products/simple-empty")
      .set({
        organizationId: h.organizationId,
        name: "No stock",
        sku: "EMPTY",
        trackingType: "quantity",
        active: true,
      });
    const multi = await create(1, {
      items: [
        { productId: h.productId, quantity: 1 },
        { productId: "simple-empty", quantity: 1 },
      ],
    });
    await expect(approve(multi)).rejects.toMatchObject({
      code: "functions/failed-precondition",
    });
    expect((await balance(h.originLocationId))!.reservedQuantity).toBe(0);
    expect((await read(multi)).status).toBe("requested");
    await resolve(multi, "never_left");
  });

  it("uses actual serialized identities and transfers lot quantities atomically", async () => {
    for (const trackingType of ["serial", "batch"]) {
      const productId = `simple-${trackingType}`;
      await h.db
        .doc(`products/${productId}`)
        .set({
          organizationId: h.organizationId,
          name: trackingType,
          sku: productId,
          trackingType,
          active: true,
          unitOfMeasure: "unit",
          hasLedgerActivity: false,
        });
      await h.db
        .doc(`productCosts/${productId}`)
        .set({
          organizationId: h.organizationId,
          productId,
          defaultUnitCostMinor: 100,
          currency: "NGN",
        });
      await call(h.creator, "postOpeningStock", {
        productId,
        destinationLocationId: h.originLocationId,
        quantity: 2,
        unitCostMinor: 100,
        serialNumbers:
          trackingType === "serial" ? ["SIMPLE-ONE", "SIMPLE-TWO"] : [],
        ...(trackingType === "batch"
          ? { lot: { lotNumber: "SIMPLE-LOT" } }
          : {}),
        effectiveAt: new Date().toISOString(),
        reason: "Isolated tracking verification",
        externalAccount: "migration",
        idempotencyKey: key(),
      });
      const stock = await api<{
        stock: {
          productId: string;
          lotId?: string;
          serials: { id: string }[];
        }[];
      }>(h.creator, { action: "stock", locationId: h.originLocationId });
      const s = stock.stock.find((p) => p.productId === productId)!;
      const id = await create(2, {
        items: [{ productId, quantity: 2, lotId: s.lotId ?? undefined }],
      });
      const t = await read(id);
      if (trackingType === "serial")
        await expect(approve(id)).rejects.toMatchObject({
          code: "functions/failed-precondition",
        });
      await approve(id, {
        lines: [
          {
            id: t.items[0]!.id,
            quantity: 2,
            serialItemIds: s.serials.map((v) => v.id),
          },
        ],
      });
      await receive(id);
      expect(
        await balance(h.destinationLocationId, productId, s.lotId ?? undefined),
      ).toMatchObject({ onHandQuantity: 2, totalValueMinor: 200 });
      if (trackingType === "serial")
        for (const serial of s.serials)
          expect(
            (await h.db.doc(`serializedItems/${serial.id}`).get()).data(),
          ).toMatchObject({
            currentLocationId: h.destinationLocationId,
            status: "at_branch",
          });
      else
        expect(
          (await h.db.doc(`inventoryLots/${s.lotId}`).get()).get(
            "locationQuantities",
          ),
        ).toMatchObject({
          [h.originLocationId]: 0,
          [h.destinationLocationId]: 2,
        });
    }
  }, 30_000);

  it("reconciles new and old request evidence and rejects direct receipt reversal", async () => {
    const snapshots = await h.db.collection("stockTransfers").get();
    for (const doc of snapshots.docs.slice(0, 12)) {
      const result = await call<{ status: string; checks: unknown[] }>(
        h.creator,
        "reconcileTransfer",
        { transferId: doc.id },
      );
      expect(result.status, JSON.stringify(result.checks)).toBe("clean");
    }
    const ops = await call<{
      summary: { requestFulfilmentFailures: number; error: number };
    }>(h.creator, "reconcileWarehouseOperations", {});
    expect(ops.summary).toMatchObject({
      requestFulfilmentFailures: 0,
      error: 0,
    });
    const receipt = (
      await h.db.collection("stockTransferReceipts").limit(1).get()
    ).docs[0]!;
    await expect(
      call(h.creator, "reverseInventoryTransaction", {
        transactionId: receipt.get("transactionId"),
        reason: "Test direct reversal guard",
        effectiveAt: new Date().toISOString(),
        idempotencyKey: key(),
      }),
    ).rejects.toMatchObject({ code: "functions/failed-precondition" });
  });
});
