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
import { balanceDocumentId } from "../functions/src/inventory/calculations";

const projectId = "demo-ramadan-warehouse";
const adminApp =
  getAdminApps().find((app) => app.name === "sales-callable-tests") ??
  initializeAdminApp({ projectId }, "sales-callable-tests");
const adminAuth = getAdminAuth(adminApp);
const adminDb = getFirestore(adminApp);
const apps: FirebaseApp[] = [];
const organizationId = "sales-test-org";
const branchId = "branch-sales";
const locationId = "branch-sales-location";
const productId = "product-sales";
let administrator: ReturnType<typeof client>;
let branchManager: ReturnType<typeof client>;

function client(name: string) {
  const app = initializeApp(
    { projectId, apiKey: "demo", appId: `sales-${name}` },
    `sales-${name}`,
  );
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", {
    disableWarnings: true,
  });
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

async function createActor(email: string, roleId: string) {
  const record = await adminAuth.createUser({
    email,
    password: "Password!234567",
    displayName: roleId,
  });
  await adminDb.doc(`users/${record.uid}`).set({
    uid: record.uid,
    organizationId,
    email,
    displayName: roleId,
    roleId,
    branchIds: roleId === "branch_manager" ? [branchId] : [],
    warehouseIds: roleId === "warehouse_manager" ? ["warehouse-sales"] : [],
    status: "active",
    authDisabled: false,
    authorizationVersion: 1,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  const result = client(email.replaceAll(/[^a-z]/g, "-"));
  await signInWithEmailAndPassword(result.auth, email, "Password!234567");
  return result;
}

beforeAll(async () => {
  await fetch(
    `http://127.0.0.1:9099/emulator/v1/projects/${projectId}/accounts`,
    { method: "DELETE" },
  );
  await fetch(
    `http://127.0.0.1:8180/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  administrator = await createActor(
    "sales-admin@example.test",
    "system_administrator",
  );
  branchManager = await createActor(
    "sales-manager@example.test",
    "branch_manager",
  );
  const now = FieldValue.serverTimestamp();
  await Promise.all([
    adminDb.doc(`branches/${branchId}`).set({
      organizationId,
      name: "Igbo Road Branch",
      code: "IRB",
      status: "active",
      createdAt: now,
      updatedAt: now,
    }),
    adminDb.doc(`inventoryLocations/${locationId}`).set({
      organizationId,
      branchId,
      name: "Igbo Road Branch Stock",
      code: "IRB-STOCK",
      type: "branch",
      status: "active",
      systemManaged: false,
      createdAt: now,
      updatedAt: now,
    }),
    adminDb.doc(`products/${productId}`).set({
      organizationId,
      name: "620W Solar Panel",
      sku: "PANEL-620",
      unitOfMeasure: "unit",
      trackingType: "quantity",
      active: true,
      hasLedgerActivity: true,
      createdAt: now,
      updatedAt: now,
    }),
    adminDb
      .doc(
        `inventoryBalances/${balanceDocumentId(
          organizationId,
          productId,
          locationId,
        )}`,
      )
      .set({
        organizationId,
        branchId,
        locationId,
        productId,
        onHandQuantity: 10,
        reservedQuantity: 0,
        availableQuantity: 10,
        averageUnitCostMinor: 5_000,
        totalValueMinor: 50_000,
        currency: "NGN",
        version: 1,
        createdAt: now,
        updatedAt: now,
      }),
  ]);
});

afterAll(async () => Promise.all(apps.map((app) => deleteApp(app))));

describe.sequential("sales callables", () => {
  it("sets a central price and only permits authorized below-base pricing", async () => {
    await expect(
      call(administrator, "saveProductSalesPrice", {
        productId,
        basePriceMinor: 10_000,
        vatRateBasisPoints: 750,
        active: true,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).resolves.toMatchObject({ productId, saved: true });

    await expect(
      call(branchManager, "saveBranchSalesPrice", {
        branchId,
        productId,
        sellingPriceMinor: 9_000,
        active: true,
        idempotencyKey: crypto.randomUUID(),
        operatingContext: { type: "branch", id: branchId },
      }),
    ).rejects.toMatchObject({ code: "functions/permission-denied" });

    await expect(
      call(branchManager, "saveBranchSalesPrice", {
        branchId,
        productId,
        sellingPriceMinor: 11_000,
        active: true,
        idempotencyKey: crypto.randomUUID(),
        operatingContext: { type: "branch", id: branchId },
      }),
    ).resolves.toMatchObject({ saved: true });
  });

  it("posts a paid sale, inventory issue, VAT, receipt, and balanced journal once", async () => {
    const deviceId = crypto.randomUUID();
    const opened = await call<{ shiftId: string; opened: boolean }>(
      branchManager,
      "openPosShift",
      {
        branchId,
        deviceId,
        deviceName: "Test till",
        openingCashMinor: 20_000,
        idempotencyKey: crypto.randomUUID(),
        operatingContext: { type: "branch", id: branchId },
      },
    );
    expect(opened.opened).toBe(true);

    const idempotencyKey = crypto.randomUUID();
    const payload = {
      branchId,
      shiftId: opened.shiftId,
      deviceId,
      recordedAt: new Date().toISOString(),
      offline: false,
      lines: [{ productId, quantity: 2 }],
      payments: [{ method: "cash", amountMinor: 23_650 }],
      idempotencyKey,
      operatingContext: { type: "branch", id: branchId },
    };
    const posted = await call<{
      saleId: string;
      saleNumber: string;
      receiptNumber: string;
      posted: boolean;
    }>(branchManager, "commitPosSale", payload);
    expect(posted.posted).toBe(true);
    expect(posted.saleNumber).toMatch(/^SAL-IRB-/);

    const retry = await call<typeof posted>(branchManager, "commitPosSale", payload);
    expect(retry).toMatchObject({ saleId: posted.saleId, posted: false });

    const [sale, balance, receipt, journalQuery, inventoryQuery] =
      await Promise.all([
        adminDb.doc(`sales/${posted.saleId}`).get(),
        adminDb
          .doc(
            `inventoryBalances/${balanceDocumentId(
              organizationId,
              productId,
              locationId,
            )}`,
          )
          .get(),
        adminDb
          .collection("salesReceipts")
          .where("saleId", "==", posted.saleId)
          .get(),
        adminDb
          .collection("journalEntries")
          .where("referenceId", "==", posted.saleId)
          .get(),
        adminDb
          .collection("inventoryTransactions")
          .where("referenceId", "==", posted.saleId)
          .get(),
      ]);
    expect(sale.data()).toMatchObject({
      netAmountMinor: 22_000,
      vatAmountMinor: 1_650,
      grossAmountMinor: 23_650,
      costAmountMinor: 10_000,
      status: "completed",
    });
    expect(balance.data()).toMatchObject({
      onHandQuantity: 8,
      availableQuantity: 8,
      totalValueMinor: 40_000,
    });
    expect(receipt.size).toBe(1);
    expect(inventoryQuery.size).toBe(1);
    expect(inventoryQuery.docs[0]!.get("transactionType")).toBe("branch_sale");
    expect(journalQuery.size).toBe(1);
    expect(journalQuery.docs[0]!.get("totalDebitMinor")).toBe(
      journalQuery.docs[0]!.get("totalCreditMinor"),
    );
  });

  it("rejects stale offline prices, then posts an exact cached snapshot once", async () => {
    await call(administrator, "saveProductSalesPrice", {
      productId,
      basePriceMinor: 12_000,
      vatRateBasisPoints: 750,
      active: true,
      idempotencyKey: crypto.randomUUID(),
    });
    const workspace = await call<{
      products: Array<{
        id: string;
        unitPriceMinor: number;
        priceSource: string;
      }>;
    }>(administrator, "getPosWorkspace", { branchId });
    expect(workspace.products.find((product) => product.id === productId)).toMatchObject({
      unitPriceMinor: 12_000,
      priceSource: "central",
    });
    const shift = await adminDb
      .collection("posShifts")
      .where("branchId", "==", branchId)
      .where("status", "==", "open")
      .limit(1)
      .get();
    const current = shift.docs[0]!;
    const before = await adminDb
      .doc(
        `inventoryBalances/${balanceDocumentId(
          organizationId,
          productId,
          locationId,
        )}`,
      )
      .get();
    await expect(
      call(branchManager, "commitPosSale", {
        branchId,
        shiftId: current.id,
        deviceId: current.get("deviceId"),
        recordedAt: new Date().toISOString(),
        offline: true,
        provisionalReceiptReference: "OFF-IRB-STALE-0001",
        lines: [
          {
            productId,
            quantity: 1,
            unitPriceMinor: 10_000,
            vatRateBasisPoints: 750,
            priceVersion: 1,
          },
        ],
        payments: [{ method: "cash", amountMinor: 10_750 }],
        idempotencyKey: crypto.randomUUID(),
        operatingContext: { type: "branch", id: branchId },
      }),
    ).rejects.toMatchObject({ code: "functions/failed-precondition" });
    const after = await before.ref.get();
    expect(after.get("onHandQuantity")).toBe(before.get("onHandQuantity"));

    const offlineIdempotencyKey = crypto.randomUUID();
    const offline = await call<{ saleId: string; posted: boolean }>(
      branchManager,
      "commitPosSale",
      {
        branchId,
        shiftId: current.id,
        deviceId: current.get("deviceId"),
        recordedAt: new Date().toISOString(),
        offline: true,
        provisionalReceiptReference: "OFF-IRB-VALID-0001",
        lines: [
          {
            productId,
            quantity: 1,
            unitPriceMinor: 12_000,
            vatRateBasisPoints: 750,
            priceVersion: 2,
          },
        ],
        payments: [
          {
            method: "card",
            amountMinor: 12_900,
            reference: "TERMINAL-123",
          },
        ],
        idempotencyKey: offlineIdempotencyKey,
        operatingContext: { type: "branch", id: branchId },
      },
    );
    expect(offline.posted).toBe(true);
    const offlineSale = await adminDb.doc(`sales/${offline.saleId}`).get();
    expect(offlineSale.data()).toMatchObject({
      source: "offline_sync",
      paymentStatus: "awaiting_verification",
      provisionalReceiptReference: "OFF-IRB-VALID-0001",
      netAmountMinor: 12_000,
      vatAmountMinor: 900,
      grossAmountMinor: 12_900,
    });
    const finalBalance = await before.ref.get();
    expect(finalBalance.get("onHandQuantity")).toBe(7);
  });
});
