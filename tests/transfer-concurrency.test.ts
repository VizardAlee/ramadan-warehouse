import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  signInWithEmailAndPassword,
} from "firebase/auth";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";
import {
  getApps as getAdminApps,
  initializeApp as initializeAdminApp,
} from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const projectId = "demo-ramadan-warehouse";
const organizationId = "transfer-race-org";
const adminApp =
  getAdminApps().find((app) => app.name === "transfer-race-tests") ??
  initializeAdminApp({ projectId }, "transfer-race-tests");
const adminAuth = getAdminAuth(adminApp);
const db = getFirestore(adminApp);
const apps: FirebaseApp[] = [];
function client(name: string) {
  const app = initializeApp(
    { projectId, apiKey: "demo", appId: name },
    `race-${name}`,
  );
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const functions = getFunctions(app, "us-central1");
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  return { auth, functions };
}
async function makeActor(
  email: string,
  roleId: string,
  branchIds: string[],
  warehouseIds: string[],
) {
  const user = await adminAuth.createUser({
    email,
    password: "Password!234567",
  });
  await db
    .doc(`users/${user.uid}`)
    .set({
      organizationId,
      roleId,
      branchIds,
      warehouseIds,
      status: "active",
      authDisabled: false,
      authorizationVersion: 1,
    });
  const result = client(email);
  await signInWithEmailAndPassword(result.auth, email, "Password!234567");
  return result;
}
async function call(
  target: ReturnType<typeof client>,
  name: string,
  data: Record<string, unknown>,
) {
  return (await httpsCallable(target.functions, name)(data)).data;
}
let warehouse: Awaited<ReturnType<typeof makeActor>>;
let branch: Awaited<ReturnType<typeof makeActor>>;
beforeAll(async () => {
  await fetch(
    `http://127.0.0.1:9099/emulator/v1/projects/${projectId}/accounts`,
    { method: "DELETE" },
  );
  await fetch(
    `http://127.0.0.1:8180/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  const now = FieldValue.serverTimestamp();
  await Promise.all([
    db
      .doc("products/product-a")
      .set({
        organizationId,
        sku: "BAT-10",
        name: "Battery",
        trackingType: "quantity",
        unitOfMeasure: "unit",
        active: true,
        hasLedgerActivity: true,
      }),
    db
      .doc("productCosts/product-a")
      .set({ organizationId, defaultUnitCostMinor: 1000 }),
    db
      .doc("inventoryLocations/source")
      .set({
        organizationId,
        warehouseId: "warehouse-a",
        type: "warehouse",
        status: "active",
      }),
    db
      .doc("inventoryLocations/transit")
      .set({
        organizationId,
        branchId: "branch-a",
        type: "goods_in_transit",
        status: "active",
        systemManaged: true,
      }),
    db
      .doc("inventoryLocations/destination")
      .set({
        organizationId,
        branchId: "branch-a",
        type: "branch",
        status: "active",
      }),
    db
      .doc("inventoryLocations/damaged")
      .set({
        organizationId,
        branchId: "branch-a",
        type: "damaged",
        status: "active",
        systemManaged: true,
      }),
    db
      .doc(`${"inventoryBalances"}/${organizationId}__product-a__source__base`)
      .set({
        organizationId,
        productId: "product-a",
        sku: "BAT-10",
        locationId: "source",
        warehouseId: "warehouse-a",
        onHandQuantity: 10,
        reservedQuantity: 0,
        availableQuantity: 10,
        averageUnitCostMinor: 1000,
        totalValueMinor: 10000,
        version: 1,
        createdAt: now,
        updatedAt: now,
      }),
    db
      .doc(`${"inventoryBalances"}/${organizationId}__product-a__transit__base`)
      .set({
        organizationId,
        productId: "product-a",
        sku: "BAT-10",
        locationId: "transit",
        branchId: "branch-a",
        onHandQuantity: 5,
        reservedQuantity: 0,
        availableQuantity: 5,
        averageUnitCostMinor: 1000,
        totalValueMinor: 5000,
        version: 1,
        createdAt: now,
        updatedAt: now,
      }),
  ]);
  for (const id of ["one", "two"]) {
    await db
      .doc(`transfers/${id}`)
      .set({
        organizationId,
        transferNumber: `TRF-${id}`,
        originWarehouseId: "warehouse-a",
        originLocationId: "source",
        destinationBranchId: "branch-a",
        destinationLocationId: "destination",
        transitLocationId: "transit",
        damagedLocationId: "damaged",
        sourceType: "admin_allocation",
        status: "approved",
        version: 1,
        totalApprovedQuantity: 8,
        totalReservedQuantity: 0,
      });
    await db
      .doc(`transferItems/${id}__product-a`)
      .set({
        organizationId,
        transferId: id,
        productId: "product-a",
        sku: "BAT-10",
        trackingType: "quantity",
        approvedQuantity: 8,
        reservedQuantity: 0,
        pickedQuantity: 0,
        packedQuantity: 0,
        dispatchedQuantity: 0,
        receivedQuantity: 0,
      });
  }
  await db
    .doc("transfers/receipt-transfer")
    .set({
      organizationId,
      transferNumber: "TRF-RCV",
      originWarehouseId: "warehouse-a",
      originLocationId: "source",
      destinationBranchId: "branch-a",
      destinationLocationId: "destination",
      transitLocationId: "transit",
      damagedLocationId: "damaged",
      sourceType: "admin_allocation",
      status: "dispatched",
      version: 1,
      totalApprovedQuantity: 5,
      totalReservedQuantity: 0,
      totalPickedQuantity: 5,
      totalPackedQuantity: 5,
      totalDispatchedQuantity: 5,
      totalReceivedQuantity: 0,
      totalDamagedQuantity: 0,
      totalMissingQuantity: 0,
      totalOutstandingQuantity: 5,
    });
  await db
    .doc("transferItems/receipt-item")
    .set({
      organizationId,
      transferId: "receipt-transfer",
      productId: "product-a",
      sku: "BAT-10",
      trackingType: "quantity",
      approvedQuantity: 5,
      reservedQuantity: 5,
      pickedQuantity: 5,
      packedQuantity: 5,
      dispatchedQuantity: 5,
      receivedQuantity: 0,
      damagedQuantity: 0,
      missingQuantity: 0,
      outstandingQuantity: 5,
    });
  await db
    .doc("transferDispatches/dispatch-a")
    .set({
      organizationId,
      transferId: "receipt-transfer",
      dispatchNumber: "DSP-A",
      quantity: 5,
      dispatchedBy: "warehouse-user",
      status: "in_transit",
    });
  await Promise.all([
    db.doc("transferPicks/receipt-pick").set({
      organizationId,
      transferId: "receipt-transfer",
      transferItemId: "receipt-item",
      quantity: 5,
    }),
    db.doc("transferPackageItems/receipt-package-item").set({
      organizationId,
      transferId: "receipt-transfer",
      transferItemId: "receipt-item",
      quantity: 5,
    }),
    db.doc("transferDispatchItems/receipt-dispatch-item").set({
      organizationId,
      transferId: "receipt-transfer",
      dispatchId: "dispatch-a",
      transferItemId: "receipt-item",
      quantity: 5,
    }),
    db.doc("inventoryEntries/receipt-transit-entry").set({
      organizationId,
      transferId: "receipt-transfer",
      productId: "product-a",
      locationId: "transit",
      quantityDelta: 5,
    }),
  ]);
  for (const id of ["receipt-a", "receipt-b"])
    await db
      .doc(`transferReceipts/${id}`)
      .set({
        organizationId,
        transferId: "receipt-transfer",
        dispatchId: "dispatch-a",
        receiptNumber: id,
        status: "draft",
        receivedBy: id,
      });
  warehouse = await makeActor(
    "race-warehouse@example.test",
    "warehouse_manager",
    [],
    ["warehouse-a"],
  );
  branch = await makeActor(
    "race-branch@example.test",
    "branch_manager",
    ["branch-a"],
    [],
  );
});
afterAll(async () => Promise.all(apps.map((app) => deleteApp(app))));

describe.sequential("transfer concurrency", () => {
  it("allows only one competing reservation when stock cannot cover both", async () => {
    const results = await Promise.allSettled(
      ["one", "two"].map((transferId) =>
        call(warehouse, "reserveTransferStock", {
          transferId,
          expectedVersion: 1,
          idempotencyKey: crypto.randomUUID(),
        }),
      ),
    );
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter((item) => item.status === "rejected")).toHaveLength(
      1,
    );
    const balance = await db
      .doc(`inventoryBalances/${organizationId}__product-a__source__base`)
      .get();
    expect(balance.get("reservedQuantity")).toBe(8);
    expect(balance.get("onHandQuantity")).toBe(10);
  });
  it("allows only one simultaneous receipt that would over-receive a dispatch", async () => {
    const line = {
      transferItemId: "receipt-item",
      receivedQuantity: 4,
      damagedQuantity: 0,
      missingQuantity: 0,
      rejectedQuantity: 0,
    };
    const results = await Promise.allSettled(
      ["receipt-a", "receipt-b"].map((receiptId) =>
        call(branch, "confirmTransferReceipt", {
          transferId: "receipt-transfer",
          expectedVersion: 1,
          dispatchId: "dispatch-a",
          receiptId,
          deliveryCondition: "good",
          lines: [line],
          idempotencyKey: crypto.randomUUID(),
        }),
      ),
    );
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter((item) => item.status === "rejected")).toHaveLength(
      1,
    );
    expect(
      (
        await db
          .doc(`inventoryBalances/${organizationId}__product-a__transit__base`)
          .get()
      ).get("onHandQuantity"),
    ).toBe(1);
  });
});
