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
const organizationId = "transfer-test-org";
const adminApp =
  getAdminApps().find((app) => app.name === "transfer-callable-tests") ??
  initializeAdminApp({ projectId }, "transfer-callable-tests");
const adminAuth = getAdminAuth(adminApp);
const adminDb = getFirestore(adminApp);
const apps: FirebaseApp[] = [];
function client(name: string) {
  const app = initializeApp(
    { projectId, apiKey: "demo", appId: `transfers-${name}` },
    `transfers-${name}`,
  );
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const functions = getFunctions(app, "us-central1");
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  return { auth, functions };
}
async function call<T = Record<string, unknown>>(
  target: ReturnType<typeof client>,
  name: string,
  data: Record<string, unknown>,
) {
  return (await httpsCallable(target.functions, name)(data)).data as T;
}
async function actor(
  email: string,
  roleId: string,
  branchIds: string[] = [],
  warehouseIds: string[] = [],
) {
  const user = await adminAuth.createUser({
    email,
    password: "Password!234567",
    displayName: roleId,
  });
  await adminDb
    .doc(`users/${user.uid}`)
    .set({
      uid: user.uid,
      organizationId,
      email,
      displayName: roleId,
      roleId,
      branchIds,
      warehouseIds,
      status: "active",
      authDisabled: false,
      authorizationVersion: 1,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  const result = client(email.replaceAll(/[^a-z]/g, "-"));
  await signInWithEmailAndPassword(result.auth, email, "Password!234567");
  return { ...result, uid: user.uid };
}
const base = () => ({
  originWarehouseId: "warehouse-a",
  originLocationId: "warehouse-location",
  destinationBranchId: "branch-a",
  destinationLocationId: "branch-location",
  purpose: "Controlled Kaduna branch replenishment",
  priority: "normal",
  items: [{ productId: "product-a", quantity: 10 }],
  idempotencyKey: crypto.randomUUID(),
});
let creator: Awaited<ReturnType<typeof actor>>;
let approver: Awaited<ReturnType<typeof actor>>;
let picker: Awaited<ReturnType<typeof actor>>;
let logistics: Awaited<ReturnType<typeof actor>>;
let receiver: Awaited<ReturnType<typeof actor>>;
let branchUser: Awaited<ReturnType<typeof actor>>;
let finance: Awaited<ReturnType<typeof actor>>;
let transferId = "";
let transferItemId = "";
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
    adminDb
      .doc("warehouses/warehouse-a")
      .set({
        organizationId,
        name: "Central Warehouse",
        code: "WH",
        status: "active",
      }),
    adminDb
      .doc("branches/branch-a")
      .set({ organizationId, name: "Kaduna", code: "KD", status: "active" }),
    adminDb
      .doc("branches/branch-b")
      .set({ organizationId, name: "Kano", code: "KN", status: "active" }),
    adminDb
      .doc("inventoryLocations/warehouse-location")
      .set({
        organizationId,
        warehouseId: "warehouse-a",
        name: "Warehouse Available",
        code: "WH-A",
        type: "warehouse",
        status: "active",
        systemManaged: false,
      }),
    adminDb
      .doc("inventoryLocations/branch-location")
      .set({
        organizationId,
        branchId: "branch-a",
        name: "Branch Available",
        code: "BR-A",
        type: "branch",
        status: "active",
        systemManaged: false,
      }),
    adminDb
      .doc("products/product-a")
      .set({
        organizationId,
        name: "580W Panel",
        sku: "PV-580",
        unitOfMeasure: "unit",
        trackingType: "quantity",
        active: true,
        hasLedgerActivity: true,
        updatedAt: now,
      }),
    adminDb
      .doc("productCosts/product-a")
      .set({
        organizationId,
        productId: "product-a",
        defaultUnitCostMinor: 10_000,
        currency: "NGN",
      }),
    adminDb
      .doc(
        `inventoryBalances/${organizationId}__product-a__warehouse-location__base`,
      )
      .set({
        organizationId,
        productId: "product-a",
        sku: "PV-580",
        productName: "580W Panel",
        trackingType: "quantity",
        locationId: "warehouse-location",
        warehouseId: "warehouse-a",
        onHandQuantity: 100,
        reservedQuantity: 0,
        availableQuantity: 100,
        averageUnitCostMinor: 10_000,
        totalValueMinor: 1_000_000,
        currency: "NGN",
        version: 1,
        createdAt: now,
        updatedAt: now,
      }),
    adminDb
      .doc("branchRequests/request-a")
      .set({
        organizationId,
        requestNumber: "REQ-KD-2026-000001",
        branchId: "branch-a",
        status: "approved",
        version: 1,
        totalApprovedQuantity: 12,
        totalFulfilledQuantity: 0,
        totalOutstandingQuantity: 12,
      }),
    adminDb
      .doc("branchRequestItems/request-item-a")
      .set({
        organizationId,
        requestId: "request-a",
        branchId: "branch-a",
        productId: "product-a",
        sku: "PV-580",
        productName: "580W Panel",
        trackingType: "quantity",
        unitOfMeasure: "unit",
        requestedQuantity: 12,
        approvedQuantity: 12,
        fulfilledQuantity: 0,
        outstandingQuantity: 12,
        transferAllocatedQuantity: 0,
      }),
    adminDb
      .doc("branchRequestApprovals/approval-a")
      .set({
        organizationId,
        requestId: "request-a",
        requestVersion: 1,
        decision: "approved",
      }),
  ]);
  creator = await actor(
    "transfer-creator@example.test",
    "operations_administrator",
  );
  approver = await actor(
    "transfer-approver@example.test",
    "warehouse_manager",
    [],
    ["warehouse-a"],
  );
  picker = await actor(
    "transfer-picker@example.test",
    "warehouse_officer",
    [],
    ["warehouse-a"],
  );
  logistics = await actor(
    "transfer-logistics@example.test",
    "logistics_officer",
    [],
    ["warehouse-a"],
  );
  receiver = await actor("transfer-receiver@example.test", "branch_manager", [
    "branch-a",
  ]);
  branchUser = await actor(
    "transfer-requester@example.test",
    "branch_requester",
    ["branch-a"],
  );
  finance = await actor("transfer-finance@example.test", "finance_officer");
});
afterAll(async () => Promise.all(apps.map((app) => deleteApp(app))));

