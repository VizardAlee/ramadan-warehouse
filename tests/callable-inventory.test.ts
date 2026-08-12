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
const adminApp =
  getAdminApps().find((app) => app.name === "inventory-callable-tests") ??
  initializeAdminApp({ projectId }, "inventory-callable-tests");
const adminAuth = getAdminAuth(adminApp);
const adminDb = getFirestore(adminApp);
const apps: FirebaseApp[] = [];
const organizationId = "inventory-test-org";
let administrator: ReturnType<typeof client>;
let branchActor: ReturnType<typeof client>;
let productId = "";
let openingTransactionId = "";

function client(name: string) {
  const app = initializeApp(
    { projectId, apiKey: "demo", appId: `inventory-${name}` },
    `inventory-${name}`,
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

async function createActor(
  email: string,
  roleId: string,
  actorOrganizationId = organizationId,
) {
  const record = await adminAuth.createUser({
    email,
    password: "Password!234567",
    displayName: roleId,
  });
  await adminDb.doc(`users/${record.uid}`).set({
    uid: record.uid,
    organizationId: actorOrganizationId,
    email,
    displayName: roleId,
    roleId,
    branchIds: roleId === "branch_manager" ? ["branch-a"] : [],
    warehouseIds: ["warehouse-a"],
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

function product(overrides: Record<string, unknown> = {}) {
  return {
    name: "580W Monocrystalline Panel",
    sku: "PANEL-580",
    unitOfMeasure: "unit",
    trackingType: "quantity",
    defaultUnitCostMinor: 10_000,
    active: true,
    idempotencyKey: crypto.randomUUID(),
    ...overrides,
  };
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
    "inventory-admin@example.test",
    "system_administrator",
  );
  const now = FieldValue.serverTimestamp();
  await Promise.all(
    ["location-a", "location-b", "location-c", "location-d"].map((id) =>
      adminDb.doc(`inventoryLocations/${id}`).set({
        organizationId,
        warehouseId: "warehouse-a",
        name: id,
        code: id.toUpperCase(),
        type: "warehouse",
        status: "active",
        systemManaged: false,
        createdAt: now,
        updatedAt: now,
      }),
    ),
  );
});

afterAll(async () => Promise.all(apps.map((app) => deleteApp(app))));

describe.sequential("inventory callables", () => {
  it("enforces case-insensitive organization SKU uniqueness and role authorization", async () => {
    const created = await call<{ productId: string }>(
      administrator,
      "saveProduct",
      product(),
    );
    productId = created.productId;
    await expect(
      call(administrator, "saveProduct", product({ sku: " panel-580 " })),
    ).rejects.toMatchObject({ code: "functions/already-exists" });

    branchActor = await createActor(
      "inventory-branch@example.test",
      "branch_manager",
    );
    await expect(
      call(branchActor, "saveProduct", product({ sku: "UNAUTH-1" })),
    ).rejects.toMatchObject({ code: "functions/permission-denied" });

    const foreign = await createActor(
      "inventory-foreign@example.test",
      "system_administrator",
      "foreign-org",
    );
    await expect(
      call(foreign, "saveProduct", product({ sku: "panel-580" })),
    ).resolves.toMatchObject({ saved: true });
  });

  it("posts opening stock once with balanced immutable entries", async () => {
    const key = crypto.randomUUID();
    const payload = {
      productId,
      destinationLocationId: "location-a",
      quantity: 10,
      unitCostMinor: 10_000,
      serialNumbers: [],
      effectiveAt: "2026-08-01T10:00:00.000Z",
      reason: "Initial verified warehouse balance",
      externalAccount: "migration",
      idempotencyKey: key,
    };
    const first = await call<{
      transactionId: string;
      posted: boolean;
    }>(administrator, "postOpeningStock", payload);
    openingTransactionId = first.transactionId;
    const duplicate = await call<{ posted: boolean }>(
      administrator,
      "postOpeningStock",
      payload,
    );
    expect(first.posted).toBe(true);
    expect(duplicate.posted).toBe(false);
    const entries = await adminDb
      .collection("inventoryEntries")
      .where("transactionId", "==", first.transactionId)
      .get();
    expect(entries.size).toBe(2);
    expect(
      entries.docs.reduce(
        (sum, entry) => sum + Number(entry.get("quantityDelta")),
        0,
      ),
    ).toBe(0);
    expect(
      entries.docs.reduce(
        (sum, entry) => sum + Number(entry.get("valueDeltaMinor")),
        0,
      ),
    ).toBe(0);
    const balances = await adminDb
      .collection("inventoryBalances")
      .where("organizationId", "==", organizationId)
      .where("productId", "==", productId)
      .get();
    expect(balances.docs[0]?.data()).toMatchObject({
      onHandQuantity: 10,
      totalValueMinor: 100_000,
      averageUnitCostMinor: 10_000,
    });
  });

  it("calculates weighted average and prevents tracking migration after posting", async () => {
    await call(administrator, "postInventoryReceipt", {
      productId,
      destinationLocationId: "location-a",
      quantity: 10,
      unitCostMinor: 20_000,
      serialNumbers: [],
      effectiveAt: "2026-08-02T10:00:00.000Z",
      reason: "Authorized supplier receipt",
      externalAccount: "supplier",
      idempotencyKey: crypto.randomUUID(),
    });
    const balance = (
      await adminDb
        .collection("inventoryBalances")
        .where("organizationId", "==", organizationId)
        .where("productId", "==", productId)
        .where("locationId", "==", "location-a")
        .get()
    ).docs[0]!;
    expect(balance.data()).toMatchObject({
      onHandQuantity: 20,
      totalValueMinor: 300_000,
      averageUnitCostMinor: 15_000,
    });
    await expect(
      call(
        administrator,
        "saveProduct",
        product({ id: productId, trackingType: "serial" }),
      ),
    ).rejects.toMatchObject({ code: "functions/failed-precondition" });
  });

  it("moves quantity and value atomically and concurrent depletion cannot overdraw", async () => {
    const move = (destinationLocationId: string, quantity: number) =>
      call(administrator, "moveInventoryBetweenLocations", {
        productId,
        sourceLocationId: "location-a",
        destinationLocationId,
        quantity,
        serialNumbers: [],
        effectiveAt: new Date().toISOString(),
        reason: "Controlled internal warehouse relocation",
        idempotencyKey: crypto.randomUUID(),
      });
    await move("location-b", 5);
    const before = await adminDb
      .collection("inventoryBalances")
      .where("organizationId", "==", organizationId)
      .where("productId", "==", productId)
      .get();
    expect(
      before.docs.reduce((sum, doc) => sum + doc.get("onHandQuantity"), 0),
    ).toBe(20);
    expect(
      before.docs.reduce((sum, doc) => sum + doc.get("totalValueMinor"), 0),
    ).toBe(300_000);

    const attempts = await Promise.allSettled([
      move("location-b", 10),
      move("location-c", 10),
    ]);
    expect(
      attempts.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      attempts.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const after = await adminDb
      .collection("inventoryBalances")
      .where("organizationId", "==", organizationId)
      .where("productId", "==", productId)
      .get();
    expect(after.docs.every((doc) => doc.get("onHandQuantity") >= 0)).toBe(
      true,
    );
    expect(
      after.docs.reduce((sum, doc) => sum + doc.get("onHandQuantity"), 0),
    ).toBe(20);
    expect(
      after.docs.reduce((sum, doc) => sum + doc.get("totalValueMinor"), 0),
    ).toBe(300_000);
    await expect(move("location-c", 6)).rejects.toMatchObject({
      code: "functions/failed-precondition",
    });
  });

  it("enforces serial uniqueness and exact serialized quantities", async () => {
    const serialProduct = await call<{ productId: string }>(
      administrator,
      "saveProduct",
      product({
        name: "6.2kVA Hybrid Inverter",
        sku: "INV-6200",
        trackingType: "serial",
      }),
    );
    const payload = {
      productId: serialProduct.productId,
      destinationLocationId: "location-a",
      quantity: 2,
      unitCostMinor: 500_000,
      effectiveAt: new Date().toISOString(),
      reason: "Serialized opening stock verification",
      externalAccount: "migration",
      idempotencyKey: crypto.randomUUID(),
    };
    await expect(
      call(administrator, "postOpeningStock", {
        ...payload,
        serialNumbers: ["INV-SN-1"],
      }),
    ).rejects.toMatchObject({ code: "functions/invalid-argument" });
    await call(administrator, "postOpeningStock", {
      ...payload,
      serialNumbers: ["INV-SN-1", "INV-SN-2"],
    });
    await expect(
      call(administrator, "postInventoryReceipt", {
        ...payload,
        externalAccount: "supplier",
        serialNumbers: [" inv-sn-1 ", "INV-SN-3"],
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "functions/already-exists" });
  });

  it("keeps cost data sanitized and paginates movement history without duplicates", async () => {
    const sanitized = await call<{
      includeCosts: boolean;
      product: Record<string, unknown>;
      balances: Record<string, unknown>[];
    }>(branchActor, "getProductStockSummary", {
      productId,
      includeCosts: true,
      limit: 20,
    });
    expect(sanitized.includeCosts).toBe(false);
    expect(sanitized.product.defaultUnitCostMinor).toBeUndefined();
    expect(sanitized.balances).toEqual([]);

    const first = await call<{
      rows: { id: string }[];
      nextCursor: string | null;
    }>(administrator, "getSkuMovementHistory", {
      productId,
      limit: 2,
      includeCosts: true,
    });
    expect(first.rows).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    const second = await call<{ rows: { id: string }[] }>(
      administrator,
      "getSkuMovementHistory",
      {
        productId,
        limit: 2,
        includeCosts: true,
        cursor: first.nextCursor,
      },
    );
    expect(second.rows.map((row) => row.id)).not.toContain(first.rows[0]!.id);
    expect(second.rows.map((row) => row.id)).not.toContain(first.rows[1]!.id);
  });

  it("uses blind maker-checker stock counts and posts variance only after review", async () => {
    const countProduct = await call<{ productId: string }>(
      administrator,
      "saveProduct",
      product({ name: "Count Test Breaker", sku: "COUNT-63A" }),
    );
    await call(administrator, "postOpeningStock", {
      productId: countProduct.productId,
      destinationLocationId: "location-d",
      quantity: 5,
      unitCostMinor: 1_000,
      serialNumbers: [],
      effectiveAt: new Date().toISOString(),
      reason: "Count workflow opening balance",
      externalAccount: "migration",
      idempotencyKey: crypto.randomUUID(),
    });
    const officer = await createActor(
      "inventory-counter@example.test",
      "warehouse_officer",
    );
    const reviewer = await createActor(
      "inventory-reviewer@example.test",
      "warehouse_manager",
    );
    const poster = await createActor(
      "inventory-poster@example.test",
      "warehouse_manager",
    );
    const created = await call<{ stockCountId: string }>(
      administrator,
      "createStockCount",
      {
        locationId: "location-d",
        assignedUserIds: [officer.auth.currentUser!.uid],
        blindCount: true,
        countDate: "2026-08-06",
        idempotencyKey: crypto.randomUUID(),
      },
    );
    await call(officer, "startStockCount", {
      stockCountId: created.stockCountId,
      reason: "Begin independent blind physical count",
      idempotencyKey: crypto.randomUUID(),
    });
    const blind = await call<{
      items: { id: string; expectedQuantity?: number }[];
    }>(officer, "getStockCountWorkspace", {
      stockCountId: created.stockCountId,
      reason: "Open blind count workspace",
      idempotencyKey: crypto.randomUUID(),
    });
    expect(blind.items).toHaveLength(1);
    expect(blind.items[0]?.expectedQuantity).toBeUndefined();
    await call(officer, "submitStockCount", {
      stockCountId: created.stockCountId,
      reason: "Submit verified physical count",
      idempotencyKey: crypto.randomUUID(),
      items: [
        {
          itemId: blind.items[0]!.id,
          countedQuantity: 4,
          serialNumbers: [],
        },
      ],
    });
    const balanceQuery = () =>
      adminDb
        .collection("inventoryBalances")
        .where("organizationId", "==", organizationId)
        .where("productId", "==", countProduct.productId)
        .where("locationId", "==", "location-d")
        .limit(1)
        .get();
    expect((await balanceQuery()).docs[0]?.get("onHandQuantity")).toBe(5);
    await expect(
      call(administrator, "reviewStockCount", {
        stockCountId: created.stockCountId,
        reason: "Creator cannot review own count",
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "functions/permission-denied" });
    await call(reviewer, "reviewStockCount", {
      stockCountId: created.stockCountId,
      reason: "Independent variance review completed",
      idempotencyKey: crypto.randomUUID(),
    });
    await call(poster, "postStockCount", {
      stockCountId: created.stockCountId,
      reason: "Independent approved count posting",
      idempotencyKey: crypto.randomUUID(),
    });
    expect((await balanceQuery()).docs[0]?.get("onHandQuantity")).toBe(4);
  });

  it("reverses safely with opposite immutable entries and rejects a second reversal", async () => {
    const original = await adminDb
      .doc(`inventoryTransactions/${openingTransactionId}`)
      .get();
    expect(original.get("status")).toBe("posted");
    await expect(
      call(administrator, "reverseInventoryTransaction", {
        transactionId: openingTransactionId,
        reason: "Attempt unsafe reversal after dependent receipts",
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "functions/failed-precondition" });

    const adjustment = await call<{ transactionId: string }>(
      administrator,
      "postStockAdjustment",
      {
        productId,
        locationId: "location-a",
        direction: "increase",
        adjustmentType: "found_stock",
        quantity: 1,
        unitCostMinor: 15_000,
        serialNumbers: [],
        effectiveAt: new Date().toISOString(),
        reason: "Verified count correction evidence",
        idempotencyKey: crypto.randomUUID(),
      },
    );
    const reversed = await call<{ transactionId: string }>(
      administrator,
      "reverseInventoryTransaction",
      {
        transactionId: adjustment.transactionId,
        reason: "Correction evidence was invalidated",
        idempotencyKey: crypto.randomUUID(),
      },
    );
    const reversalEntries = await adminDb
      .collection("inventoryEntries")
      .where("transactionId", "==", reversed.transactionId)
      .get();
    const adjustmentEntries = await adminDb
      .collection("inventoryEntries")
      .where("transactionId", "==", adjustment.transactionId)
      .get();
    expect(reversalEntries.size).toBe(adjustmentEntries.size);
    expect(
      reversalEntries.docs.reduce(
        (sum, doc) => sum + doc.get("quantityDelta"),
        0,
      ),
    ).toBe(0);
    expect(
      (
        await adminDb
          .doc(`inventoryTransactions/${adjustment.transactionId}`)
          .get()
      ).get("status"),
    ).toBe("posted");
    await expect(
      call(administrator, "reverseInventoryTransaction", {
        transactionId: adjustment.transactionId,
        reason: "Second reversal must be rejected",
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "functions/already-exists" });
  });

  it("reconciliation reports a deliberately introduced discrepancy", async () => {
    const healthy = await call<{ discrepancyCount: number }>(
      administrator,
      "reconcileInventoryBalances",
      { productId, limit: 100 },
    );
    expect(healthy.discrepancyCount).toBe(0);
    const balance = (
      await adminDb
        .collection("inventoryBalances")
        .where("organizationId", "==", organizationId)
        .where("productId", "==", productId)
        .limit(1)
        .get()
    ).docs[0]!;
    await balance.ref.update({ onHandQuantity: 999, availableQuantity: 999 });
    const broken = await call<{ discrepancyCount: number }>(
      administrator,
      "reconcileInventoryBalances",
      { productId, limit: 100 },
    );
    expect(broken.discrepancyCount).toBeGreaterThan(0);
  });
});