describe.sequential("transfer callables", () => {
  it("enforces direct permission and creates request-linked transfers only within approval", async () => {
    await expect(
      call(branchUser, "createAdminTransfer", {
        ...base(),
        directTransferReason: "Emergency allocation",
      }),
    ).rejects.toMatchObject({ code: "functions/permission-denied" });
    const linked = await call<{ transferId: string }>(
      creator,
      "createTransferFromRequest",
      {
        ...base(),
        items: [
          {
            productId: "product-a",
            quantity: 12,
            sourceRequestItemId: "request-item-a",
          },
        ],
        sourceRequestId: "request-a",
        sourceRequestVersion: 1,
        sourceApprovalId: "approval-a",
      },
    );
    expect(
      (await adminDb.doc(`transfers/${linked.transferId}`).get()).data(),
    ).toMatchObject({
      sourceType: "branch_request",
      destinationBranchId: "branch-a",
    });
    transferId = linked.transferId;
    transferItemId = `${transferId}__product-a`;
    await expect(
      call(creator, "createTransferFromRequest", {
        ...base(),
        items: [
          {
            productId: "product-a",
            quantity: 1,
            sourceRequestItemId: "request-item-a",
          },
        ],
        sourceRequestId: "request-a",
        sourceRequestVersion: 1,
        sourceApprovalId: "approval-a",
      }),
    ).rejects.toMatchObject({ code: "functions/failed-precondition" });
  });
  it("generates unique concurrent transfer numbers", async () => {
    const [first, second] = await Promise.all([
      call<{ transferId: string; transferNumber: string }>(
        creator,
        "createAdminTransfer",
        { ...base(), directTransferReason: "Routine replenishment" },
      ),
      call<{ transferId: string; transferNumber: string }>(
        creator,
        "createAdminTransfer",
        { ...base(), directTransferReason: "Project allocation" },
      ),
    ]);
    expect(first.transferNumber).not.toBe(second.transferNumber);
  });
  it("snapshots submission, prevents self approval, and rejects reservation before approval", async () => {
    await expect(
      call(approver, "reserveTransferStock", {
        transferId,
        expectedVersion: 0,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "functions/failed-precondition" });
    const key = crypto.randomUUID();
    await call(creator, "submitTransfer", {
      transferId,
      expectedVersion: 0,
      idempotencyKey: key,
    });
    await call(creator, "submitTransfer", {
      transferId,
      expectedVersion: 0,
      idempotencyKey: key,
    });
    expect(
      (
        await adminDb
          .collection("transferVersions")
          .where("transferId", "==", transferId)
          .get()
      ).size,
    ).toBe(1);
    await expect(
      call(creator, "approveTransfer", {
        transferId,
        expectedVersion: 1,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "functions/permission-denied" });
    await call(approver, "approveTransfer", {
      transferId,
      expectedVersion: 1,
      idempotencyKey: crypto.randomUUID(),
    });
  });
  it("lets one assigned warehouse operator pick, pack, and dispatch while receipt posts through the ledger", async () => {
    const beforeTransactions = (
      await adminDb.collection("inventoryTransactions").get()
    ).size;
    await call(approver, "reserveTransferStock", {
      transferId,
      expectedVersion: 1,
      idempotencyKey: crypto.randomUUID(),
    });
    const reserved = await adminDb
      .doc(
        `inventoryBalances/${organizationId}__product-a__warehouse-location__base`,
      )
      .get();
    expect(reserved.data()).toMatchObject({
      onHandQuantity: 100,
      reservedQuantity: 12,
      availableQuantity: 88,
    });
    expect((await adminDb.collection("inventoryTransactions").get()).size).toBe(
      beforeTransactions,
    );
    const guidedDetail = await call<{
      reservations: Array<{ transferItemId: string; quantity: number }>;
    }>(picker, "getTransfer", { transferId, limit: 100 });
    expect(guidedDetail.reservations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ transferItemId, quantity: 12 }),
      ]),
    );
    await call(picker, "startTransferPicking", {
      transferId,
      expectedVersion: 1,
      idempotencyKey: crypto.randomUUID(),
    });
    await call<{ pickId: string }>(picker, "recordPickedItems", {
      transferId,
      expectedVersion: 1,
      lines: [{ transferItemId, quantity: 12 }],
      idempotencyKey: crypto.randomUUID(),
    });
    const pkg = await call<{ packageId: string }>(
      picker,
      "createTransferPackage",
      {
        transferId,
        expectedVersion: 1,
        lines: [{ transferItemId, quantity: 12 }],
        idempotencyKey: crypto.randomUUID(),
      },
    );
    await call(picker, "sealTransferPackage", {
      transferId,
      expectedVersion: 1,
      packageId: pkg.packageId,
      idempotencyKey: crypto.randomUUID(),
    });
    const dispatchPayload = {
      transferId,
      expectedVersion: 1,
      packageIds: [pkg.packageId],
      driverName: "Musa Bello",
      idempotencyKey: crypto.randomUUID(),
    };
    const dispatch = await call<{ dispatchId: string }>(
      picker,
      "createTransferDispatch",
      dispatchPayload,
    );
    await call(picker, "confirmTransferDispatch", {
      ...dispatchPayload,
      dispatchId: dispatch.dispatchId,
      idempotencyKey: crypto.randomUUID(),
    });
    const source = await adminDb
      .doc(
        `inventoryBalances/${organizationId}__product-a__warehouse-location__base`,
      )
      .get();
    expect(source.data()).toMatchObject({
      onHandQuantity: 88,
      reservedQuantity: 0,
      availableQuantity: 88,
    });
    const transit = await adminDb
      .doc(
        `inventoryBalances/${organizationId}__product-a__transit__${encodeURIComponent(organizationId)}__branch-a__base`,
      )
      .get();
    expect(transit.get("onHandQuantity")).toBe(12);
    const receiptPayload = {
      transferId,
      expectedVersion: 1,
      dispatchId: dispatch.dispatchId,
      deliveryCondition: "good",
      lines: [
        {
          transferItemId,
          receivedQuantity: 11,
          damagedQuantity: 0,
          missingQuantity: 1,
          rejectedQuantity: 0,
        },
      ],
      idempotencyKey: crypto.randomUUID(),
    };
    const receipt = await call<{ receiptId: string }>(
      receiver,
      "createTransferReceipt",
      receiptPayload,
    );
    await call(receiver, "confirmTransferReceipt", {
      ...receiptPayload,
      receiptId: receipt.receiptId,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(
      (
        await adminDb
          .doc(
            `inventoryBalances/${organizationId}__product-a__branch-location__base`,
          )
          .get()
      ).get("onHandQuantity"),
    ).toBe(11);
    expect(
      (
        await adminDb
          .doc(
            `inventoryBalances/${organizationId}__product-a__transit__${encodeURIComponent(organizationId)}__branch-a__base`,
          )
          .get()
      ).get("onHandQuantity"),
    ).toBe(1);
    expect((await adminDb.doc("branchRequests/request-a").get()).get("status")).toBe(
      "partially_fulfilled",
    );
    const discrepancies = await adminDb
      .collection("transferDiscrepancies")
      .where("transferId", "==", transferId)
      .where("status", "==", "open")
      .get();
    expect(discrepancies.size).toBe(1);
    await call(approver, "resolveTransferDiscrepancy", {
      transferId,
      expectedVersion: 1,
      discrepancyId: discrepancies.docs[0]!.id,
      resolutionType: "delivered_later",
      note: "Missing panel was located and delivered intact",
      idempotencyKey: crypto.randomUUID(),
    });
    expect(
      (
        await adminDb
          .doc(
            `inventoryBalances/${organizationId}__product-a__branch-location__base`,
          )
          .get()
      ).get("onHandQuantity"),
    ).toBe(12);
    expect(
      (
        await adminDb
          .doc(
            `inventoryBalances/${organizationId}__product-a__transit__${encodeURIComponent(organizationId)}__branch-a__base`,
          )
          .get()
      ).get("onHandQuantity"),
    ).toBe(0);
    const cost = await call<{ costId: string }>(
      logistics,
      "createTransferCost",
      {
        transferId,
        category: "transportation",
        description: "Kaduna delivery vehicle",
        estimatedAmountMinor: 50_000,
        vendorName: "Test Haulage Limited",
        idempotencyKey: crypto.randomUUID(),
      },
    );
    await call(logistics, "submitTransferCost", {
      transferId,
      costId: cost.costId,
      idempotencyKey: crypto.randomUUID(),
    });
    await call(finance, "approveTransferCost", {
      transferId,
      costId: cost.costId,
      amountMinor: 48_000,
      reason: "Approved against dispatch documentation",
      idempotencyKey: crypto.randomUUID(),
    });
    await call(logistics, "recordActualTransferCost", {
      transferId,
      costId: cost.costId,
      amountMinor: 49_500,
      reason: "Final carrier invoice",
      idempotencyKey: crypto.randomUUID(),
    });
    await call(finance, "reconcileTransferCosts", {
      transferId,
      costId: cost.costId,
      reason: "Invoice and payment records reconciled",
      idempotencyKey: crypto.randomUUID(),
    });
    expect((await adminDb.doc(`transferCosts/${cost.costId}`).get()).data()).toMatchObject(
      {
        status: "reconciled",
        approvedAmountMinor: 48_000,
        actualAmountMinor: 49_500,
      },
    );
    await call(approver, "closeTransfer", {
      transferId,
      expectedVersion: 1,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(
      (await adminDb.doc(`transfers/${transferId}`).get()).get("status"),
    ).toBe("closed");
    expect((await adminDb.doc("branchRequests/request-a").get()).get("status")).toBe("fulfilled");
  }, 120_000);
});
