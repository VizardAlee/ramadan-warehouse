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
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { balanceDocumentId, uniquenessDocumentId } from "../functions/src/inventory/calculations";
import { deliverInAppNotification, type InboxEvent } from "../functions/src/notifications/in-app";
import { queueDebtReminders } from "../functions/src/notifications/debt-reminders";
import { queueCollectionReminders } from "../functions/src/notifications/collection-reminders";

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
const bankAccountId = "sales-bank-account";
let administrator: ReturnType<typeof client>;
let branchManager: ReturnType<typeof client>;
let cashier: ReturnType<typeof client>;
let cashierTwo: ReturnType<typeof client>;

function client(name: string) {
  const app = initializeApp(
    { projectId, apiKey: "demo", appId: `sales-${name}` },
    `sales-${name}`,
  );
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099"}`, {
    disableWarnings: true,
  });
  const functions = getFunctions(app, "us-central1");
  connectFunctionsEmulator(functions, "127.0.0.1", Number(process.env.TEST_FUNCTIONS_PORT ?? 5001));
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
    branchIds: ["branch_manager", "sales_cashier"].includes(roleId)
      ? [branchId]
      : [],
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

async function inspectReturnedGoods(target: ReturnType<typeof client>, returnId: string) {
  const items = await adminDb.collection("saleReturnItems").where("returnId", "==", returnId).get();
  return call(target, "approveSaleReturn", { action: "inspect", returnId, inspection: { notes: "Physically inspected by authorized return staff", lines: items.docs.map(item => ({ returnItemId: item.id, disposition: item.get("requestedCondition") === "restockable" ? "resellable" : "damaged" })) }, idempotencyKey: crypto.randomUUID() });
}

beforeAll(async () => {
  await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099"}/emulator/v1/projects/${projectId}/accounts`,
    { method: "DELETE" },
  );
  await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8180"}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
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
  cashier = await createActor("sales-cashier@example.test", "sales_cashier");
  cashierTwo = await createActor(
    "sales-cashier-two@example.test",
    "sales_cashier",
  );
  const now = FieldValue.serverTimestamp();
  await Promise.all([
    adminDb.doc(`bankAccounts/${bankAccountId}`).set({
      organizationId,
      bankName: "Test Bank",
      accountName: "Sales Collections",
      accountNumberLast4: "1234",
      ledgerAccountCode: "1040",
      active: true,
      createdAt: now,
      updatedAt: now,
    }),
    adminDb.doc(`organizations/${organizationId}`).set({
      legalName: "AB Ramadan Ltd.",
      tradingName: "ABR",
      registrationNumber: "RC-TEST-001",
      address: "Kano, Nigeria",
      contactEmail: "accounts@example.test",
      phoneNumbers: ["07012345678"],
      status: "active",
      createdAt: now,
      updatedAt: now,
    }),
    adminDb.doc(`branches/${branchId}`).set({
      organizationId,
      name: "Igbo Road Branch",
      code: "IRB",
      address: "Igbo Road",
      state: "Kano",
      contactPhone: "07012345678",
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
  it("owns serialized units across reservation, partial collection, cancellation and inspected returns", async () => {
    const serialProduct = "serialized-sales-product";
    const balance = adminDb.doc(`inventoryBalances/${balanceDocumentId(organizationId, serialProduct, locationId)}`);
    const serialRef = (serial: string) => adminDb.doc(`serializedItems/${uniquenessDocumentId(organizationId, serial)}`);
    await adminDb.doc(`products/${serialProduct}`).set({ organizationId, name: "Serialized inverter", sku: "SERIAL-POS", unitOfMeasure: "unit", trackingType: "serial", active: true, hasLedgerActivity: true });
    await balance.set({ organizationId, branchId, locationId, productId: serialProduct, onHandQuantity: 3, reservedQuantity: 0, availableQuantity: 3, totalValueMinor: 6, averageUnitCostMinor: 2, version: 1 });
    for (const [index, serial] of ["SN-A", "SN-B", "SN-C"].entries()) await serialRef(serial).set({ organizationId, productId: serialProduct, serialNumber: serial, normalizedSerialNumber: serial, currentLocationId: locationId, branchId, status: "at_branch", active: true, currentUnitCostMinor: index + 1 });
    await call(administrator, "saveProductSalesPrice", { productId: serialProduct, basePriceMinor: 1_000, vatRateBasisPoints: 0, active: true, idempotencyKey: crypto.randomUUID() });
    const deviceId = crypto.randomUUID();
    const shift = await call<{ shiftId: string }>(branchManager, "openPosShift", { branchId, deviceId, deviceName: "Serial desk", openingCashMinor: 0, idempotencyKey: crypto.randomUUID() });
    const checkout = { branchId, shiftId: shift.shiftId, deviceId, recordedAt: new Date().toISOString(), offline: false, lines: [{ productId: serialProduct, quantity: 2, serialNumbers: ["sn-a", "SN-B"] }], payments: [{ method: "cash", amountMinor: 2_000 }], idempotencyKey: crypto.randomUUID() };
    const workspace = await call<{ products: Array<{ id: string; trackingType: string }> }>(branchManager, "getPosWorkspace", { branchId });
    expect(workspace.products).toContainEqual(expect.objectContaining({ id: serialProduct, trackingType: "serial" }));
    const order = await call<{ orderId: string }>(branchManager, "createPosSaleOrder", checkout);
    expect((await serialRef("SN-A").get()).get("status")).toBe("at_branch");
    await call(branchManager, "acceptPosSaleOrderPayment", { orderId: order.orderId, shiftId: shift.shiftId, deviceId, idempotencyKey: crypto.randomUUID() });
    const sale = await call<{ saleId: string }>(branchManager, "confirmPosSaleOrder", { orderId: order.orderId, deferCollection: true, idempotencyKey: crypto.randomUUID() });
    const item = (await adminDb.collection("saleItems").where("saleId", "==", sale.saleId).get()).docs[0]!;
    expect((await balance.get()).data()).toMatchObject({ onHandQuantity: 3, reservedQuantity: 2, availableQuantity: 1, totalValueMinor: 6 });
    expect((await serialRef("SN-A").get()).data()).toMatchObject({ status: "reserved", reservedSaleId: sale.saleId, reservedSaleItemId: item.id });
    await expect(call(administrator, "postStockAdjustment", { productId: serialProduct, locationId, direction: "decrease", adjustmentType: "loss", quantity: 1, serialNumbers: ["SN-A"], effectiveAt: new Date().toISOString(), reason: "Reserved serial must not bypass sales", idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    const reservationMovement = (await serialRef("SN-A").get()).get("lastTransactionId");
    await expect(call(administrator, "reverseInventoryTransaction", { transactionId: reservationMovement, reason: "Must use linked financial correction", idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    const collect = { action: "collect", saleId: sale.saleId, lines: [{ saleItemId: item.id, quantity: 1, serialNumbers: ["SN-A"] }], collector: "Serial customer", idempotencyKey: crypto.randomUUID() };
    for (const serialNumbers of [[], ["SN-C"], ["SN-A", "sn-a"]]) await expect(call(branchManager, "confirmPosSaleOrder", { ...collect, lines: [{ saleItemId: item.id, quantity: 1, serialNumbers }] })).rejects.toBeDefined();
    await expect(call(cashier, "confirmPosSaleOrder", collect)).rejects.toMatchObject({ code: "functions/permission-denied" });
    const collection = await call<{ collectionId: string }>(branchManager, "confirmPosSaleOrder", collect);
    expect(await call(branchManager, "confirmPosSaleOrder", collect)).toMatchObject({ recorded: false, collectionId: collection.collectionId });
    await expect(call(branchManager, "confirmPosSaleOrder", { ...collect, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect((await balance.get()).data()).toMatchObject({ onHandQuantity: 2, reservedQuantity: 1, availableQuantity: 1, totalValueMinor: 5 });
    expect((await serialRef("SN-A").get()).data()).toMatchObject({ status: "sold", active: false, currentLocationId: null, saleId: sale.saleId, saleItemId: item.id });
    const collectionRecord = await adminDb.doc(`saleCollections/${collection.collectionId}`).get();
    const journal = await adminDb.doc(`journalEntries/${collectionRecord.get("journalEntryId")}`).get();
    expect(journal.data()).toMatchObject({ totalDebitMinor: 1, totalCreditMinor: 1 });
    const collectionEntries = await adminDb.collection("inventoryEntries").where("transactionId", "==", collectionRecord.get("inventoryTransactionId")).get();
    expect(collectionEntries.docs.map(doc => doc.data())).toContainEqual(expect.objectContaining({ serialNumber: "SN-A", quantityDelta: -1, valueDeltaMinor: -1 }));
    const returnRequest = (serial: string, kind = "goods_return", condition = "restockable") => ({ branchId, saleId: sale.saleId, kind, lines: [{ saleItemId: item.id, quantity: 1, serialNumbers: [serial], condition }], resolution: "exchange_credit", reason: "Serialized customer correction", idempotencyKey: crypto.randomUUID() });
    await expect(call(branchManager, "createSaleReturn", returnRequest("SN-C"))).rejects.toMatchObject({ code: "functions/failed-precondition" });
    const cancelled = await call<{ returnId: string }>(branchManager, "createSaleReturn", returnRequest("SN-B", "reservation_cancellation"));
    await call(branchManager, "approveSaleReturn", { returnId: cancelled.returnId, idempotencyKey: crypto.randomUUID() });
    expect((await balance.get()).data()).toMatchObject({ onHandQuantity: 2, reservedQuantity: 0, availableQuantity: 2, totalValueMinor: 5 });
    expect((await serialRef("SN-B").get()).data()).toMatchObject({ status: "at_branch", active: true, currentLocationId: locationId });
    const returned = await call<{ returnId: string }>(branchManager, "createSaleReturn", returnRequest("SN-A"));
    await expect(call(branchManager, "approveSaleReturn", { returnId: returned.returnId, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await inspectReturnedGoods(branchManager, returned.returnId);
    await call(branchManager, "approveSaleReturn", { returnId: returned.returnId, idempotencyKey: crypto.randomUUID() });
    expect((await balance.get()).data()).toMatchObject({ onHandQuantity: 3, reservedQuantity: 0, availableQuantity: 3, totalValueMinor: 6 });
    expect((await serialRef("SN-A").get()).data()).toMatchObject({ status: "at_branch", active: true, currentLocationId: locationId });
    await expect(call(branchManager, "createSaleReturn", returnRequest("SN-A"))).rejects.toMatchObject({ code: "functions/failed-precondition" });
    const immediate = { ...checkout, lines: [{ productId: serialProduct, quantity: 1, serialNumbers: ["SN-C"] }], payments: [{ method: "cash", amountMinor: 1_000 }], idempotencyKey: crypto.randomUUID() };
    await expect(call(branchManager, "commitPosSale", { ...immediate, offline: true, provisionalReceiptReference: "OFF-SERIAL-DENIED" })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    const immediateSale = await call<{ saleId: string }>(branchManager, "commitPosSale", immediate);
    expect(await call(branchManager, "commitPosSale", immediate)).toMatchObject({ posted: false });
    await expect(call(branchManager, "commitPosSale", { ...immediate, lines: [{ productId: serialProduct, quantity: 1, serialNumbers: ["SN-A"] }] })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    const immediateItem = (await adminDb.collection("saleItems").where("saleId", "==", immediateSale.saleId).get()).docs[0]!;
    const heldReturn = await call<{ returnId: string }>(branchManager, "createSaleReturn", { ...returnRequest("SN-C", "goods_return", "non_restockable"), saleId: immediateSale.saleId, lines: [{ saleItemId: immediateItem.id, quantity: 1, serialNumbers: ["SN-C"], condition: "non_restockable" }] });
    await inspectReturnedGoods(branchManager, heldReturn.returnId);
    await call(branchManager, "approveSaleReturn", { returnId: heldReturn.returnId, idempotencyKey: crypto.randomUUID() });
    expect((await serialRef("SN-C").get()).data()).toMatchObject({ status: "returned_held", active: false, lastSaleReturnId: heldReturn.returnId });
    expect((await balance.get()).data()).toMatchObject({ onHandQuantity: 2, reservedQuantity: 0, availableQuantity: 2, totalValueMinor: 3 });
    expect(await call(branchManager, "getSaleDocument", { saleId: sale.saleId })).toMatchObject({ items: [expect.objectContaining({ serialNumbers: ["SN-A", "SN-B"], collectedSerialNumbers: ["SN-A"], cancelledSerialNumbers: ["SN-B"] })], collections: [expect.objectContaining({ lines: [expect.objectContaining({ serialNumbers: ["SN-A"] })] })] });
  }, 300_000);
  it.skipIf(!process.env.FIREBASE_STORAGE_EMULATOR_HOST)("uploads private collection photos and links them exactly once with stock release", async () => {
    const saleId = "photo-sale", saleItemId = "photo-item", photoProduct = "photo-product";
    const balanceRef = adminDb.doc(`inventoryBalances/${balanceDocumentId(organizationId, photoProduct, locationId)}`);
    await Promise.all([
      adminDb.doc(`sales/${saleId}`).set({ organizationId, branchId, locationId, saleNumber: "PHOTO-SAL-1", status: "completed", collectionTracked: true, collectionStatus: "awaiting_collection", totalQuantity: 2, collectedQuantity: 0, costAmountMinor: 0 }),
      adminDb.doc(`saleItems/${saleItemId}`).set({ organizationId, saleId, productId: photoProduct, productName: "Photo Panel", sku: "PHOTO", trackingType: "quantity", quantity: 2, collectedQuantity: 0, costAmountMinor: 0 }),
      balanceRef.set({ organizationId, branchId, productId: photoProduct, locationId, onHandQuantity: 2, reservedQuantity: 2, availableQuantity: 0, totalValueMinor: 200, averageUnitCostMinor: 100 }),
    ]);
    const upload = { action: "upload_collection_photo", saleId, saleItemId, contentType: "image/png", base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jDqkAAAAASUVORK5CYII=", idempotencyKey: crypto.randomUUID() };
    await expect(call(cashier, "confirmPosSaleOrder", upload)).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(call(branchManager, "confirmPosSaleOrder", { ...upload, contentType: "image/jpeg" })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    const photo = await call<{ evidenceId: string }>(branchManager, "confirmPosSaleOrder", upload);
    await expect(call(branchManager, "confirmPosSaleOrder", upload)).resolves.toMatchObject({ evidenceId: photo.evidenceId, uploaded: false });
    await expect(call(branchManager, "confirmPosSaleOrder", { ...upload, saleItemId: "wrong-item" })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    expect((await balanceRef.get()).get("onHandQuantity")).toBe(2);
    const read = { action: "collection_photo", saleId, evidenceId: photo.evidenceId };
    await expect(call(branchManager, "getSaleDocument", read)).rejects.toMatchObject({ code: "functions/not-found" });
    const collect = { action: "collect", saleId, lines: [{ saleItemId, quantity: 1 }], collector: "Amina Musa", evidenceIds: [photo.evidenceId], idempotencyKey: crypto.randomUUID() };
    await expect(call(administrator, "confirmPosSaleOrder", collect)).rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect((await balanceRef.get()).get("onHandQuantity")).toBe(2);
    const posted = await call<{ collectionId: string }>(branchManager, "confirmPosSaleOrder", collect);
    await expect(call(branchManager, "confirmPosSaleOrder", collect)).resolves.toMatchObject({ recorded: false, collectionId: posted.collectionId });
    expect((await balanceRef.get()).get("onHandQuantity")).toBe(1);
    expect((await adminDb.doc(`saleCollections/${posted.collectionId}`).get()).get("evidenceIds")).toEqual([photo.evidenceId]);
    expect((await adminDb.doc(`saleCollectionEvidence/${photo.evidenceId}`).get()).get("status")).toBe("linked");
    await expect(call(branchManager, "getSaleDocument", read)).resolves.toMatchObject({ base64: upload.base64, contentType: "image/png", saleItemId });
    await expect(call(branchManager, "confirmPosSaleOrder", { ...collect, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect((await balanceRef.get()).get("onHandQuantity")).toBe(1);
    await adminDb.doc(`saleCollectionEvidence/${photo.evidenceId}`).update({ organizationId: "another-org" });
    await expect(call(branchManager, "getSaleDocument", read)).rejects.toMatchObject({ code: "functions/not-found" });
  }, 120000);
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

    const retry = await call<typeof posted>(
      branchManager,
      "commitPosSale",
      payload,
    );
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

    const officialDocument = await call<{
      official: boolean;
      organization: { legalName: string; tradingName: string };
      sale: {
        invoiceNumber: string;
        receiptNumber: string;
        vatAmountMinor: number;
      };
      items: Array<Record<string, unknown>>;
      payments: Array<Record<string, unknown>>;
    }>(branchManager, "getSaleDocument", { saleId: posted.saleId });
    expect(officialDocument).toMatchObject({
      official: true,
      organization: { legalName: "AB Ramadan Ltd.", tradingName: "ABR" },
      sale: {
        invoiceNumber: posted.saleNumber,
        receiptNumber: posted.receiptNumber,
        vatAmountMinor: 1_650,
      },
    });
    expect(officialDocument.items).toHaveLength(1);
    expect(officialDocument.payments).toHaveLength(1);
    expect(officialDocument.items[0]).not.toHaveProperty("unitCostMinor");
    expect(officialDocument.items[0]).not.toHaveProperty("costAmountMinor");
    await expect(
      call(cashier, "getSaleDocument", { saleId: posted.saleId }),
    ).resolves.toMatchObject({
      official: true,
      sale: { saleNumber: posted.saleNumber },
    });
    await expect(
      call(cashier, "generateSalesReport", {
        reportType: "sales_register",
        branchId,
      }),
    ).rejects.toMatchObject({ code: "functions/permission-denied" });

    const salesReport = await call<{
      rows: Array<Record<string, unknown>>;
      nextCursor: { recordedAt: string; saleId: string } | null;
    }>(branchManager, "generateSalesReport", {
      reportType: "sales_register",
      branchId,
      limit: 100,
    });
    expect(salesReport.rows).toContainEqual(
      expect.objectContaining({
        id: posted.saleId,
        saleNumber: posted.saleNumber,
        receiptNumber: posted.receiptNumber,
        grossAmountMinor: 23_650,
        vatAmountMinor: 1_650,
      }),
    );
    expect(
      salesReport.rows.find((row) => row.id === posted.saleId),
    ).not.toHaveProperty("costAmountMinor");

    await adminDb.doc("sales/out-of-scope-sale").set({
      organizationId,
      branchId: "another-branch",
      saleNumber: "SAL-OTHER-2026-000001",
      recordedAt: FieldValue.serverTimestamp(),
    });
    await expect(
      call(branchManager, "getSaleDocument", { saleId: "out-of-scope-sale" }),
    ).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(
      call(branchManager, "generateSalesReport", {
        reportType: "sales_register",
        branchId: "another-branch",
      }),
    ).rejects.toMatchObject({ code: "functions/permission-denied" });
  });

  it("routes a bank-transfer sale to the selected company account", async () => {
    const shift = (await adminDb.collection("posShifts")
      .where("branchId", "==", branchId)
      .where("status", "==", "open")
      .get()).docs.find((item) => item.get("openedBy") === branchManager.auth.currentUser?.uid);
    if (!shift) throw new Error("The manager shift was not opened.");
    const posted = await call<{ saleId: string }>(branchManager, "commitPosSale", {
      branchId,
      shiftId: shift.id,
      deviceId: shift.get("deviceId"),
      recordedAt: new Date().toISOString(),
      offline: false,
      lines: [{ productId, quantity: 1 }],
      payments: [{ method: "bank_transfer", bankAccountId, amountMinor: 11_825, reference: "TRANSFER-SALES-001" }],
      idempotencyKey: crypto.randomUUID(),
      operatingContext: { type: "branch", id: branchId },
    });
    const payment = await adminDb.collection("salePayments").where("saleId", "==", posted.saleId).get();
    expect(payment.docs[0]!.data()).toMatchObject({ bankAccountId, ledgerAccountCode: "1040", accountNumberLast4: "1234" });
    const journal = await adminDb.collection("journalEntries").where("referenceId", "==", posted.saleId).get();
    const lines = await adminDb.collection("journalLines").where("journalEntryId", "==", journal.docs[0]!.id).get();
    expect(lines.docs.map((line) => line.get("accountCode"))).toContain("1040");
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
    expect(
      workspace.products.find((product) => product.id === productId),
    ).toMatchObject({
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
    expect(finalBalance.get("onHandQuantity")).toBe(6);
  });

  it("keeps stock unchanged through order receipt and payment acceptance, then releases it on confirmation", async () => {
    const receiverDeviceId = crypto.randomUUID();
    const paymentDeviceId = crypto.randomUUID();
    const receiverShift = await call<{ shiftId: string }>(
      cashier,
      "openPosShift",
      {
        branchId,
        deviceId: receiverDeviceId,
        deviceName: "Order desk",
        openingCashMinor: 0,
        idempotencyKey: crypto.randomUUID(),
        operatingContext: { type: "branch", id: branchId },
      },
    );
    const paymentShift = await call<{ shiftId: string }>(
      cashierTwo,
      "openPosShift",
      {
        branchId,
        deviceId: paymentDeviceId,
        deviceName: "Payment desk",
        openingCashMinor: 0,
        idempotencyKey: crypto.randomUUID(),
        operatingContext: { type: "branch", id: branchId },
      },
    );
    const balance = adminDb.doc(
      `inventoryBalances/${balanceDocumentId(organizationId, productId, locationId)}`,
    );
    const before = await balance.get();
    const order = await call<{ orderId: string; orderNumber: string }>(
      cashier,
      "createPosSaleOrder",
      {
        branchId,
        shiftId: receiverShift.shiftId,
        deviceId: receiverDeviceId,
        recordedAt: new Date().toISOString(),
        offline: false,
        lines: [{ productId, quantity: 1 }],
        payments: [{ method: "bank_transfer", bankAccountId, amountMinor: 12_900, reference: "TRANSFER-WORKFLOW-001" }],
        idempotencyKey: crypto.randomUUID(),
        operatingContext: { type: "branch", id: branchId },
      },
    );
    expect(order.orderNumber).toMatch(/^ORD-IRB-/);
    const receivedEvent = await adminDb.doc(`notificationEvents/sales_order_received_${order.orderId}`).get();
    expect(receivedEvent.exists).toBe(true);
    expect(await deliverInAppNotification({ id: receivedEvent.id, ...receivedEvent.data() } as InboxEvent)).toMatchObject({ delivered: true });
    const managerInbox = adminDb.doc(`users/${branchManager.auth.currentUser!.uid}/notifications/salesOrders_${order.orderId}`);
    expect((await managerInbox.get()).get("actionRequired")).toBe(true);
    await managerInbox.update({ readAt: FieldValue.serverTimestamp() });
    await deliverInAppNotification({ id: receivedEvent.id, ...receivedEvent.data() } as InboxEvent);
    expect((await managerInbox.get()).get("readAt")).not.toBeNull();
    expect((await balance.get()).get("onHandQuantity")).toBe(
      before.get("onHandQuantity"),
    );

    await expect(
      call(cashierTwo, "acceptPosSaleOrderPayment", {
        orderId: order.orderId,
        shiftId: paymentShift.shiftId,
        deviceId: paymentDeviceId,
        idempotencyKey: crypto.randomUUID(),
        operatingContext: { type: "branch", id: branchId },
      }),
    ).resolves.toMatchObject({ status: "payment_accepted" });
    const acceptedEvent = await adminDb.doc(`notificationEvents/sales_order_payment_accepted_${order.orderId}`).get();
    expect(await deliverInAppNotification({ id: acceptedEvent.id, ...acceptedEvent.data() } as InboxEvent)).toMatchObject({ delivered: true });
    expect((await managerInbox.get()).data()).toMatchObject({ actionRequired: true, eventType: "sales_order.payment_accepted", readAt: null });
    const cashierInbox = await adminDb.doc(`users/${cashier.auth.currentUser!.uid}/notifications/salesOrders_${order.orderId}`).get();
    expect(cashierInbox.get("actionRequired")).toBe(false);
    expect((await balance.get()).get("onHandQuantity")).toBe(
      before.get("onHandQuantity"),
    );
    await expect(
      call(cashierTwo, "confirmPosSaleOrder", {
        orderId: order.orderId,
        idempotencyKey: crypto.randomUUID(),
        operatingContext: { type: "branch", id: branchId },
      }),
    ).rejects.toMatchObject({ code: "functions/permission-denied" });

    const completed = await call<{
      saleId: string;
      receiptNumber: string;
      status: string;
    }>(branchManager, "confirmPosSaleOrder", {
      orderId: order.orderId,
      idempotencyKey: crypto.randomUUID(),
      operatingContext: { type: "branch", id: branchId },
    });
    expect(completed).toMatchObject({ status: "completed" });
    const completedEvent = await adminDb.doc(`notificationEvents/sales_order_completed_${order.orderId}`).get();
    expect(await deliverInAppNotification({ id: completedEvent.id, ...completedEvent.data() } as InboxEvent)).toMatchObject({ delivered: true });
    expect((await managerInbox.get()).data()).toMatchObject({ actionRequired: false, eventType: "sales_order.completed" });
    expect(completed.receiptNumber).toMatch(/^RCT-IRB-/);
    expect((await balance.get()).get("onHandQuantity")).toBe(
      Number(before.get("onHandQuantity")) - 1,
    );
    const receiptPayment = await adminDb.collection("salePayments").where("saleId", "==", completed.saleId).get();
    expect(receiptPayment.docs[0]!.data()).toMatchObject({ bankAccountId, ledgerAccountCode: "1040" });
    expect((await adminDb.doc(`salesOrders/${order.orderId}`).get()).data()).toMatchObject({
      status: "completed",
      saleId: completed.saleId,
    });

    await expect(
      call(cashier, "closePosShift", {
        shiftId: receiverShift.shiftId,
        closingCashMinor: 0,
        idempotencyKey: crypto.randomUUID(),
        operatingContext: { type: "branch", id: branchId },
      }),
    ).resolves.toMatchObject({ closed: true });
    await expect(
      call(cashierTwo, "closePosShift", {
        shiftId: paymentShift.shiftId,
        closingCashMinor: 12_900,
        idempotencyKey: crypto.randomUUID(),
        operatingContext: { type: "branch", id: branchId },
      }),
    ).resolves.toMatchObject({ closed: true });
  });

  it("rolls back sale posting if atomic workflow completion cannot commit, and safely retries", async () => {
    const deviceId = crypto.randomUUID();
    const shift = await call<{ shiftId: string }>(branchManager, "openPosShift", { branchId, deviceId, deviceName: "Atomic confirmation", openingCashMinor: 0, idempotencyKey: crypto.randomUUID() });
    const checkout = { branchId, shiftId: shift.shiftId, deviceId, recordedAt: new Date().toISOString(), offline: false,
      lines: [{ productId, quantity: 1 }], payments: [{ method: "cash", amountMinor: 12900 }], idempotencyKey: crypto.randomUUID() };
    const order = await call<{ orderId: string }>(branchManager, "createPosSaleOrder", checkout);
    await call(branchManager, "acceptPosSaleOrderPayment", { orderId: order.orderId, shiftId: shift.shiftId, deviceId, idempotencyKey: crypto.randomUUID() });
    const balance = adminDb.doc(`inventoryBalances/${balanceDocumentId(organizationId, productId, locationId)}`);
    const before = (await balance.get()).data();
    const event = adminDb.doc(`notificationEvents/sales_order_completed_${order.orderId}`);
    // Force the final create to fail: the whole stock/journal/order transaction
    // must roll back, rather than leaving a financially posted accepted order.
    await event.create({ organizationId, testConflict: true });
    const confirm = { orderId: order.orderId, idempotencyKey: crypto.randomUUID() };
    await expect(call(branchManager, "confirmPosSaleOrder", confirm)).rejects.toBeDefined();
    expect((await adminDb.doc(`salesOrders/${order.orderId}`).get()).get("status")).toBe("payment_accepted");
    expect((await balance.get()).data()).toEqual(before);
    expect((await adminDb.doc(`posShifts/${shift.shiftId}`).get()).get("saleCount")).toBe(0);
    expect((await adminDb.doc(`idempotencyKeys/${organizationId}_commitPosSale_${checkout.idempotencyKey}`).get()).exists).toBe(false);
    await event.delete();
    const completed = await call<{ saleId: string }>(branchManager, "confirmPosSaleOrder", confirm);
    expect((await adminDb.doc(`sales/${completed.saleId}`).get()).get("salesOrderId")).toBe(order.orderId);
    expect((await adminDb.doc(`salesOrders/${order.orderId}`).get()).data()).toMatchObject({ status: "completed", saleId: completed.saleId, confirmationIdempotencyKey: confirm.idempotencyKey });
    expect((await balance.get()).get("onHandQuantity")).toBe(Number(before!.onHandQuantity) - 1);
    expect((await event.get()).get("eventType")).toBe("sales_order.completed");
    expect(await call(branchManager, "confirmPosSaleOrder", confirm)).toMatchObject({ posted: false, saleId: completed.saleId });
    await expect(call(branchManager, "commitPosSale", { ...checkout, payments: [{ method: "cash", amountMinor: 25800 }], lines: [{ productId, quantity: 2 }] })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    const operation = adminDb.doc(`idempotencyKeys/${organizationId}_commitPosSale_${checkout.idempotencyKey}`);
    // Emulate an older successfully posted checkout whose separate order
    // completion failed. Retrying must link it, without posting a second sale.
    await operation.update({ postingFingerprint: FieldValue.delete() });
    await adminDb.doc(`salesOrders/${order.orderId}`).update({ status: "payment_accepted" });
    await event.delete();
    expect(await call(branchManager, "confirmPosSaleOrder", confirm)).toMatchObject({ posted: false, saleId: completed.saleId });
    expect((await adminDb.doc(`posShifts/${shift.shiftId}`).get()).get("saleCount")).toBe(1);
    expect((await adminDb.doc(`salesOrders/${order.orderId}`).get()).get("status")).toBe("completed");
    const clonedOrder = adminDb.collection("salesOrders").doc();
    await clonedOrder.set({ ...(await adminDb.doc(`salesOrders/${order.orderId}`).get()).data(), status: "payment_accepted", createdAt: FieldValue.serverTimestamp() });
    await expect(call(branchManager, "confirmPosSaleOrder", { orderId: clonedOrder.id, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect((await clonedOrder.get()).get("status")).toBe("payment_accepted");
    expect((await adminDb.doc(`posShifts/${shift.shiftId}`).get()).get("saleCount")).toBe(1);
  });

  it("allows only rejection or confirmation to win a concurrent accepted-order race", async () => {
    const deviceId = crypto.randomUUID();
    const shift = await call<{ shiftId: string }>(branchManager, "openPosShift", { branchId, deviceId, deviceName: "Concurrent confirmation", openingCashMinor: 0, idempotencyKey: crypto.randomUUID() });
    const balance = adminDb.doc(`inventoryBalances/${balanceDocumentId(organizationId, productId, locationId)}`);
    for (let round = 0; round < 3; round++) {
      const checkout = { branchId, shiftId: shift.shiftId, deviceId, recordedAt: new Date().toISOString(), offline: false,
        lines: [{ productId, quantity: 1 }], payments: [{ method: "cash", amountMinor: 12900 }], idempotencyKey: crypto.randomUUID() };
      const order = await call<{ orderId: string }>(branchManager, "createPosSaleOrder", checkout);
      await call(branchManager, "acceptPosSaleOrderPayment", { orderId: order.orderId, shiftId: shift.shiftId, deviceId, idempotencyKey: crypto.randomUUID() });
      const before = await balance.get();
      await Promise.allSettled([
        call(branchManager, "confirmPosSaleOrder", { orderId: order.orderId, idempotencyKey: crypto.randomUUID(), deferCollection: round === 1 }),
        call(administrator, "confirmPosSaleOrder", { orderId: order.orderId, idempotencyKey: crypto.randomUUID(), deferCollection: round === 1 }),
        call(branchManager, "rejectPosSaleOrder", { orderId: order.orderId, reason: "Customer cancelled while payment was reviewed", idempotencyKey: crypto.randomUUID() }),
      ]);
      const current = await adminDb.doc(`salesOrders/${order.orderId}`).get();
      const op = await adminDb.doc(`idempotencyKeys/${organizationId}_commitPosSale_${checkout.idempotencyKey}`).get();
      const after = await balance.get();
      expect(["completed", "rejected"]).toContain(current.get("status"));
      if (current.get("status") === "rejected") {
        expect(op.exists).toBe(false);
        expect(after.data()).toEqual(before.data());
        expect((await adminDb.doc(`notificationEvents/sales_order_completed_${order.orderId}`).get()).exists).toBe(false);
      } else {
        expect(op.get("entityId")).toBe(current.get("saleId"));
        const sale = await adminDb.doc(`sales/${current.get("saleId")}`).get();
        expect(sale.get("salesOrderId")).toBe(order.orderId);
        const journal = await adminDb.doc(`journalEntries/${sale.get("journalEntryId")}`).get();
        expect(journal.get("totalDebitMinor")).toBe(journal.get("totalCreditMinor"));
        expect(after.get("onHandQuantity")).toBe(Number(before.get("onHandQuantity")) - (round === 1 ? 0 : 1));
        expect(after.get("reservedQuantity")).toBe(Number(before.get("reservedQuantity")) + (round === 1 ? 1 : 0));
        await expect(call(branchManager, "rejectPosSaleOrder", { orderId: order.orderId, reason: "Cannot reject a posted sale", idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
        if (round === 1) {
          const item = (await adminDb.collection("saleItems").where("saleId", "==", sale.id).get()).docs[0]!;
          await call(branchManager, "confirmPosSaleOrder", { action: "collect", saleId: sale.id, lines: [{ saleItemId: item.id, quantity: 1 }], collector: "Atomic race test collector", idempotencyKey: crypto.randomUUID() });
        }
      }
    }
  });

  it("posts an audited discount with partial customer credit, enforces the limit, and records repayment", async () => {
    const saved = await call<{ customerId: string; customerNumber: string }>(
      branchManager,
      "saveCustomer",
      {
        name: "Aminu Solar Services",
        phone: "07012345678",
        active: true,
        idempotencyKey: crypto.randomUUID(),
        operatingContext: { type: "branch", id: branchId },
      },
    );
    expect(saved.customerNumber).toMatch(/^CUS-/);
    const pendingWorkspace = await call<{
      customers: Array<{ id: string; creditStatus: string }>;
    }>(branchManager, "getPosWorkspace", {
      branchId,
      operatingContext: { type: "branch", id: branchId },
    });
    expect(pendingWorkspace.customers).toContainEqual(
      expect.objectContaining({
        id: saved.customerId,
        creditStatus: "pending",
      }),
    );
    await expect(
      call(branchManager, "decideCustomerCredit", {
        customerId: saved.customerId,
        decision: "approve",
        creditLimitMinor: 20_000,
        reason: "Known trade customer",
        idempotencyKey: crypto.randomUUID(),
        operatingContext: { type: "branch", id: branchId },
      }),
    ).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(
      call(administrator, "decideCustomerCredit", {
        customerId: saved.customerId,
        decision: "approve",
        creditLimitMinor: 20_000,
        reason: "Approved trade account after administrator review",
        idempotencyKey: crypto.randomUUID(),
      }),
    ).resolves.toMatchObject({ decision: "approve", saved: true });

    const workspace = await call<{
      customers: Array<{ id: string; availableCreditMinor: number }>;
    }>(branchManager, "getPosWorkspace", {
      branchId,
      operatingContext: { type: "branch", id: branchId },
    });
    expect(workspace.customers).toContainEqual(
      expect.objectContaining({
        id: saved.customerId,
        availableCreditMinor: 20_000,
      }),
    );
    const shift = await adminDb
      .collection("posShifts")
      .where("branchId", "==", branchId)
      .where("status", "==", "open")
      .limit(1)
      .get();
    const currentShift = shift.docs[0]!;
    await expect(
      call(branchManager, "commitPosSale", {
        branchId,
        shiftId: currentShift.id,
        deviceId: currentShift.get("deviceId"),
        recordedAt: new Date().toISOString(),
        offline: false,
        customerId: saved.customerId,
        creditAmountMinor: 7_750,
        discountAmountMinor: 2_000,
        lines: [{ productId, quantity: 1 }],
        payments: [{ method: "cash", amountMinor: 3_000 }],
        idempotencyKey: crypto.randomUUID(),
        operatingContext: { type: "branch", id: branchId },
      }),
    ).rejects.toMatchObject({ code: "functions/invalid-argument" });
    const sale = await call<{ saleId: string; posted: boolean }>(
      branchManager,
      "commitPosSale",
      {
        branchId,
        shiftId: currentShift.id,
        deviceId: currentShift.get("deviceId"),
        recordedAt: new Date().toISOString(),
        offline: false,
        customerId: saved.customerId,
        creditAmountMinor: 7_750,
        discountAmountMinor: 2_000,
        discountReason: "Approved trade discount",
        lines: [{ productId, quantity: 1 }],
        payments: [{ method: "cash", amountMinor: 3_000 }],
        idempotencyKey: crypto.randomUUID(),
        operatingContext: { type: "branch", id: branchId },
      },
    );
    expect(sale.posted).toBe(true);
    const [saleRecord, customer, receivableLines, accountEntries] =
      await Promise.all([
        adminDb.doc(`sales/${sale.saleId}`).get(),
        adminDb.doc(`customers/${saved.customerId}`).get(),
        adminDb
          .collection("journalLines")
          .where(
            "journalEntryId",
            "==",
            (
              await adminDb
                .collection("journalEntries")
                .where("referenceId", "==", sale.saleId)
                .limit(1)
                .get()
            ).docs[0]!.id,
          )
          .get(),
        adminDb
          .collection("customerAccountEntries")
          .where("referenceId", "==", sale.saleId)
          .get(),
      ]);
    expect(saleRecord.data()).toMatchObject({
      customerId: saved.customerId,
      paymentStatus: "partially_paid",
      subtotalAmountMinor: 12_000,
      discountAmountMinor: 2_000,
      discountReason: "Approved trade discount",
      netAmountMinor: 10_000,
      vatAmountMinor: 750,
      grossAmountMinor: 10_750,
      creditAmountMinor: 7_750,
      amountPaidMinor: 3_000,
      receivableOutstandingMinor: 7_750,
      receivablePaidMinor: 3_000,
    });
    expect(customer.data()).toMatchObject({
      outstandingBalanceMinor: 7_750,
      availableCreditMinor: 12_250,
    });
    expect(
      receivableLines.docs.some(
        (line) =>
          line.get("accountCode") === "1100" &&
          line.get("debitMinor") === 7_750,
      ),
    ).toBe(true);
    expect(accountEntries.size).toBe(1);

    const stockBeforeRejectedSale = await adminDb
      .doc(
        `inventoryBalances/${balanceDocumentId(organizationId, productId, locationId)}`,
      )
      .get();
    await expect(
      call(branchManager, "commitPosSale", {
        branchId,
        shiftId: currentShift.id,
        deviceId: currentShift.get("deviceId"),
        recordedAt: new Date().toISOString(),
        offline: false,
        customerId: saved.customerId,
        creditAmountMinor: 12_900,
        lines: [{ productId, quantity: 1 }],
        payments: [],
        idempotencyKey: crypto.randomUUID(),
        operatingContext: { type: "branch", id: branchId },
      }),
    ).rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect(
      (await stockBeforeRejectedSale.ref.get()).get("onHandQuantity"),
    ).toBe(stockBeforeRejectedSale.get("onHandQuantity"));

    await expect(call(branchManager, "recordCustomerPayment", {
      customerId: saved.customerId, branchId, method: "bank_transfer", amountMinor: 5_000,
      idempotencyKey: crypto.randomUUID(), operatingContext: { type: "branch", id: branchId },
    })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await expect(
      call(branchManager, "recordCustomerPayment", {
        customerId: saved.customerId,
        branchId,
        method: "bank_transfer",
        amountMinor: 5_000,
        reference: "BANK-CR-001",
        bankAccountId,
        idempotencyKey: crypto.randomUUID(),
        operatingContext: { type: "branch", id: branchId },
      }),
    ).resolves.toMatchObject({ recorded: true });
    const received = (await adminDb.collection("customerPayments").where("customerId", "==", saved.customerId).get()).docs[0]!;
    expect(received.data()).toMatchObject({ bankAccountId, ledgerAccountCode: "1040", accountNumberLast4: "1234" });
    const receiptJournal = await adminDb.collection("journalLines").where("journalEntryId", "==", received.get("journalEntryId")).get();
    expect(receiptJournal.docs.map((row) => row.data())).toContainEqual(expect.objectContaining({ accountCode: "1040", debitMinor: 5_000 }));
    expect(
      (await adminDb.doc(`customers/${saved.customerId}`).get()).data(),
    ).toMatchObject({
      outstandingBalanceMinor: 2_750,
      availableCreditMinor: 17_250,
    });

    await expect(
      call(branchManager, "commitPosSale", {
        branchId,
        shiftId: currentShift.id,
        deviceId: currentShift.get("deviceId"),
        recordedAt: new Date().toISOString(),
        offline: true,
        customerId: saved.customerId,
        creditAmountMinor: 12_900,
        lines: [
          {
            productId,
            quantity: 1,
            unitPriceMinor: 12_000,
            vatRateBasisPoints: 750,
            priceVersion: 2,
          },
        ],
        payments: [],
        idempotencyKey: crypto.randomUUID(),
        operatingContext: { type: "branch", id: branchId },
      }),
    ).rejects.toMatchObject({ code: "functions/invalid-argument" });
  });

  it("lets a branch manager approve an audited receipt return and redeem its exchange credit once", async () => {
    const originalPayment = await adminDb
      .collection("salePayments")
      .where("amountMinor", "==", 23_650)
      .limit(1)
      .get();
    const originalSaleId = String(originalPayment.docs[0]!.get("saleId"));
    const originalSale = await adminDb.doc(`sales/${originalSaleId}`).get();
    const originalItems = await adminDb
      .collection("saleItems")
      .where("saleId", "==", originalSaleId)
      .get();
    const originalItem = originalItems.docs[0]!;
    const workspace = await call<{
      items: Array<{ id: string; returnableQuantity: number }>;
    }>(branchManager, "getSaleReturnWorkspace", {
      branchId,
      receiptNumber: originalSale.get("receiptNumber"),
      operatingContext: { type: "branch", id: branchId },
    });
    expect(workspace.items).toContainEqual(
      expect.objectContaining({ id: originalItem.id, returnableQuantity: 2 }),
    );

    const submitted = await call<{ returnId: string; returnNumber: string }>(
      branchManager,
      "createSaleReturn",
      {
        branchId,
        saleId: originalSaleId,
        lines: [
          {
            saleItemId: originalItem.id,
            quantity: 1,
            condition: "restockable",
          },
        ],
        resolution: "exchange_credit",
        reason: "Customer exchanges one unopened panel",
        idempotencyKey: crypto.randomUUID(),
        operatingContext: { type: "branch", id: branchId },
      },
    );
    expect(submitted.returnNumber).toMatch(/^RTN-IRB-/);
    const beforeApproval = await adminDb
      .doc(
        `inventoryBalances/${balanceDocumentId(organizationId, productId, locationId)}`,
      )
      .get();
    await expect(call(branchManager, "approveSaleReturn", { returnId: submitted.returnId, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await inspectReturnedGoods(branchManager, submitted.returnId);
    const approved = await call<{ creditId: string; approved: boolean }>(
      branchManager,
      "approveSaleReturn",
      {
        returnId: submitted.returnId,
        notes: "Item inspected and sealed by the assigned manager",
        idempotencyKey: crypto.randomUUID(),
        operatingContext: { type: "branch", id: branchId },
      },
    );

    const balanceReference = adminDb.doc(
      `inventoryBalances/${balanceDocumentId(organizationId, productId, locationId)}`,
    );
    expect(approved).toMatchObject({ approved: true });
    expect(approved.creditId).toBeTruthy();
    const [
      afterApproval,
      returnRecord,
      creditRecord,
      returnInventory,
      returnJournal,
    ] = await Promise.all([
      balanceReference.get(),
      adminDb.doc(`saleReturns/${submitted.returnId}`).get(),
      adminDb.doc(`salesCredits/${approved.creditId}`).get(),
      adminDb
        .collection("inventoryTransactions")
        .where("referenceId", "==", submitted.returnId)
        .get(),
      adminDb
        .collection("journalEntries")
        .where("referenceId", "==", submitted.returnId)
        .get(),
    ]);
    expect(afterApproval.get("onHandQuantity")).toBe(
      beforeApproval.get("onHandQuantity") + 1,
    );
    expect(returnRecord.data()).toMatchObject({ status: "approved" });
    expect(creditRecord.data()).toMatchObject({
      originalAmountMinor: 11_825,
      remainingAmountMinor: 11_825,
      status: "active",
    });
    expect(returnInventory.docs[0]!.get("transactionType")).toBe("sale_return");
    expect(returnJournal.docs[0]!.get("totalDebitMinor")).toBe(
      returnJournal.docs[0]!.get("totalCreditMinor"),
    );

    // Other scenarios open independent tills. Refund/close the till that actually
    // received this sale's cash, not an unordered, potentially empty open till.
    const shift = await adminDb.doc(`posShifts/${originalSale.get("shiftId")}`).get();
    expect(shift.get("status")).toBe("open");
    const replacement = await call<{ saleId: string; posted: boolean }>(
      branchManager,
      "commitPosSale",
      {
        branchId,
        shiftId: shift.id,
        deviceId: shift.get("deviceId"),
        recordedAt: new Date().toISOString(),
        offline: false,
        lines: [{ productId, quantity: 1 }],
        payments: [
          {
            method: "exchange_credit",
            amountMinor: 11_825,
            reference: approved.creditId,
          },
          { method: "cash", amountMinor: 1_075 },
        ],
        idempotencyKey: crypto.randomUUID(),
        operatingContext: { type: "branch", id: branchId },
      },
    );
    expect(replacement.posted).toBe(true);
    expect((await creditRecord.ref.get()).data()).toMatchObject({
      remainingAmountMinor: 0,
      status: "redeemed",
      lastRedeemedSaleId: replacement.saleId,
    });
    await expect(
      call(branchManager, "commitPosSale", {
        branchId,
        shiftId: shift.id,
        deviceId: shift.get("deviceId"),
        recordedAt: new Date().toISOString(),
        offline: false,
        lines: [{ productId, quantity: 1 }],
        payments: [
          {
            method: "exchange_credit",
            amountMinor: 11_825,
            reference: approved.creditId,
          },
          { method: "cash", amountMinor: 1_075 },
        ],
        idempotencyKey: crypto.randomUUID(),
        operatingContext: { type: "branch", id: branchId },
      }),
    ).rejects.toMatchObject({ code: "functions/failed-precondition" });

    await expect(
      call(branchManager, "createSaleReturn", {
        branchId,
        saleId: originalSaleId,
        lines: [
          {
            saleItemId: originalItem.id,
            quantity: 2,
            condition: "restockable",
          },
        ],
        resolution: "exchange_credit",
        reason: "Attempt to exceed the receipt remainder",
        idempotencyKey: crypto.randomUUID(),
        operatingContext: { type: "branch", id: branchId },
      }),
    ).rejects.toMatchObject({ code: "functions/failed-precondition" });

    const nonRestockable = await call<{ returnId: string }>(
      branchManager,
      "createSaleReturn",
      {
        branchId,
        saleId: originalSaleId,
        lines: [
          {
            saleItemId: originalItem.id,
            quantity: 1,
            condition: "non_restockable",
          },
        ],
        resolution: "cash",
        refundShiftId: shift.id,
        reason: "Panel was returned physically damaged",
        idempotencyKey: crypto.randomUUID(),
        operatingContext: { type: "branch", id: branchId },
      },
    );
    const beforeNonRestockable = await balanceReference.get();
    await inspectReturnedGoods(administrator, nonRestockable.returnId);
    const shiftBeforeRefund = await shift.ref.get();
    await expect(
      call(administrator, "approveSaleReturn", {
        returnId: nonRestockable.returnId,
        notes: "Damage confirmed; do not return to saleable stock",
        idempotencyKey: crypto.randomUUID(),
      }),
    ).resolves.toMatchObject({ approved: true, creditId: null });
    expect((await balanceReference.get()).get("onHandQuantity")).toBe(
      beforeNonRestockable.get("onHandQuantity"),
    );
    expect((await shift.ref.get()).get("cashRefundsMinor")).toBe(
      Number(shiftBeforeRefund.get("cashRefundsMinor") ?? 0) + 11_825,
    );
    const finalWorkspace = await call<{
      items: Array<{ id: string; returnableQuantity: number }>;
    }>(branchManager, "getSaleReturnWorkspace", {
      branchId,
      receiptNumber: originalSale.get("receiptNumber"),
      operatingContext: { type: "branch", id: branchId },
    });
    expect(finalWorkspace.items).toContainEqual(
      expect.objectContaining({ id: originalItem.id, returnableQuantity: 0 }),
    );
    const shiftBeforeClose = await shift.ref.get();
    const expectedClosingCash =
      Number(shiftBeforeClose.get("openingCashMinor")) +
      Number(shiftBeforeClose.get("cashSalesMinor")) -
      Number(shiftBeforeClose.get("cashRefundsMinor"));
    await expect(
      call(branchManager, "closePosShift", {
        shiftId: shift.id,
        closingCashMinor: expectedClosingCash,
        idempotencyKey: crypto.randomUUID(),
        operatingContext: { type: "branch", id: branchId },
      }),
    ).resolves.toMatchObject({ closed: true });
    expect((await shift.ref.get()).data()).toMatchObject({
      expectedCashMinor: expectedClosingCash,
      cashVarianceMinor: 0,
      status: "closed",
    });
  });

  it("lets an order taker set an audited one-sale price without changing the catalogue", async () => {
    const balance = adminDb.doc(`inventoryBalances/${balanceDocumentId(organizationId, productId, locationId)}`);
    await balance.update({ onHandQuantity: 5, availableQuantity: 5, totalValueMinor: 25_000 });
    const deviceId = crypto.randomUUID();
    const shift = await call<{ shiftId: string }>(cashier, "openPosShift", {
      branchId, deviceId, deviceName: "Price edit test", openingCashMinor: 0,
      idempotencyKey: crypto.randomUUID(), operatingContext: { type: "branch", id: branchId },
    });
    const workspace = await call<{ products: Array<{
      id: string; unitPriceMinor: number; basePriceMinor: number; priceVersion: number; vatRateBasisPoints: number;
    }> }>(cashier, "getPosWorkspace", { branchId, operatingContext: { type: "branch", id: branchId } });
    const product = workspace.products.find((item) => item.id === productId)!;
    const price = Math.max(product.unitPriceMinor, product.basePriceMinor) + 1_000;
    const line = {
      productId, quantity: 1, priceVersion: product.priceVersion,
      unitPriceMinor: product.unitPriceMinor, vatRateBasisPoints: product.vatRateBasisPoints,
      sellingPriceMinor: price, priceOverrideReason: "Agreed customer price",
    };
    const payload = {
      branchId, shiftId: shift.shiftId, deviceId, recordedAt: new Date().toISOString(), offline: false,
      lines: [line], payments: [{ method: "cash", amountMinor: price + Math.round(price * product.vatRateBasisPoints / 10_000) }],
      idempotencyKey: crypto.randomUUID(), operatingContext: { type: "branch", id: branchId },
    };
    await expect(call(cashier, "createPosSaleOrder", {
      ...payload, idempotencyKey: crypto.randomUUID(),
      lines: [{ ...line, sellingPriceMinor: 0 }],
    })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    const order = await call<{ orderId: string }>(cashier, "createPosSaleOrder", payload);
    await call(branchManager, "acceptPosSaleOrderPayment", {
      orderId: order.orderId, shiftId: shift.shiftId, deviceId,
      idempotencyKey: crypto.randomUUID(), operatingContext: { type: "branch", id: branchId },
    });
    const completed = await call<{ saleId: string }>(branchManager, "confirmPosSaleOrder", {
      orderId: order.orderId, idempotencyKey: crypto.randomUUID(),
      operatingContext: { type: "branch", id: branchId },
    });
    const items = await adminDb.collection("saleItems").where("saleId", "==", completed.saleId).get();
    expect(items.docs[0]!.data()).toMatchObject({
      unitPriceMinor: price, catalogUnitPriceMinor: product.unitPriceMinor,
      priceOverrideReason: "Agreed customer price", priceSource: "pos_override",
    });
    const lowerPrice = Math.max(1, Math.min(product.unitPriceMinor, product.basePriceMinor) - 1_000);
    const lowerOrder = await call<{ orderId: string }>(cashier, "createPosSaleOrder", {
      ...payload,
      lines: [{ ...line, sellingPriceMinor: lowerPrice, priceOverrideReason: "Customer negotiated discount" }],
      payments: [{ method: "cash", amountMinor: lowerPrice + Math.round(lowerPrice * product.vatRateBasisPoints / 10_000) }],
      idempotencyKey: crypto.randomUUID(),
    });
    await call(branchManager, "acceptPosSaleOrderPayment", {
      orderId: lowerOrder.orderId, shiftId: shift.shiftId, deviceId,
      idempotencyKey: crypto.randomUUID(), operatingContext: { type: "branch", id: branchId },
    });
    const lowerCompleted = await call<{ saleId: string }>(branchManager, "confirmPosSaleOrder", {
      orderId: lowerOrder.orderId, idempotencyKey: crypto.randomUUID(),
      operatingContext: { type: "branch", id: branchId },
    });
    const lowerItems = await adminDb.collection("saleItems").where("saleId", "==", lowerCompleted.saleId).get();
    expect(lowerItems.docs[0]!.data()).toMatchObject({
      unitPriceMinor: lowerPrice, catalogUnitPriceMinor: product.unitPriceMinor,
      priceOverrideReason: "Customer negotiated discount", priceSource: "pos_override",
    });
    const lowerAudit = await adminDb.collection("auditLogs").where("entityId", "==", lowerCompleted.saleId).get();
    expect(lowerAudit.docs.some((entry) => entry.get("after.priceOverrides")?.some(
      (override: { sellingPriceMinor: number; reason: string }) =>
        override.sellingPriceMinor === lowerPrice && override.reason === "Customer negotiated discount",
    ))).toBe(true);
    expect((await adminDb.doc(`productSalesPrices/${productId}`).get()).get("basePriceMinor")).toBe(product.basePriceMinor);
  });

  it("lets a system administrator grant credit directly without customer preapproval", async () => {
    const balance = adminDb.doc(`inventoryBalances/${balanceDocumentId(organizationId, productId, locationId)}`);
    await balance.update({ onHandQuantity: 5, availableQuantity: 5, totalValueMinor: 25_000 });
    const saved = await call<{ customerId: string }>(branchManager, "saveCustomer", {
      name: "Direct Credit Customer", phone: "07012345679", active: true,
      idempotencyKey: crypto.randomUUID(), operatingContext: { type: "branch", id: branchId },
    });
    const deviceId = crypto.randomUUID();
    const shift = await call<{ shiftId: string }>(administrator, "openPosShift", {
      branchId, deviceId, deviceName: "Administrator credit test", openingCashMinor: 0,
      idempotencyKey: crypto.randomUUID(), operatingContext: { type: "branch", id: branchId },
    });
    const workspace = await call<{ products: Array<{ id: string; unitPriceMinor: number; vatRateBasisPoints: number }> }>(
      administrator, "getPosWorkspace", { branchId, operatingContext: { type: "branch", id: branchId } },
    );
    const product = workspace.products.find((item) => item.id === productId)!;
    const creditAmountMinor = product.unitPriceMinor + Math.round(product.unitPriceMinor * product.vatRateBasisPoints / 10_000);
    const payload = {
      branchId, shiftId: shift.shiftId, deviceId, recordedAt: new Date().toISOString(), offline: false,
      customerId: saved.customerId, creditAmountMinor, lines: [{ productId, quantity: 1 }], payments: [],
      idempotencyKey: crypto.randomUUID(), operatingContext: { type: "branch", id: branchId },
    };
    const managerDeviceId = crypto.randomUUID();
    const managerShift = await call<{ shiftId: string }>(branchManager, "openPosShift", {
      branchId, deviceId: managerDeviceId, deviceName: "Manager credit test", openingCashMinor: 0,
      idempotencyKey: crypto.randomUUID(), operatingContext: { type: "branch", id: branchId },
    });
    await expect(call(branchManager, "createPosSaleOrder", {
      ...payload, shiftId: managerShift.shiftId, deviceId: managerDeviceId,
      idempotencyKey: crypto.randomUUID(),
    })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    const order = await call<{ orderId: string }>(administrator, "createPosSaleOrder", payload);
    const orderRecord = await adminDb.doc(`salesOrders/${order.orderId}`).get();
    expect(orderRecord.data()).toMatchObject({
      creditAuthorizationType: "administrator_direct",
      creditAuthorizedBy: administrator.auth.currentUser!.uid,
      creditAuthorizedAmountMinor: creditAmountMinor,
    });
    await call(branchManager, "acceptPosSaleOrderPayment", {
      orderId: order.orderId, shiftId: shift.shiftId, deviceId,
      idempotencyKey: crypto.randomUUID(), operatingContext: { type: "branch", id: branchId },
    });
    const completed = await call<{ saleId: string }>(branchManager, "confirmPosSaleOrder", {
      orderId: order.orderId, idempotencyKey: crypto.randomUUID(),
      operatingContext: { type: "branch", id: branchId },
    });
    expect((await adminDb.doc(`sales/${completed.saleId}`).get()).data()).toMatchObject({
      customerId: saved.customerId, creditAmountMinor,
      creditAuthorizationType: "administrator_direct",
      creditAuthorizedBy: administrator.auth.currentUser!.uid,
    });
    expect((await adminDb.doc(`customers/${saved.customerId}`).get()).data()).toMatchObject({
      creditStatus: "pending", outstandingBalanceMinor: creditAmountMinor,
    });
    const direct = await call<{ saleId: string }>(administrator, "commitPosSale", {
      ...payload, idempotencyKey: crypto.randomUUID(),
    });
    expect((await adminDb.doc(`sales/${direct.saleId}`).get()).data()).toMatchObject({
      creditAuthorizationType: "administrator_direct", creditAmountMinor,
    });
  });

  it("records split tender components and permits any sales-stage user to reject an unposted order", async () => {
    const deviceId = crypto.randomUUID();
    const shift = await call<{ shiftId: string }>(cashier, "openPosShift", {
      branchId, deviceId, deviceName: "Split tender test", openingCashMinor: 0,
      idempotencyKey: crypto.randomUUID(), operatingContext: { type: "branch", id: branchId },
    });
    const workspace = await call<{ products: Array<{ id: string; unitPriceMinor: number; vatRateBasisPoints: number }> }>(
      cashier, "getPosWorkspace", { branchId, operatingContext: { type: "branch", id: branchId } },
    );
    const product = workspace.products.find((item) => item.id === productId)!;
    const gross = product.unitPriceMinor + Math.round(product.unitPriceMinor * product.vatRateBasisPoints / 10_000);
    const payments = [
      { method: "cash", amountMinor: gross - 10_000 },
      { method: "bank_transfer", amountMinor: 5_000, bankAccountId, reference: "TRANSFER-001" },
      { method: "card", amountMinor: 5_000, bankAccountId, reference: "CARD-001" },
    ];
    const order = await call<{ orderId: string }>(cashier, "createPosSaleOrder", {
      branchId, shiftId: shift.shiftId, deviceId, recordedAt: new Date().toISOString(), offline: false,
      lines: [{ productId, quantity: 1 }], payments, idempotencyKey: crypto.randomUUID(),
      operatingContext: { type: "branch", id: branchId },
    });
    expect((await adminDb.doc(`salesOrders/${order.orderId}`).get()).get("payload.payments")).toEqual(payments);
    await call(branchManager, "acceptPosSaleOrderPayment", {
      orderId: order.orderId, shiftId: shift.shiftId, deviceId,
      idempotencyKey: crypto.randomUUID(), operatingContext: { type: "branch", id: branchId },
    });
    await call(cashier, "rejectPosSaleOrder", {
      orderId: order.orderId, reason: "Customer cancelled; transfer and card authorization reversed REF-001",
      idempotencyKey: crypto.randomUUID(), operatingContext: { type: "branch", id: branchId },
    });
    expect((await adminDb.doc(`salesOrders/${order.orderId}`).get()).data()).toMatchObject({
      status: "rejected", rejectedBy: cashier.auth.currentUser!.uid,
    });
    await expect(call(branchManager, "confirmPosSaleOrder", {
      orderId: order.orderId, idempotencyKey: crypto.randomUUID(), operatingContext: { type: "branch", id: branchId },
    })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    const audit = await adminDb.collection("auditLogs").where("entityId", "==", order.orderId).get();
    expect(audit.docs.some((record) => record.get("action") === "sales_order.rejected")).toBe(true);
  });

  it("splits a discounted sale return without exceeding the actual receipt and exposes customer history", async () => {
    const balance = adminDb.doc(`inventoryBalances/${balanceDocumentId(organizationId, productId, locationId)}`);
    await balance.update({ onHandQuantity: 5, availableQuantity: 5, totalValueMinor: 25_000 });
    const customer = await call<{ customerId: string }>(branchManager, "saveCustomer", {
      name: "Return History Customer", phone: "07012345670", active: true,
      idempotencyKey: crypto.randomUUID(), operatingContext: { type: "branch", id: branchId },
    });
    const deviceId = crypto.randomUUID();
    const shift = await call<{ shiftId: string }>(branchManager, "openPosShift", {
      branchId, deviceId, deviceName: "Discounted return test", openingCashMinor: 0,
      idempotencyKey: crypto.randomUUID(), operatingContext: { type: "branch", id: branchId },
    });
    const workspace = await call<{ products: Array<{ id: string; unitPriceMinor: number; vatRateBasisPoints: number }> }>(
      branchManager, "getPosWorkspace", { branchId, operatingContext: { type: "branch", id: branchId } },
    );
    const product = workspace.products.find((item) => item.id === productId)!;
    const net = product.unitPriceMinor * 2 - 2_000;
    const gross = net + Math.round(net * product.vatRateBasisPoints / 10_000);
    const posted = await call<{ saleId: string; saleNumber: string }>(branchManager, "commitPosSale", {
      branchId, shiftId: shift.shiftId, deviceId, recordedAt: new Date().toISOString(), offline: false,
      customerId: customer.customerId, lines: [{ productId, quantity: 2 }],
      discountAmountMinor: 2_000, discountReason: "Customer agreed promotion",
      payments: [{ method: "cash", amountMinor: gross }], idempotencyKey: crypto.randomUUID(),
      operatingContext: { type: "branch", id: branchId },
    });
    const item = (await adminDb.collection("saleItems").where("saleId", "==", posted.saleId).get()).docs[0]!;
    const returnWorkspace = await call<{ items: Array<{ grossAmountMinor: number }>; sale: { customerOutstandingMinor: number } }>(
      branchManager, "getSaleReturnWorkspace", { branchId, receiptNumber: posted.saleNumber, operatingContext: { type: "branch", id: branchId } },
    );
    expect(returnWorkspace.items[0]!.grossAmountMinor).toBe(gross);
    expect(returnWorkspace.sale.customerOutstandingMinor).toBe(0);
    let credited = 0;
    for (let index = 0; index < 2; index += 1) {
      const created = await call<{ returnId: string }>(branchManager, "createSaleReturn", {
        branchId, saleId: posted.saleId, lines: [{ saleItemId: item.id, quantity: 1, condition: "non_restockable" }],
        resolution: index === 0 ? "exchange_credit" : "bank_transfer", ...(index === 1 ? { bankAccountId } : {}), reason: "Customer returned a discounted item",
        idempotencyKey: crypto.randomUUID(), operatingContext: { type: "branch", id: branchId },
      });
      const record = await adminDb.doc(`saleReturns/${created.returnId}`).get();
      await inspectReturnedGoods(branchManager, created.returnId);
      credited += Number(record.get("grossAmountMinor"));
      if (index === 1) {
        // Earlier submitted returns have no account; require one at approval rather than rewriting old posted journals.
        await record.ref.update({ bankAccountId: FieldValue.delete() });
        await expect(call(branchManager, "approveSaleReturn", {
          returnId: created.returnId, idempotencyKey: crypto.randomUUID(), operatingContext: { type: "branch", id: branchId },
        })).rejects.toMatchObject({ code: "functions/failed-precondition" });
      }
      await call(branchManager, "approveSaleReturn", {
        returnId: created.returnId, ...(index === 1 ? { bankAccountId } : {}), idempotencyKey: crypto.randomUUID(), operatingContext: { type: "branch", id: branchId },
      });
      if (index === 1) {
        const refunds = await adminDb.collection("saleRefunds").where("returnId", "==", created.returnId).get();
        expect(refunds.docs).toHaveLength(1);
        expect(refunds.docs[0]!.data()).toMatchObject({ bankAccountId, ledgerAccountCode: "1040", amountMinor: Number(record.get("grossAmountMinor")) });
        const journal = await adminDb.collection("journalLines").where("journalEntryId", "==", refunds.docs[0]!.get("journalEntryId")).get();
        expect(journal.docs.map((row) => row.data())).toContainEqual(expect.objectContaining({ accountCode: "1040", creditMinor: Number(record.get("grossAmountMinor")) }));
      }
    }
    expect(credited).toBe(gross);
    const history = await call<{ rows: Array<{ kind: string; reference: string }> }>(branchManager, "getCustomerHistory", {
      customerId: customer.customerId, branchId, limit: 50, operatingContext: { type: "branch", id: branchId },
    });
    expect(history.rows).toContainEqual(expect.objectContaining({ kind: "sale", reference: posted.saleNumber }));
    expect(history.rows.filter((row) => row.kind === "return")).toHaveLength(2);
    const firstHistoryPage = await call<{ rows: Array<{ id: string }>; nextCursor: Record<string, string> | null }>(branchManager, "getCustomerHistory", {
      customerId: customer.customerId, branchId, limit: 1, operatingContext: { type: "branch", id: branchId },
    });
    expect(firstHistoryPage.rows).toHaveLength(1);
    expect(firstHistoryPage.nextCursor).not.toBeNull();
    const secondHistoryPage = await call<{ rows: Array<{ id: string }> }>(branchManager, "getCustomerHistory", {
      customerId: customer.customerId, branchId, limit: 1, cursor: firstHistoryPage.nextCursor,
      operatingContext: { type: "branch", id: branchId },
    });
    expect(secondHistoryPage.rows).toHaveLength(1);
    expect(secondHistoryPage.rows[0]!.id).not.toBe(firstHistoryPage.rows[0]!.id);
    const statement = await call<{ branchId: string; netAssetsMinor: number }>(branchManager, "generateFinancialStatement", {
      reportType: "balance_sheet", fromDate: "2026-01-01", toDate: "2026-12-31", branchId,
      operatingContext: { type: "branch", id: branchId },
    });
    expect(statement.branchId).toBe(branchId);
    expect(Number.isSafeInteger(statement.netAssetsMinor)).toBe(true);
    await expect(call(branchManager, "generateFinancialStatement", {
      reportType: "balance_sheet", fromDate: "2026-01-01", toDate: "2026-12-31", branchId: "another-branch",
    })).rejects.toMatchObject({ code: "functions/permission-denied" });
  });

  it("pages the combined customer history without losing equal-time or sub-millisecond entries", async () => {
    const customer = await call<{ customerId: string }>(administrator, "saveCustomer", {
      name: "History pagination customer", phone: "07012345671", active: true, idempotencyKey: crypto.randomUUID(),
    });
    const expected: string[] = [];
    const batch = adminDb.batch();
    const definitions = [
      { collection: "sales", source: "sale", dateField: "recordedAt", ids: ["history-sale-Z", "history-sale-a", "history-sale-z"] },
      { collection: "saleReturns", source: "return", dateField: "createdAt", ids: ["history-return-a", "history-return-z"] },
      { collection: "customerAccountEntries", source: "account", dateField: "effectiveAt", ids: ["history-account-a", "history-account-z", "history-account-Z"] },
    ];
    for (const definition of definitions) {
      for (const [index, id] of definition.ids.entries()) {
        expected.push(`${definition.source}:${id}`);
        batch.set(adminDb.doc(`${definition.collection}/${id}`), {
          organizationId, customerId: customer.customerId, branchId,
          [definition.dateField]: new Timestamp(1_900_000_000, definition.source === "account" ? index * 100 : 0),
          saleNumber: id, returnNumber: id, referenceNumber: id,
          grossAmountMinor: 1000, amountMinor: 1000, entryType: "payment", paymentStatus: "paid", status: "posted",
        });
      }
    }
    await batch.commit();
    const seen: string[] = [];
    let cursor: Record<string, string> | undefined;
    for (let page = 0; page < 10; page += 1) {
      const result = await call<{ rows: Array<{ id: string }>; nextCursor: Record<string, string> | null }>(branchManager, "getCustomerHistory", {
        customerId: customer.customerId, branchId, limit: 2, ...(cursor ? { cursor } : {}),
        operatingContext: { type: "branch", id: branchId },
      });
      expect(result.rows.length).toBeLessThanOrEqual(2);
      seen.push(...result.rows.map((row) => row.id));
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    expect(seen).toHaveLength(expected.length);
    expect(new Set(seen).size).toBe(expected.length);
    expect([...seen].sort()).toEqual(expected.sort());
    await adminDb.doc("customers/other-customer").set({ organizationId, name: "Other customer" });
    await expect(call(branchManager, "getCustomerHistory", {
      customerId: "other-customer", branchId, limit: 2, cursor: { sale: "history-sale-a" },
      operatingContext: { type: "branch", id: branchId },
    })).rejects.toMatchObject({ code: "functions/invalid-argument" });
  });
  it("cancels uncollected reservations without restocking and collects only the remainder", async () => {
    const balance = adminDb.doc(`inventoryBalances/${balanceDocumentId(organizationId, productId, locationId)}`);
    await balance.update({ onHandQuantity: 10, reservedQuantity: 0, availableQuantity: 10, totalValueMinor: 50_000, averageUnitCostMinor: 5_000 });
    await call(administrator, "saveProductSalesPrice", { productId, basePriceMinor: 10_000, vatRateBasisPoints: 750, active: true, idempotencyKey: crypto.randomUUID() });
    const deviceId = crypto.randomUUID();
    const shift = await call<{ shiftId: string }>(branchManager, "openPosShift", { branchId, deviceId, deviceName: "Cancellation desk", openingCashMinor: 0, idempotencyKey: crypto.randomUUID(), operatingContext: { type: "branch", id: branchId } });
    const workspace = await call<{ products: Array<{ id: string; unitPriceMinor: number; vatRateBasisPoints: number }> }>(branchManager, "getPosWorkspace", { branchId });
    const product = workspace.products.find((row) => row.id === productId)!;
    const net = product.unitPriceMinor * 4 - 1;
    const vat = Math.round(net * product.vatRateBasisPoints / 10_000);
    const gross = net + vat;
    const cancellationAmount = Math.round(net / 2) + Math.round(vat / 2);
    const order = await call<{ orderId: string }>(branchManager, "createPosSaleOrder", { branchId, shiftId: shift.shiftId, deviceId, recordedAt: new Date().toISOString(), offline: false, discountAmountMinor: 1, discountReason: "Rounding regression discount", lines: [{ productId, quantity: 4 }], payments: [{ method: "cash", amountMinor: gross }], idempotencyKey: crypto.randomUUID(), operatingContext: { type: "branch", id: branchId } });
    await call(branchManager, "acceptPosSaleOrderPayment", { orderId: order.orderId, shiftId: shift.shiftId, deviceId, idempotencyKey: crypto.randomUUID(), operatingContext: { type: "branch", id: branchId } });
    const sale = await call<{ saleId: string }>(branchManager, "confirmPosSaleOrder", { orderId: order.orderId, deferCollection: true, idempotencyKey: crypto.randomUUID() });
    const item = (await adminDb.collection("saleItems").where("saleId", "==", sale.saleId).get()).docs[0]!;
    const request = { kind: "reservation_cancellation", branchId, saleId: sale.saleId, lines: [{ saleItemId: item.id, quantity: 2, condition: "restockable" }], resolution: "exchange_credit", reason: "Customer cancelled before collecting", idempotencyKey: crypto.randomUUID(), operatingContext: { type: "branch", id: branchId } };
    await expect(call(branchManager, "createSaleReturn", { ...request, lines: [...request.lines, ...request.lines] })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    const created = await call<{ returnId: string }>(branchManager, "createSaleReturn", request);
    const stale = await call<{ returnId: string }>(branchManager, "createSaleReturn", { ...request, idempotencyKey: crypto.randomUUID() });
    const approval = { returnId: created.returnId, idempotencyKey: crypto.randomUUID(), operatingContext: { type: "branch", id: branchId } };
    expect(await call(branchManager, "approveSaleReturn", approval)).toMatchObject({ approved: true });
    expect(await call(branchManager, "approveSaleReturn", approval)).toMatchObject({ approved: false });
    await expect(call(branchManager, "approveSaleReturn", { ...approval, returnId: stale.returnId, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect((await balance.get()).data()).toMatchObject({ onHandQuantity: 10, reservedQuantity: 2, availableQuantity: 8, totalValueMinor: 50_000 });
    const record = await adminDb.doc(`saleReturns/${created.returnId}`).get();
    const journal = await adminDb.collection("journalLines").where("journalEntryId", "==", record.get("journalEntryId")).get();
    expect(journal.docs.some((line) => ["1200", "5000"].includes(line.get("accountCode")))).toBe(false);
    expect(record.get("grossAmountMinor")).toBe(cancellationAmount);
    await expect(call(branchManager, "confirmPosSaleOrder", { action: "collect", saleId: sale.saleId, lines: [{ saleItemId: item.id, quantity: 3 }], collector: "Customer", idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect(await call(branchManager, "confirmPosSaleOrder", { action: "collect", saleId: sale.saleId, lines: [{ saleItemId: item.id, quantity: 2 }], collector: "Customer", idempotencyKey: crypto.randomUUID() })).toMatchObject({ collectionStatus: "collected" });
    expect((await balance.get()).data()).toMatchObject({ onHandQuantity: 8, reservedQuantity: 0, availableQuantity: 8, totalValueMinor: 40_000 });
    expect(await call(branchManager, "getSaleDocument", { saleId: sale.saleId })).toMatchObject({ sale: { collectionStatus: "collected", cancelledQuantity: 2 }, items: [expect.objectContaining({ cancelledQuantity: 2, collectedQuantity: 2 })] });
    await expect(call(branchManager, "createSaleReturn", { ...request, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    const returned = await call<{ returnId: string }>(branchManager, "createSaleReturn", { ...request, kind: "goods_return", idempotencyKey: crypto.randomUUID() });
    await inspectReturnedGoods(branchManager, returned.returnId);
    await call(branchManager, "approveSaleReturn", { ...approval, returnId: returned.returnId, idempotencyKey: crypto.randomUUID() });
    expect((await adminDb.doc(`saleReturns/${returned.returnId}`).get()).get("grossAmountMinor")).toBe(gross - cancellationAmount);
    expect((await balance.get()).data()).toMatchObject({ onHandQuantity: 10, reservedQuantity: 0, availableQuantity: 10, totalValueMinor: 50_000 });
  }, 120_000);
  it("resumes bounded collection reminders, skips recent and undated goods, and never changes reservations", async () => {
    const reminderOrg = "collection-reminder-test";
    const date = new Date("2026-10-09T12:00:00Z");
    const base = { organizationId: reminderOrg, branchId, status: "completed", collectionTracked: true, collectionStatus: "awaiting_collection", totalQuantity: 4, collectedQuantity: 1, cancelledQuantity: 1 };
    await adminDb.doc("sales/reminder_a_old").set({ ...base, saleNumber: "OLD", reservedAt: Timestamp.fromDate(new Date("2026-10-01T12:00:00Z")) });
    await adminDb.doc("sales/reminder_b_recent").set({ ...base, saleNumber: "RECENT", reservedAt: Timestamp.fromDate(new Date("2026-10-08T12:00:00Z")) });
    await adminDb.doc("sales/reminder_c_undated").set({ ...base, saleNumber: "UNDATED" });
    await adminDb.doc("sales/reminder_d_other_org").set({ ...base, organizationId: "unrelated", saleNumber: "OTHER", reservedAt: Timestamp.fromDate(new Date("2026-10-01T12:00:00Z")) });
    for (let pass = 0; pass < 8; pass++) await queueCollectionReminders(reminderOrg, date, 1);
    const events = await adminDb.collection("notificationEvents").where("organizationId", "==", reminderOrg).get();
    expect(events.docs.map(record => record.get("entityId"))).toEqual(["reminder_a_old"]);
    expect((await adminDb.doc("sales/reminder_a_old").get()).data()).toMatchObject(base);
    expect((await adminDb.doc("organizations/collection-reminder-test/jobCursors/collections").get()).get("saleId")).toBeNull();
  });
  it("reserves paid goods, releases partial collections atomically and rejects duplicate or excessive releases", async () => {
    const balance = adminDb.doc(`inventoryBalances/${balanceDocumentId(organizationId, productId, locationId)}`);
    await balance.update({ onHandQuantity: 10, reservedQuantity: 0, availableQuantity: 10, totalValueMinor: 50_000, averageUnitCostMinor: 5_000 });
    await call(administrator, "saveProductSalesPrice", { productId, basePriceMinor: 10_000, vatRateBasisPoints: 750, active: true, idempotencyKey: crypto.randomUUID() });
    const deviceId = crypto.randomUUID();
    const shift = await call<{ shiftId: string }>(branchManager, "openPosShift", { branchId, deviceId, deviceName: "Collection desk", openingCashMinor: 0, idempotencyKey: crypto.randomUUID(), operatingContext: { type: "branch", id: branchId } });
    const workspace = await call<{ products: Array<{ id: string; unitPriceMinor: number; vatRateBasisPoints: number }> }>(branchManager, "getPosWorkspace", { branchId });
    const price = workspace.products.find((product) => product.id === productId)!;
    const amount = price.unitPriceMinor * 4 + Math.round(price.unitPriceMinor * 4 * price.vatRateBasisPoints / 10_000);
    const order = await call<{ orderId: string }>(branchManager, "createPosSaleOrder", { branchId, shiftId: shift.shiftId, deviceId, recordedAt: new Date().toISOString(), offline: false, lines: [{ productId, quantity: 4 }], payments: [{ method: "cash", amountMinor: amount }], idempotencyKey: crypto.randomUUID(), operatingContext: { type: "branch", id: branchId } });
    await call(branchManager, "acceptPosSaleOrderPayment", { orderId: order.orderId, shiftId: shift.shiftId, deviceId, idempotencyKey: crypto.randomUUID(), operatingContext: { type: "branch", id: branchId } });
    const completed = await call<{ saleId: string }>(branchManager, "confirmPosSaleOrder", { orderId: order.orderId, deferCollection: true, idempotencyKey: crypto.randomUUID() });
    expect((await balance.get()).data()).toMatchObject({ onHandQuantity: 10, reservedQuantity: 4, availableQuantity: 6, totalValueMinor: 50_000 });
    const sale = await adminDb.doc(`sales/${completed.saleId}`).get();
    const items = await adminDb.collection("saleItems").where("saleId", "==", completed.saleId).get();
    const saleItemId = items.docs[0]!.id;
    expect(sale.get("costAmountMinor")).toBe(0);
    const postedJournal = await adminDb.collection("journalEntries").where("referenceId", "==", completed.saleId).get();
    const journal = await adminDb.collection("journalLines").where("journalEntryId", "==", postedJournal.docs[0]!.id).get();
    expect(journal.docs.some((line) => ["5000", "1200"].includes(line.get("accountCode")))).toBe(false);
    expect(await call(branchManager, "getSaleDocument", { action: "list_collections", branchId, limit: 25 })).toMatchObject({ rows: [expect.objectContaining({ id: completed.saleId, collectedQuantity: 0 })] });
    await expect(call(branchManager, "createSaleReturn", { branchId, saleId: completed.saleId, resolution: "exchange_credit", reason: "Not yet collected", lines: [{ saleItemId, quantity: 1, condition: "restockable" }], idempotencyKey: crypto.randomUUID(), operatingContext: { type: "branch", id: branchId } })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    const payload = { action: "collect", saleId: completed.saleId, lines: [{ saleItemId, quantity: 1 }], collector: "Test Collector", idempotencyKey: crypto.randomUUID() };
    await expect(call(cashier, "confirmPosSaleOrder", payload)).rejects.toMatchObject({ code: "functions/permission-denied" });
    expect(await call(branchManager, "confirmPosSaleOrder", payload)).toMatchObject({ recorded: true, collectionStatus: "partially_collected" });
    expect(await call(branchManager, "confirmPosSaleOrder", payload)).toMatchObject({ recorded: false });
    await expect(call(branchManager, "confirmPosSaleOrder", { ...payload, collector: "Different collector" })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    await expect(call(branchManager, "confirmPosSaleOrder", { ...payload, lines: [{ saleItemId, quantity: 2 }] })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    expect((await balance.get()).data()).toMatchObject({ onHandQuantity: 9, reservedQuantity: 3, availableQuantity: 6, totalValueMinor: 45_000 });
    await expect(call(branchManager, "confirmPosSaleOrder", { ...payload, lines: [{ saleItemId, quantity: 4 }], idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    const collections = await adminDb.collection("saleCollections").where("saleId", "==", completed.saleId).get();
    expect(collections.size).toBe(1);
    const costJournal = await adminDb.doc(`journalEntries/${collections.docs[0]!.get("journalEntryId")}`).get();
    expect(costJournal.data()).toMatchObject({ totalDebitMinor: 5_000, totalCreditMinor: 5_000 });
    const reminderDate = new Date(Date.now() + 8 * 86400000);
    for (let pass = 0; pass < 3; pass++) await queueCollectionReminders(organizationId, reminderDate, 1);
    const reminderEvents = await adminDb.collection("notificationEvents").where("entityId", "==", completed.saleId).where("eventType", "==", "sale.collection_waiting").get();
    expect(reminderEvents.size).toBe(1);
    const reminderEvent = { id: reminderEvents.docs[0]!.id, ...reminderEvents.docs[0]!.data() } as InboxEvent;
    expect(await deliverInAppNotification(reminderEvent)).toMatchObject({ delivered: true });
    expect((await adminDb.doc(`users/${branchManager.auth.currentUser!.uid}/notifications/sale_collection_${completed.saleId}`).get()).get("title")).toBe("Goods still awaiting collection");
    expect((await balance.get()).get("reservedQuantity")).toBe(3);
    const competing = await Promise.allSettled([1, 2].map(() => call(branchManager, "confirmPosSaleOrder", { ...payload, lines: [{ saleItemId, quantity: 3 }], idempotencyKey: crypto.randomUUID() })));
    expect(competing.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(competing.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await balance.get()).data()).toMatchObject({ onHandQuantity: 6, reservedQuantity: 0, availableQuantity: 6, totalValueMinor: 30_000 });
    expect(await deliverInAppNotification({ ...reminderEvent, id: `${reminderEvent.id}_late` })).toMatchObject({ delivered: true, providerMessageId: expect.stringContaining("superseded") });
    const saleDocument = await call<{ collections: Array<{ id: string; waybillNumber: string }> }>(branchManager, "getSaleDocument", { saleId: completed.saleId });
    expect(saleDocument).toMatchObject({ sale: { collectionStatus: "collected" }, items: [expect.objectContaining({ collectedQuantity: 4 })], collections: [expect.objectContaining({ waybillNumber: expect.stringMatching(/^WB-INV-/), releasedByName: expect.any(String), lines: [expect.objectContaining({ saleItemId, quantity: expect.any(Number), sku: "PANEL-620", unitOfMeasure: "unit" })] }), expect.any(Object)] });
    expect((await call<{ collections: Array<{ waybillNumber: string }> }>(branchManager, "getSaleDocument", { saleId: completed.saleId })).collections.map((record) => record.waybillNumber)).toEqual(saleDocument.collections.map((record) => record.waybillNumber));
    // Preserve the shared fixture expected by the older immediate-sale cases.
    await balance.update({ onHandQuantity: 10, reservedQuantity: 0, availableQuantity: 10, totalValueMinor: 50_000 });
  });

  it("isolates named customer arrangements, allocates repayments and returns, and preserves legacy debt", async () => {
    const context = { type: "branch", id: branchId };
    const base = { name: "Arrangement customer", phone: "08099887766", idempotencyKey: crypto.randomUUID() };
    const created = await call<{ customerId: string }>(administrator, "saveCustomer", base);
    const customerRef = adminDb.doc(`customers/${created.customerId}`);
    // Pre-existing debt has no arrangement and must remain General.
    await customerRef.update({ outstandingBalanceMinor: 5000, availableCreditMinor: 95000, creditLimitMinor: 100000, creditStatus: "approved" });
    const accountId = crypto.randomUUID();
    const configure = { ...base, customerId: created.customerId, arrangement: { id: accountId, name: "Installation project", active: true, reason: "Separate installation purchasing" }, idempotencyKey: crypto.randomUUID() };
    await expect(call(cashier, "saveCustomer", configure)).rejects.toMatchObject({ code: "functions/permission-denied" });
    await call(administrator, "saveCustomer", configure);
    await call(administrator, "saveCustomer", configure);
    expect((await customerRef.get()).get("arrangements")).toHaveLength(1);
    const deviceId = crypto.randomUUID();
    const shift = await call<{ shiftId: string }>(branchManager, "openPosShift", { branchId, deviceId, deviceName: "Account desk", openingCashMinor: 0, idempotencyKey: crypto.randomUUID(), operatingContext: context });
    const workspace = await call<{ products: Array<{ id: string; unitPriceMinor: number; vatRateBasisPoints: number }>; customers: Array<{ id: string; arrangements: unknown[] }> }>(branchManager, "getPosWorkspace", { branchId, operatingContext: context });
    expect(workspace.customers.find((item) => item.id === created.customerId)?.arrangements).toContainEqual(expect.objectContaining({ id: "general", outstandingBalanceMinor: 5000 }));
    const price = workspace.products.find((item) => item.id === productId)!;
    const gross = price.unitPriceMinor * 2 + Math.round(price.unitPriceMinor * 2 * price.vatRateBasisPoints / 10000);
    const payload = { branchId, deviceId, shiftId: shift.shiftId, recordedAt: new Date().toISOString(), offline: false, customerId: created.customerId, customerAccountId: accountId, creditAmountMinor: gross, creditDueDate: "2026-10-08", lines: [{ productId, quantity: 2 }], payments: [], idempotencyKey: crypto.randomUUID(), operatingContext: context };
    await expect(call(branchManager, "createPosSaleOrder", { ...payload, customerAccountId: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    const order = await call<{ orderId: string }>(branchManager, "createPosSaleOrder", payload);
    await call(branchManager, "acceptPosSaleOrderPayment", { orderId: order.orderId, shiftId: shift.shiftId, deviceId, idempotencyKey: crypto.randomUUID(), operatingContext: context });
    const sale = await call<{ saleId: string }>(branchManager, "confirmPosSaleOrder", { orderId: order.orderId, idempotencyKey: crypto.randomUUID(), operatingContext: context });
    expect((await adminDb.doc(`sales/${sale.saleId}`).get()).data()).toMatchObject({ customerAccountId: accountId, customerAccountName: "Installation project", receivableVersion: 1, receivableOutstandingMinor: gross, receivableDueDate: "2026-10-08" });
    expect((await customerRef.get()).get("arrangements")[0].outstandingBalanceMinor).toBe(gross);
    const payment = { customerId: created.customerId, branchId, method: "cash", amountMinor: 1000, idempotencyKey: crypto.randomUUID(), operatingContext: context };
    await expect(call(administrator, "recordCustomerPayment", { ...payment, amountMinor: 5001 })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await expect(call(administrator, "recordCustomerPayment", { ...payment, allocations: [{ accountId, amountMinor: 999 }] })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    const allocated = { ...payment, allocations: [{ accountId: "general", amountMinor: 400 }, { accountId, amountMinor: 600 }] };
    const receipt = await call<{ paymentId: string }>(administrator, "recordCustomerPayment", allocated);
    expect(await call(administrator, "recordCustomerPayment", allocated)).toMatchObject({ recorded: false, paymentId: receipt.paymentId });
    expect((await customerRef.get()).data()).toMatchObject({ outstandingBalanceMinor: 5000 + gross - 1000, arrangements: [expect.objectContaining({ id: accountId, outstandingBalanceMinor: gross - 600 })] });
    const paymentRecord = await adminDb.doc(`customerPayments/${receipt.paymentId}`).get();
    expect(paymentRecord.get("allocations")).toHaveLength(2);
    expect(paymentRecord.get("invoiceAllocations")).toEqual([expect.objectContaining({ saleId: sale.saleId, accountId, amountMinor: 600 })]);
    expect((await adminDb.doc(`sales/${sale.saleId}`).get()).get("receivableOutstandingMinor")).toBe(gross - 600);
    const journal = await adminDb.doc(`journalEntries/${paymentRecord.get("journalEntryId")}`).get();
    expect(journal.data()).toMatchObject({ totalDebitMinor: 1000, totalCreditMinor: 1000 });
    await expect(call(administrator, "saveCustomer", { ...configure, arrangement: { ...configure.arrangement, active: false }, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    const item = (await adminDb.collection("saleItems").where("saleId", "==", sale.saleId).get()).docs[0]!;
    const returned = await call<{ returnId: string }>(branchManager, "createSaleReturn", { branchId, saleId: sale.saleId, resolution: "customer_account", reason: "One item returned to original project", lines: [{ saleItemId: item.id, quantity: 1, condition: "restockable" }], idempotencyKey: crypto.randomUUID(), operatingContext: context });
    await inspectReturnedGoods(branchManager, returned.returnId);
    await call(branchManager, "approveSaleReturn", { returnId: returned.returnId, idempotencyKey: crypto.randomUUID(), operatingContext: context });
    const returnAmount = (await adminDb.doc(`saleReturns/${returned.returnId}`).get()).get("grossAmountMinor");
    const remaining = gross - 600 - returnAmount;
    expect((await customerRef.get()).get("arrangements")[0].outstandingBalanceMinor).toBe(remaining);
    await call(administrator, "recordCustomerPayment", { ...payment, amountMinor: remaining, allocations: [{ accountId, amountMinor: remaining }], idempotencyKey: crypto.randomUUID() });
    expect((await adminDb.doc(`sales/${sale.saleId}`).get()).data()).toMatchObject({ receivableOutstandingMinor: 0, receivableStatus: "settled", receivableCreditedMinor: returnAmount, amountPaidMinor: 0, creditAmountMinor: gross });
    await call(administrator, "saveCustomer", { ...configure, arrangement: { ...configure.arrangement, active: false }, idempotencyKey: crypto.randomUUID() });
    await expect(call(branchManager, "createPosSaleOrder", { ...payload, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    const history = await call<{ customer: { arrangements: unknown[] }; rows: unknown[] }>(administrator, "getCustomerHistory", { customerId: created.customerId });
    expect(history.customer.arrangements).toContainEqual(expect.objectContaining({ id: "general", outstandingBalanceMinor: 4600 }));
    expect(history.rows).toContainEqual(expect.objectContaining({ kind: "account", accountName: "Multiple arrangements" }));
  });

  it("allocates invoice repayments and advances atomically, with aging and resumable debt reminders", async () => {
    const saved = await call<{ customerId: string }>(administrator, "saveCustomer", { name: "Advance test", phone: "08077665544", idempotencyKey: crypto.randomUUID() });
    const customer = adminDb.doc(`customers/${saved.customerId}`);
    await customer.update({ outstandingBalanceMinor: 10500, invoiceDebtByAccount: { general: 10000 }, creditLimitMinor: 20000, availableCreditMinor: 9500 });
    const invoice = adminDb.collection("sales").doc();
    await invoice.set({ organizationId, branchId, customerId: saved.customerId, customerAccountId: "general", customerAccountName: "General account", saleNumber: "INV-ADVANCE-TEST", receivableVersion: 1, receivableStatus: "open", receivableOutstandingMinor: 10000, receivablePaidMinor: 0, receivableCreditedMinor: 0, receivableDueDate: "2026-10-01", recordedAt: Timestamp.now(), grossAmountMinor: 10000, amountPaidMinor: 0, creditAmountMinor: 10000 });
    const base = { customerId: saved.customerId, branchId, method: "bank_transfer", bankAccountId, amountMinor: 4000, purpose: "advance", idempotencyKey: crypto.randomUUID() };
    await expect(call(cashier, "recordCustomerPayment", base)).rejects.toMatchObject({ code: "functions/permission-denied" });
    const receipt = await call<{ paymentId: string }>(administrator, "recordCustomerPayment", base);
    expect(await call(administrator, "recordCustomerPayment", base)).toMatchObject({ recorded: false, paymentId: receipt.paymentId });
    expect((await customer.get()).data()).toMatchObject({ outstandingBalanceMinor: 10500, advanceBalances: { general: 4000 } });
    const receiptRecord = await adminDb.doc(`customerPayments/${receipt.paymentId}`).get();
    const receiptLines = await adminDb.collection("journalLines").where("journalEntryId", "==", receiptRecord.get("journalEntryId")).get();
    expect(receiptLines.docs.map((line) => line.data())).toEqual(expect.arrayContaining([expect.objectContaining({ accountCode: "1040", debitMinor: 4000 }), expect.objectContaining({ accountCode: "2210", creditMinor: 4000 })]));
    const application = { customerId: saved.customerId, branchId, amountMinor: 4000, purpose: "repayment", source: "advance_balance", method: "cash", invoiceAllocations: [{ saleId: invoice.id, amountMinor: 4000 }], idempotencyKey: crypto.randomUUID() };
    const applications = await Promise.all([call<{ paymentId: string; recorded: boolean }>(administrator, "recordCustomerPayment", application), call<{ paymentId: string; recorded: boolean }>(administrator, "recordCustomerPayment", application)]);
    expect(applications.map((item) => item.recorded).sort()).toEqual([false, true]);
    const applied = applications.find((item) => item.recorded)!;
    expect((await customer.get()).data()).toMatchObject({ outstandingBalanceMinor: 6500, advanceBalances: { general: 0 }, invoiceDebtByAccount: { general: 6000 } });
    expect((await invoice.get()).data()).toMatchObject({ receivableOutstandingMinor: 6000, receivablePaidMinor: 4000, amountPaidMinor: 0 });
    const appliedRecord = await adminDb.doc(`customerPayments/${applied.paymentId}`).get();
    const appliedLines = await adminDb.collection("journalLines").where("journalEntryId", "==", appliedRecord.get("journalEntryId")).get();
    expect(appliedLines.docs.map((line) => line.data())).toEqual(expect.arrayContaining([expect.objectContaining({ accountCode: "2210", debitMinor: 4000 }), expect.objectContaining({ accountCode: "1100", creditMinor: 4000 })]));
    expect(appliedLines.docs.every((line) => !["1010", "1040"].includes(String(line.get("accountCode"))))).toBe(true);
    await expect(call(administrator, "recordCustomerPayment", { ...application, amountMinor: 1, invoiceAllocations: [{ saleId: invoice.id, amountMinor: 1 }], idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await expect(call(administrator, "recordCustomerPayment", { ...application, source: "receipt", amountMinor: 6001, invoiceAllocations: [{ saleId: invoice.id, amountMinor: 6001 }], idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    const history = await call<{ invoices: unknown[]; aging: Array<{ name: string; amountMinor: number }>; historicalUnallocatedMinor: number }>(administrator, "getCustomerHistory", { customerId: saved.customerId, branchId, view: "receivables", limit: 25 });
    expect(history).toMatchObject({ historicalUnallocatedMinor: 500, invoices: [expect.objectContaining({ id: invoice.id, outstandingMinor: 6000 })] });
    expect(history.aging.reduce((sum, bucket) => sum + bucket.amountMinor, 0)).toBe(6000);
    const reminderDate = new Date("2026-10-07T12:00:00Z");
    await queueDebtReminders(organizationId, reminderDate, 1);
    await queueDebtReminders(organizationId, reminderDate, 1);
    const reminders = await adminDb.collection("notificationEvents").where("entityId", "==", invoice.id).where("eventType", "==", "customer.debt_overdue").get();
    expect(reminders.size).toBe(1);
    const reminder = reminders.docs[0]!;
    await deliverInAppNotification({ ...reminder.data(), id: reminder.id } as InboxEvent);
    expect((await adminDb.doc(`users/${branchManager.auth.currentUser!.uid}/notifications/sales_${invoice.id}`).get()).get("href")).toBe(`/customers/${saved.customerId}`);
    await call(administrator, "recordCustomerPayment", { ...application, source: "receipt", amountMinor: 6500, invoiceAllocations: [{ saleId: invoice.id, amountMinor: 6000 }], idempotencyKey: crypto.randomUUID() });
    expect((await customer.get()).get("outstandingBalanceMinor")).toBe(0);
    expect((await invoice.get()).get("receivableStatus")).toBe("settled");
    expect(await deliverInAppNotification({ ...reminder.data(), id: `${reminder.id}_retry` } as InboxEvent)).toMatchObject({ delivered: true, providerMessageId: expect.stringContaining("superseded") });
  });

  it("pages arrangement statements across unmatched entries and scopes every cursor", async () => {
    const accountId = crypto.randomUUID();
    const saved = await call<{ customerId: string }>(administrator, "saveCustomer", { name: "Statement customer", phone: "08077665550", idempotencyKey: crypto.randomUUID() });
    await call(administrator, "saveCustomer", { customerId: saved.customerId, name: "Statement customer", phone: "08077665550", arrangement: { id: accountId, name: "Solar contract", active: true, reason: "Statement fixture arrangement" }, idempotencyKey: crypto.randomUUID() });
    const refs = [0, 1, 2, 3].map(() => adminDb.collection("customerAccountEntries").doc());
    for (const [index, ref] of refs.entries()) await ref.set({ organizationId, branchId, customerId: saved.customerId, entryType: index === 0 ? "credit_sale" : "advance", amountMinor: index === 0 ? 6000 : 1000,
      referenceNumber: `STATEMENT-${index}`, effectiveAt: Timestamp.fromMillis(Date.now() + index * 1000),
      ...(index === 1 ? { customerAccountId: accountId, customerAccountName: "Solar contract" } : {}),
      ...(index === 2 ? { customerAccountName: "Multiple arrangements", allocations: [{ accountId: "general", accountName: "General account", amountMinor: 700 }, { accountId, accountName: "Solar contract", amountMinor: 300 }] } : {}),
    });
    type Statement = { rows: Array<{ reference: string; amountMinor: number; debtChangeMinor: number; advanceChangeMinor: number }>; nextCursor: { account: string } | null; statement: { accountName: string; scannedCount: number } };
    const input = { view: "statement", customerId: saved.customerId, branchId, customerAccountId: accountId, limit: 1 };
    const first = await call<Statement>(branchManager, "getCustomerHistory", input);
    expect(first.rows).toEqual([]); expect(first.nextCursor).toEqual({ account: refs[3]!.id });
    const second = await call<Statement>(branchManager, "getCustomerHistory", { ...input, cursor: first.nextCursor });
    expect(second.rows).toMatchObject([{ reference: "STATEMENT-2", amountMinor: 300, debtChangeMinor: 0, advanceChangeMinor: 300 }]);
    const third = await call<Statement>(branchManager, "getCustomerHistory", { ...input, cursor: second.nextCursor });
    expect(third.rows).toMatchObject([{ reference: "STATEMENT-1", amountMinor: 1000 }]);
    const fourth = await call<Statement>(branchManager, "getCustomerHistory", { ...input, cursor: third.nextCursor });
    expect(fourth.rows).toEqual([]); expect(fourth.nextCursor).toBeNull();
    const general = await call<Statement>(branchManager, "getCustomerHistory", { ...input, customerAccountId: "general", limit: 25 });
    expect(general.rows).toContainEqual(expect.objectContaining({ reference: "STATEMENT-0", debtChangeMinor: 6000 }));
    const other = adminDb.collection("customerAccountEntries").doc();
    await other.set({ organizationId: "other-org", customerId: saved.customerId, branchId, effectiveAt: Timestamp.now() });
    await expect(call(branchManager, "getCustomerHistory", { ...input, cursor: { account: other.id } })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    await expect(call(branchManager, "getCustomerHistory", { ...input, customerAccountId: "unknown" })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await expect(call(branchManager, "getCustomerHistory", { ...input, branchId: "outside-assignment" })).rejects.toMatchObject({ code: "functions/permission-denied" });
  });

  it("uses a named arrangement advance in POS split payment only at final confirmation", async () => {
    const accountId = crypto.randomUUID();
    const saved = await call<{ customerId: string }>(administrator, "saveCustomer", { name: "POS advance customer", phone: "08077665548", idempotencyKey: crypto.randomUUID() });
    await call(administrator, "saveCustomer", { customerId: saved.customerId, name: "POS advance customer", phone: "08077665548", arrangement: { id: accountId, name: "Solar project", active: true, reason: "Customer project arrangement" }, idempotencyKey: crypto.randomUUID() });
    const customer = adminDb.doc(`customers/${saved.customerId}`);
    await call(administrator, "recordCustomerPayment", { customerId: customer.id, branchId, method: "cash", amountMinor: 10000, purpose: "advance", allocations: [{ accountId, amountMinor: 10000 }], idempotencyKey: crypto.randomUUID() });
    const deviceId = crypto.randomUUID();
    const shift = await call<{ shiftId: string }>(branchManager, "openPosShift", { branchId, deviceId, deviceName: "Advance checkout", openingCashMinor: 0, idempotencyKey: crypto.randomUUID() });
    const workspace = await call<{ products: Array<{ id: string; unitPriceMinor: number; vatRateBasisPoints: number }> }>(branchManager, "getPosWorkspace", { branchId });
    const product = workspace.products.find(row => row.id === productId)!;
    const gross = product.unitPriceMinor + Math.round(product.unitPriceMinor * product.vatRateBasisPoints / 10000);
    const payload = { branchId, shiftId: shift.shiftId, deviceId, customerId: customer.id, customerAccountId: accountId, recordedAt: new Date().toISOString(), offline: false,
      lines: [{ productId, quantity: 1 }], payments: [{ method: "customer_advance", amountMinor: 5000 }, { method: "cash", amountMinor: gross - 5000 }], idempotencyKey: crypto.randomUUID() };
    await expect(call(branchManager, "createPosSaleOrder", { ...payload, customerAccountId: "general" })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await expect(call(cashier, "commitPosSale", payload)).rejects.toMatchObject({ code: "functions/permission-denied" });
    const rejected = await call<{ orderId: string }>(branchManager, "createPosSaleOrder", payload);
    await call(branchManager, "acceptPosSaleOrderPayment", { orderId: rejected.orderId, shiftId: shift.shiftId, deviceId, idempotencyKey: crypto.randomUUID() });
    expect((await customer.get()).get(`advanceBalances.${accountId}`)).toBe(10000);
    await call(branchManager, "rejectPosSaleOrder", { orderId: rejected.orderId, reason: "Customer reviewed and changed their order", idempotencyKey: crypto.randomUUID() });
    expect((await customer.get()).get(`advanceBalances.${accountId}`)).toBe(10000);
    const order = await call<{ orderId: string }>(branchManager, "createPosSaleOrder", { ...payload, idempotencyKey: crypto.randomUUID() });
    await call(branchManager, "acceptPosSaleOrderPayment", { orderId: order.orderId, shiftId: shift.shiftId, deviceId, idempotencyKey: crypto.randomUUID() });
    const balance = adminDb.doc(`inventoryBalances/${balanceDocumentId(organizationId, productId, locationId)}`), before = await balance.get();
    const confirm = { orderId: order.orderId, deferCollection: true, idempotencyKey: crypto.randomUUID() };
    const posted = await call<{ saleId: string }>(branchManager, "confirmPosSaleOrder", confirm);
    expect(await call(branchManager, "confirmPosSaleOrder", confirm)).toMatchObject({ saleId: posted.saleId, posted: false });
    expect((await customer.get()).data()).toMatchObject({ advanceBalances: { [accountId]: 5000 }, outstandingBalanceMinor: 0 });
    expect((await balance.get()).get("onHandQuantity")).toBe(before.get("onHandQuantity"));
    expect((await balance.get()).get("reservedQuantity")).toBe(Number(before.get("reservedQuantity")) + 1);
    const sale = await adminDb.doc(`sales/${posted.saleId}`).get();
    expect(sale.data()).toMatchObject({ advanceAmountMinor: 5000, amountPaidMinor: gross, creditAmountMinor: 0, collectionStatus: "awaiting_collection", journalEntryId: expect.any(String) });
    const payments = await adminDb.collection("salePayments").where("saleId", "==", posted.saleId).get();
    expect(payments.docs.map(doc => doc.data())).toContainEqual(expect.objectContaining({ method: "customer_advance", amountMinor: 5000, customerId: customer.id, customerAccountId: accountId, ledgerAccountCode: "2210", direction: "non_cash", journalEntryId: sale.get("journalEntryId") }));
    const journal = await adminDb.collection("journalLines").where("journalEntryId", "==", sale.get("journalEntryId")).get();
    expect(journal.docs.map(doc => doc.data())).toContainEqual(expect.objectContaining({ accountCode: "2210", debitMinor: 5000, creditMinor: 0 }));
    expect(journal.docs.reduce((sum, doc) => sum + Number(doc.get("debitMinor")) - Number(doc.get("creditMinor")), 0)).toBe(0);
    expect((await adminDb.doc(`posShifts/${shift.shiftId}`).get()).data()).toMatchObject({ cashSalesMinor: gross - 5000, nonCashSalesMinor: 0, advanceAppliedMinor: 5000, saleCount: 1 });
    const entries = await adminDb.collection("customerAccountEntries").where("referenceId", "==", posted.saleId).get();
    expect(entries.docs.map(doc => doc.data())).toContainEqual(expect.objectContaining({ entryType: "advance_sale", amountMinor: -5000, advanceAmountMinor: -5000, debtAmountMinor: 0, journalEntryId: sale.get("journalEntryId") }));
    const item = (await adminDb.collection("saleItems").where("saleId", "==", posted.saleId).get()).docs[0]!;
    const returned = await call<{ returnId: string }>(branchManager, "createSaleReturn", { kind: "reservation_cancellation", branchId, saleId: posted.saleId, lines: [{ saleItemId: item.id, quantity: 1, condition: "restockable" }], resolution: "exchange_credit", reason: "Customer cancelled the reserved advance-funded goods", idempotencyKey: crypto.randomUUID() });
    await call(branchManager, "approveSaleReturn", { returnId: returned.returnId, idempotencyKey: crypto.randomUUID() });
    expect((await customer.get()).get(`advanceBalances.${accountId}`)).toBe(5000);
    expect((await balance.get()).get("reservedQuantity")).toBe(before.get("reservedQuantity"));
    const mixed = await call<{ orderId: string }>(administrator, "createPosSaleOrder", { ...payload,
      payments: [{ method: "customer_advance", amountMinor: 2000 }, { method: "cash", amountMinor: 1000 }],
      creditAmountMinor: gross - 3000, idempotencyKey: crypto.randomUUID() });
    await call(branchManager, "acceptPosSaleOrderPayment", { orderId: mixed.orderId, shiftId: shift.shiftId, deviceId, idempotencyKey: crypto.randomUUID() });
    const mixedSale = await call<{ saleId: string }>(branchManager, "confirmPosSaleOrder", { orderId: mixed.orderId, deferCollection: true, idempotencyKey: crypto.randomUUID() });
    expect((await customer.get()).data()).toMatchObject({ advanceBalances: { [accountId]: 3000 }, outstandingBalanceMinor: gross - 3000, invoiceDebtByAccount: { [accountId]: gross - 3000 } });
    expect((await customer.get()).get("arrangements")).toContainEqual(expect.objectContaining({ id: accountId, outstandingBalanceMinor: gross - 3000 }));
    expect((await adminDb.doc(`sales/${mixedSale.saleId}`).get()).get("receivableOutstandingMinor")).toBe(gross - 3000);
    const mixedItem = (await adminDb.collection("saleItems").where("saleId", "==", mixedSale.saleId).get()).docs[0]!;
    await call(branchManager, "confirmPosSaleOrder", { action: "collect", saleId: mixedSale.saleId, lines: [{ saleItemId: mixedItem.id, quantity: 1 }], collector: "Advance plus credit test collector", idempotencyKey: crypto.randomUUID() });
  });

  it("prevents POS confirmations and an advance refund from spending the same money", async () => {
    const saved = await call<{ customerId: string }>(administrator, "saveCustomer", { name: "POS advance race", phone: "08077665549", idempotencyKey: crypto.randomUUID() });
    const customer = adminDb.doc(`customers/${saved.customerId}`);
    const workspace = await call<{ products: Array<{ id: string; unitPriceMinor: number; vatRateBasisPoints: number }> }>(branchManager, "getPosWorkspace", { branchId });
    const product = workspace.products.find(row => row.id === productId)!;
    const gross = product.unitPriceMinor + Math.round(product.unitPriceMinor * product.vatRateBasisPoints / 10000);
    await call(administrator, "recordCustomerPayment", { customerId: customer.id, branchId, method: "cash", amountMinor: gross, purpose: "advance", idempotencyKey: crypto.randomUUID() });
    const deviceId = crypto.randomUUID();
    const shift = await call<{ shiftId: string }>(branchManager, "openPosShift", { branchId, deviceId, deviceName: "Advance race", openingCashMinor: 0, idempotencyKey: crypto.randomUUID() });
    const orders: string[] = [];
    for (let index = 0; index < 2; index++) {
      const order = await call<{ orderId: string }>(branchManager, "createPosSaleOrder", { branchId, shiftId: shift.shiftId, deviceId, customerId: customer.id, recordedAt: new Date().toISOString(), offline: false, lines: [{ productId, quantity: 1 }], payments: [{ method: "customer_advance", amountMinor: gross }], idempotencyKey: crypto.randomUUID() });
      await call(branchManager, "acceptPosSaleOrderPayment", { orderId: order.orderId, shiftId: shift.shiftId, deviceId, idempotencyKey: crypto.randomUUID() });
      orders.push(order.orderId);
    }
    const results = await Promise.allSettled([
      ...orders.map(orderId => call(branchManager, "confirmPosSaleOrder", { orderId, deferCollection: true, idempotencyKey: crypto.randomUUID() })),
      call(branchManager, "recordCustomerPayment", { customerId: customer.id, branchId, method: "cash", amountMinor: gross, purpose: "advance_refund", notes: "Return the unused customer advance", idempotencyKey: crypto.randomUUID() }),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect((await customer.get()).get("advanceBalances.general")).toBe(0);
    const entries = await adminDb.collection("customerAccountEntries").where("customerId", "==", customer.id).get();
    expect(entries.docs.filter(doc => ["advance_sale", "advance_refund"].includes(doc.get("entryType")))).toHaveLength(1);
    for (const orderId of orders) {
      const order = await adminDb.doc(`salesOrders/${orderId}`).get();
      if (order.get("status") !== "completed") {
        expect(order.get("status")).toBe("payment_accepted");
        await call(branchManager, "rejectPosSaleOrder", { orderId, reason: "Advance consumed by the winning transaction", idempotencyKey: crypto.randomUUID() });
      } else {
        const item = (await adminDb.collection("saleItems").where("saleId", "==", order.get("saleId")).get()).docs[0]!;
        await call(branchManager, "confirmPosSaleOrder", { action: "collect", saleId: order.get("saleId"), lines: [{ saleItemId: item.id, quantity: 1 }], collector: "Advance race test collector", idempotencyKey: crypto.randomUUID() });
      }
    }
  });

  it("refunds unused customer advances atomically without changing debt, invoices or stock", async () => {
    const saved = await call<{ customerId: string }>(administrator, "saveCustomer", { name: "Advance refund test", phone: "08077665545", idempotencyKey: crypto.randomUUID() });
    const customer = adminDb.doc(`customers/${saved.customerId}`);
    const accountId = crypto.randomUUID();
    const receipt = { customerId: saved.customerId, branchId, method: "bank_transfer", bankAccountId, amountMinor: 10000, purpose: "advance", idempotencyKey: crypto.randomUUID() };
    await call(administrator, "recordCustomerPayment", receipt);
    // Historical inactive customers/arrangements must still be able to receive money owed.
    await customer.update({ active: false, outstandingBalanceMinor: 500, creditLimitMinor: 20000, availableCreditMinor: 19500, creditStatus: "approved", advanceBalances: { general: 6000, [accountId]: 4000 }, arrangements: [{ id: accountId, name: "Closed project", active: false, outstandingBalanceMinor: 0 }] });
    const invoice = adminDb.collection("sales").doc();
    await invoice.set({ organizationId, branchId, customerId: customer.id, receivableOutstandingMinor: 500, receivableStatus: "open" });
    const balance = adminDb.doc(`inventoryBalances/${balanceDocumentId(organizationId, productId, locationId)}`);
    const stockBefore = (await balance.get()).data();
    const reportScope = { branchId, fromDate: "2020-01-01", toDate: new Date().toISOString().slice(0, 10) };
    const cashBefore = await call<{ netCashMovementMinor: number }>(administrator, "generateFinancialStatement", { ...reportScope, reportType: "cash_flow" });
    const incomeBefore = await call<{ profitMinor: number }>(administrator, "generateFinancialStatement", { ...reportScope, reportType: "income_statement" });
    const positionBefore = await call<{ assetsMinor: number; liabilitiesMinor: number }>(administrator, "generateFinancialStatement", { ...reportScope, reportType: "balance_sheet" });
    const refund = { ...receipt, purpose: "advance_refund", amountMinor: 7000, notes: "Unused advance physically refunded to customer", reference: "BANK-REFUND-TEST", allocations: [{ accountId: "general", amountMinor: 3000 }, { accountId, amountMinor: 4000 }], idempotencyKey: crypto.randomUUID() };
    const period = adminDb.doc(`accountingPeriods/${uniquenessDocumentId(organizationId, new Date().toISOString().slice(0, 7))}`);
    await period.set({ organizationId, status: "closed" });
    try { await expect(call(administrator, "recordCustomerPayment", refund)).rejects.toMatchObject({ code: "functions/failed-precondition" }); }
    finally { await period.delete(); }
    await expect(call(cashier, "recordCustomerPayment", refund)).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(call(administrator, "recordCustomerPayment", { ...refund, branchId: "wrong-store" })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await expect(call(administrator, "recordCustomerPayment", { ...refund, bankAccountId: "wrong-account" })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    const results = await Promise.all([call<{ paymentId: string; recorded: boolean }>(administrator, "recordCustomerPayment", refund), call<{ paymentId: string; recorded: boolean }>(administrator, "recordCustomerPayment", refund)]);
    expect(results.map((item) => item.recorded).sort()).toEqual([false, true]);
    expect(results[0]!.paymentId).toBe(results[1]!.paymentId);
    await expect(call(administrator, "recordCustomerPayment", { ...refund, notes: "Different purpose under the same retry key" })).rejects.toMatchObject({ code: "functions/already-exists" });
    const payment = await adminDb.doc(`customerPayments/${results[0]!.paymentId}`).get();
    expect(payment.data()).toMatchObject({ purpose: "advance_refund", direction: "outflow", bankAccountId, ledgerAccountCode: "1040", amountMinor: 7000, invoiceAllocations: [] });
    const lines = await adminDb.collection("journalLines").where("journalEntryId", "==", payment.get("journalEntryId")).get();
    expect(lines.size).toBe(2);
    expect(lines.docs.map((line) => line.data())).toEqual(expect.arrayContaining([expect.objectContaining({ accountCode: "2210", debitMinor: 7000, creditMinor: 0 }), expect.objectContaining({ accountCode: "1040", debitMinor: 0, creditMinor: 7000 })]));
    expect((await customer.get()).data()).toMatchObject({ outstandingBalanceMinor: 500, availableCreditMinor: 19500, advanceBalances: { general: 3000, [accountId]: 0 } });
    expect((await invoice.get()).get("receivableOutstandingMinor")).toBe(500);
    expect((await balance.get()).data()).toEqual(stockBefore);
    expect(await call(administrator, "generateFinancialStatement", { ...reportScope, reportType: "cash_flow" })).toMatchObject({ netCashMovementMinor: cashBefore.netCashMovementMinor - 7000 });
    expect(await call(administrator, "generateFinancialStatement", { ...reportScope, reportType: "income_statement" })).toMatchObject({ profitMinor: incomeBefore.profitMinor });
    expect(await call(administrator, "generateFinancialStatement", { ...reportScope, reportType: "balance_sheet" })).toMatchObject({ assetsMinor: positionBefore.assetsMinor - 7000, liabilitiesMinor: positionBefore.liabilitiesMinor - 7000 });
    const entry = (await adminDb.collection("customerAccountEntries").where("referenceId", "==", payment.id).get()).docs[0]!;
    expect(entry.data()).toMatchObject({ entryType: "advance_refund", amountMinor: -7000, advanceAmountMinor: -7000, debtAmountMinor: 0, journalEntryId: payment.get("journalEntryId"), balanceAfterMinor: 500 });
    const history = await call<{ rows: unknown[] }>(administrator, "getCustomerHistory", { customerId: customer.id, branchId });
    expect(history.rows).toContainEqual(expect.objectContaining({ detail: "advance_refund", reference: payment.get("paymentNumber"), amountMinor: -7000 }));
    await expect(call(administrator, "recordCustomerPayment", { ...refund, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
  });

  it("prevents concurrent refunds and debt applications from spending the same customer advance", async () => {
    const saved = await call<{ customerId: string }>(administrator, "saveCustomer", { name: "Concurrent advance", phone: "08077665546", idempotencyKey: crypto.randomUUID() });
    const customer = adminDb.doc(`customers/${saved.customerId}`);
    await call(administrator, "recordCustomerPayment", { customerId: customer.id, branchId, method: "cash", amountMinor: 1000, purpose: "advance", idempotencyKey: crypto.randomUUID() });
    await customer.update({ outstandingBalanceMinor: 1000 });
    const common = { customerId: customer.id, branchId, method: "cash", amountMinor: 1000 };
    const results = await Promise.allSettled([
      call(branchManager, "recordCustomerPayment", { ...common, purpose: "advance_refund", notes: "Unused advance returned in cash", idempotencyKey: crypto.randomUUID() }),
      call(administrator, "recordCustomerPayment", { ...common, source: "advance_balance", idempotencyKey: crypto.randomUUID() }),
    ]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(results.find((item) => item.status === "rejected")).toMatchObject({ reason: { code: "functions/failed-precondition" } });
    expect((await customer.get()).get("advanceBalances.general")).toBe(0);
    expect((await customer.get()).get("outstandingBalanceMinor")).toBe(results[0]!.status === "fulfilled" ? 1000 : 0);
    const entries = await adminDb.collection("customerPayments").where("customerId", "==", customer.id).get();
    expect(entries.size).toBe(2); // Original receipt plus exactly one use of it.
  });

  it("enforces refund permission before replay and preserves safe historical receipt retries", async () => {
    const saved = await call<{ customerId: string }>(administrator, "saveCustomer", { name: "Refund access", phone: "08077665547", idempotencyKey: crypto.randomUUID() });
    const user = adminDb.doc(`users/${cashier.auth.currentUser!.uid}`);
    const previousUser = (await user.get()).data()!;
    const receipt = { customerId: saved.customerId, branchId, method: "cash", amountMinor: 1000, purpose: "advance", idempotencyKey: crypto.randomUUID() };
    await call(administrator, "recordCustomerPayment", receipt);
    const refund = { ...receipt, purpose: "advance_refund", amountMinor: 100, notes: "Returning unused advance", idempotencyKey: crypto.randomUUID() };
    await call(administrator, "recordCustomerPayment", refund);
    await user.update({ directRoleIds: [], effectivePermissions: ["customers.payment.record"], customRoleIds: ["receipt-only-role"] });
    try {
      await expect(call(cashier, "recordCustomerPayment", refund)).rejects.toMatchObject({ code: "functions/permission-denied" });
      await expect(call(cashier, "recordCustomerPayment", { ...refund, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/permission-denied" });
      await expect(call(cashier, "recordCustomerPayment", { ...receipt, amountMinor: 1, idempotencyKey: crypto.randomUUID() })).resolves.toMatchObject({ recorded: true });
    } finally { await user.set(previousUser); }
    const operation = adminDb.doc(`idempotencyKeys/${organizationId}_recordCustomerPayment_${receipt.idempotencyKey}`);
    await operation.update({ fingerprint: FieldValue.delete() });
    await expect(call(administrator, "recordCustomerPayment", receipt)).resolves.toMatchObject({ recorded: false });
    await expect(call(administrator, "recordCustomerPayment", { ...receipt, purpose: "advance_refund", notes: "Reusing a historical receipt key" })).rejects.toMatchObject({ code: "functions/already-exists" });
  });

  it("posts approved wholesale through the controlled workflow and rejects stale offline price tiers", async () => {
    const priceRef = adminDb.doc(`productSalesPrices/${productId}`);
    await expect(call(cashier, "saveProductSalesPrice", { productId, basePriceMinor: 10000, wholesalePriceMinor: 8000, vatRateBasisPoints: 750, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/permission-denied" });
    const priceKey = crypto.randomUUID();
    const configure = { productId, basePriceMinor: 10000, wholesalePriceMinor: 8000, vatRateBasisPoints: 750, idempotencyKey: priceKey };
    await call(administrator, "saveProductSalesPrice", configure);
    const price = await priceRef.get();
    await call(administrator, "saveProductSalesPrice", configure);
    expect((await priceRef.get()).get("version")).toBe(price.get("version"));
    expect((await priceRef.collection("versions").doc(String(price.get("version"))).get()).data()).toMatchObject({ wholesalePriceMinor: 8000, basePriceMinor: 10000 });
    const customer = await call<{ customerId: string }>(administrator, "saveCustomer", { name: "Wholesale dealer", phone: "08011223344", pricingTier: "wholesale", idempotencyKey: crypto.randomUUID() });
    const deviceId = crypto.randomUUID();
    const shift = await call<{ shiftId: string }>(branchManager, "openPosShift", { branchId, deviceId, deviceName: "Wholesale test", openingCashMinor: 0, idempotencyKey: crypto.randomUUID() });
    const context = { type: "branch", id: branchId };
    const workspace = await call<{ customers: Array<{ id: string; pricingTier: string }>; products: Array<{ id: string; wholesalePriceMinor: number; centralPriceVersion: number }> }>(branchManager, "getPosWorkspace", { branchId, operatingContext: context });
    expect(workspace.customers).toContainEqual(expect.objectContaining({ id: customer.customerId, pricingTier: "wholesale" }));
    expect(workspace.products).toContainEqual(expect.objectContaining({ id: productId, wholesalePriceMinor: 8000, centralPriceVersion: price.get("version") }));
    const payload = { branchId, shiftId: shift.shiftId, deviceId, customerId: customer.customerId, recordedAt: new Date().toISOString(), offline: false,
      lines: [{ productId, quantity: 1, priceTier: "wholesale", unitPriceMinor: 8000, priceVersion: price.get("version"), vatRateBasisPoints: 750 }],
      payments: [{ method: "cash", amountMinor: 8600 }], idempotencyKey: crypto.randomUUID(), operatingContext: context };
    const order = await call<{ orderId: string }>(branchManager, "createPosSaleOrder", payload);
    await call(branchManager, "acceptPosSaleOrderPayment", { orderId: order.orderId, shiftId: shift.shiftId, deviceId, idempotencyKey: crypto.randomUUID(), operatingContext: context });
    const completed = await call<{ saleId: string }>(branchManager, "confirmPosSaleOrder", { orderId: order.orderId, idempotencyKey: crypto.randomUUID(), operatingContext: context });
    const items = await adminDb.collection("saleItems").where("saleId", "==", completed.saleId).get();
    expect(items.docs[0]!.data()).toMatchObject({ unitPriceMinor: 8000, priceTier: "wholesale", priceSource: "wholesale", priceVersion: price.get("version") });
    const checkoutCollections = await adminDb.collection("saleCollections").where("saleId", "==", completed.saleId).get();
    expect(checkoutCollections.size).toBe(1);
    expect(checkoutCollections.docs[0]!.data()).toMatchObject({ source: "checkout", totalQuantity: 1, collector: "Collector name not captured at checkout" });
    await call(branchManager, "confirmPosSaleOrder", { orderId: order.orderId, idempotencyKey: crypto.randomUUID(), operatingContext: context });
    expect((await adminDb.collection("saleCollections").where("saleId", "==", completed.saleId).get()).size).toBe(1);
    await call(administrator, "saveProductSalesPrice", { ...configure, wholesalePriceMinor: 7500, idempotencyKey: crypto.randomUUID() });
    await expect(call(branchManager, "commitPosSale", { ...payload, offline: true, provisionalReceiptReference: "OFF-WHOLESALE-STALE", idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect((await adminDb.doc(`saleItems/${items.docs[0]!.id}`).get()).get("unitPriceMinor")).toBe(8000);
    expect((await priceRef.collection("versions").doc(String(price.get("version"))).get()).get("wholesalePriceMinor")).toBe(8000);
  });

  it("requires explicit inspection and safely refunds the cheaper replacement difference once", async () => {
    const context = { type: "branch", id: branchId };
    const balanceRef = adminDb.doc(`inventoryBalances/${balanceDocumentId(organizationId, productId, locationId)}`);
    await balanceRef.set({ organizationId, branchId, productId, locationId, onHandQuantity: 100, availableQuantity: 100, reservedQuantity: 0, totalValueMinor: 500_000, averageUnitCostMinor: 5000 }, { merge: true });
    const deviceId = crypto.randomUUID();
    const shift = await call<{ shiftId: string }>(branchManager, "openPosShift", { branchId, deviceId, deviceName: "Inspected exchange till", openingCashMinor: 0, idempotencyKey: crypto.randomUUID(), operatingContext: context });
    const workspace = await call<{ products: Array<{ id: string; unitPriceMinor: number; vatRateBasisPoints: number }> }>(branchManager, "getPosWorkspace", { branchId, operatingContext: context });
    const product = workspace.products.find(p => p.id === productId)!;
    const gross = product.unitPriceMinor + Math.round(product.unitPriceMinor * product.vatRateBasisPoints / 10_000);
    const saleInput = { branchId, shiftId: shift.shiftId, deviceId, recordedAt: new Date().toISOString(), offline: false, operatingContext: context };
    const original = await call<{ saleId: string }>(branchManager, "commitPosSale", { ...saleInput, lines: [{ productId, quantity: 2 }], payments: [{ method: "cash", amountMinor: gross * 2 }], idempotencyKey: crypto.randomUUID() });
    const saleItem = (await adminDb.collection("saleItems").where("saleId", "==", original.saleId).get()).docs[0]!;
    const request = { branchId, saleId: original.saleId, lines: [{ saleItemId: saleItem.id, quantity: 2, condition: "restockable" }], resolution: "exchange_credit", reason: "Customer chooses a cheaper replacement", idempotencyKey: crypto.randomUUID(), operatingContext: context };
    const returned = await call<{ returnId: string }>(branchManager, "createSaleReturn", request);
    await expect(call(branchManager, "createSaleReturn", { ...request, reason: "Changed request with reused retry reference" })).rejects.toMatchObject({ code: "functions/already-exists" });
    const approval = { returnId: returned.returnId, idempotencyKey: crypto.randomUUID(), operatingContext: context };
    await expect(call(branchManager, "approveSaleReturn", approval)).rejects.toMatchObject({ code: "functions/failed-precondition" });
    const returnItem = (await adminDb.collection("saleReturnItems").where("returnId", "==", returned.returnId).get()).docs[0]!;
    const inspection = { ...approval, action: "inspect", inspection: { notes: "Packaging opened; both units physically damaged", lines: [{ returnItemId: returnItem.id, disposition: "damaged" }] } };
    await expect(call(cashier, "approveSaleReturn", inspection)).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(call(branchManager, "approveSaleReturn", { ...inspection, inspection: { ...inspection.inspection, lines: [{ returnItemId: "foreign-return-item", disposition: "resellable" }] } })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    await call(branchManager, "approveSaleReturn", inspection);
    await expect(call(branchManager, "approveSaleReturn", inspection)).resolves.toMatchObject({ inspectionRecorded: true });
    await expect(call(branchManager, "approveSaleReturn", { ...inspection, inspection: { ...inspection.inspection, notes: "Changed inspection after completion" } })).rejects.toMatchObject({ code: "functions/already-exists" });
    const before = await balanceRef.get();
    const approved = await call<{ creditId: string }>(branchManager, "approveSaleReturn", { ...approval, idempotencyKey: crypto.randomUUID() });
    expect((await balanceRef.get()).get("availableQuantity")).toBe(before.get("availableQuantity"));
    expect((await returnItem.ref.get()).data()).toMatchObject({ disposition: "damaged", condition: "non_restockable", inspectionStatus: "completed" });
    const replacement = await call<{ saleId: string }>(branchManager, "commitPosSale", { ...saleInput, lines: [{ productId, quantity: 1 }], payments: [{ method: "exchange_credit", reference: approved.creditId, amountMinor: gross }], idempotencyKey: crypto.randomUUID() });
    expect((await adminDb.doc(`sales/${replacement.saleId}`).get()).data()).toMatchObject({ exchangeReturnIds: [returned.returnId], exchangeOriginalSaleIds: [original.saleId] });
    const refundRequest = { ...approval, action: "refund_exchange_credit", idempotencyKey: crypto.randomUUID(), refund: { amountMinor: gross, method: "bank_transfer", bankAccountId, reason: "Paid cheaper replacement balance back to customer" } };
    await expect(call(branchManager, "approveSaleReturn", { ...refundRequest, refund: { ...refundRequest.refund, amountMinor: gross + 1 } })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await expect(call(cashier, "approveSaleReturn", refundRequest)).rejects.toMatchObject({ code: "functions/permission-denied" });
    const period = adminDb.doc(`accountingPeriods/${uniquenessDocumentId(organizationId, new Date().toISOString().slice(0, 7))}`);
    await period.set({ organizationId, status: "closed" });
    try {
      await expect(call(branchManager, "approveSaleReturn", refundRequest)).rejects.toMatchObject({ code: "functions/failed-precondition" });
      expect((await adminDb.doc(`salesCredits/${approved.creditId}`).get()).get("remainingAmountMinor")).toBe(gross);
    } finally { await period.delete(); }
    const cashBefore = Number((await adminDb.doc(`posShifts/${shift.shiftId}`).get()).get("cashRefundsMinor") ?? 0);
    await call(branchManager, "approveSaleReturn", { ...refundRequest, idempotencyKey: crypto.randomUUID(), refund: { amountMinor: 1000, method: "cash", shiftId: shift.shiftId, reason: "Part of unused exchange credit paid in cash" } });
    expect((await adminDb.doc(`posShifts/${shift.shiftId}`).get()).get("cashRefundsMinor")).toBe(cashBefore + 1000);
    refundRequest.refund.amountMinor = gross - 1000;
    const [first, duplicate] = await Promise.all([call<{ refundId: string }>(branchManager, "approveSaleReturn", refundRequest), call<{ refundId: string }>(branchManager, "approveSaleReturn", refundRequest)]);
    expect(duplicate.refundId).toBe(first.refundId);
    const refund = await adminDb.doc(`saleRefunds/${first.refundId}`).get();
    expect(refund.data()).toMatchObject({ amountMinor: gross - 1000, bankAccountId, ledgerAccountCode: "1040", replacementSaleId: replacement.saleId });
    const journal = await adminDb.doc(`journalEntries/${refund.get("journalEntryId")}`).get();
    expect(journal.data()).toMatchObject({ totalDebitMinor: gross - 1000, totalCreditMinor: gross - 1000 });
    const journalLines = await adminDb.collection("journalLines").where("journalEntryId", "==", journal.id).get();
    expect(journalLines.docs.map(d => d.get("accountCode")).sort()).toEqual(["1040", "2200"]);
    expect((await adminDb.doc(`salesCredits/${approved.creditId}`).get()).data()).toMatchObject({ status: "refunded", remainingAmountMinor: 0, refundedAmountMinor: gross });
    await expect(call(branchManager, "approveSaleReturn", { ...refundRequest, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    const page = await call<{ returns: Array<{ id: string }>; nextCursor: string }>(branchManager, "listSaleReturns", { branchId, status: "approved", limit: 1, operatingContext: context });
    const next = await call<{ returns: Array<{ id: string }> }>(branchManager, "listSaleReturns", { branchId, status: "approved", limit: 1, cursor: page.nextCursor, operatingContext: context });
    expect(next.returns[0]!.id).not.toBe(page.returns[0]!.id);
  }, 120_000);
  it("reviews an immutable correction plan and completes only with matching posted reversal and replacement evidence", async () => {
    const context = { type: "branch", id: branchId }, deviceId = crypto.randomUUID();
    await call(administrator, "saveProductSalesPrice", { productId, basePriceMinor: 10000, vatRateBasisPoints: 750, active: true, idempotencyKey: crypto.randomUUID() });
    await adminDb.doc(`inventoryBalances/${balanceDocumentId(organizationId, productId, locationId)}`).set({ organizationId, branchId, productId, locationId, onHandQuantity: 100, availableQuantity: 100, reservedQuantity: 0, totalValueMinor: 500000, averageUnitCostMinor: 5000 }, { merge: true });
    const shift = await call<{ shiftId: string }>(branchManager, "openPosShift", { branchId, deviceId, deviceName: "Correction proof till", openingCashMinor: 0, idempotencyKey: crypto.randomUUID(), operatingContext: context });
    const workspace = await call<{ products: Array<{ id: string; unitPriceMinor: number; vatRateBasisPoints: number }> }>(branchManager, "getPosWorkspace", { branchId, operatingContext: context });
    const product = workspace.products.find(item => item.id === productId)!;
    const gross = product.unitPriceMinor + Math.round(product.unitPriceMinor * product.vatRateBasisPoints / 10000);
    const saleInput = { branchId, shiftId: shift.shiftId, deviceId, lines: [{ productId, quantity: 1 }], recordedAt: new Date().toISOString(), offline: false, operatingContext: context };
    const original = await call<{ saleId: string }>(branchManager, "commitPosSale", { ...saleInput, payments: [{ method: "cash", amountMinor: gross }], idempotencyKey: crypto.randomUUID() });
    const originalSnapshot = await adminDb.doc(`sales/${original.saleId}`).get();
    const request = { action: "request", branchId, receiptNumber: originalSnapshot.get("receiptNumber"), reason: "Original order entered incorrectly; controlled reissue", proposedValues: { customerId: null, discountAmountMinor: 0, details: "Return goods for inspection and reissue the correct order", lines: [{ productId, quantity: 1, unitPriceMinor: product.unitPriceMinor }] }, idempotencyKey: crypto.randomUUID(), operatingContext: context };
    await expect(call(branchManager, "salesCorrections", { ...request, proposedValues: { ...request.proposedValues, discountAmountMinor: product.unitPriceMinor } })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    const sourceItem = (await adminDb.collection("saleItems").where("saleId", "==", original.saleId).get()).docs[0]!;
    const priorReturn = adminDb.doc(`saleReturnItemCounters/${uniquenessDocumentId(organizationId, "saleReturnItem", sourceItem.id)}`);
    await priorReturn.set({ organizationId, returnedQuantity: 1 });
    await expect(call(branchManager, "salesCorrections", request)).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await priorReturn.delete();
    const rejected = await call<{ correctionId: string }>(branchManager, "salesCorrections", request);
    await expect(call(branchManager, "salesCorrections", request)).resolves.toMatchObject(rejected);
    await expect(call(branchManager, "salesCorrections", { ...request, reason: "Changed instructions with same retry reference" })).rejects.toMatchObject({ code: "functions/already-exists" });
    const review = { action: "review", correctionId: rejected.correctionId, decision: "rejected", reason: "Reject this initial proposal before resubmission", idempotencyKey: crypto.randomUUID(), operatingContext: context };
    await expect(call(cashier, "salesCorrections", review)).rejects.toMatchObject({ code: "functions/permission-denied" });
    await call(branchManager, "salesCorrections", review);
    const accepted = await call<{ correctionId: string }>(branchManager, "salesCorrections", { ...request, idempotencyKey: crypto.randomUUID() });
    await expect(call(branchManager, "salesCorrections", { ...request, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    const completion = { action: "complete", correctionId: accepted.correctionId, returnNumbers: ["missing-return"], replacementNumber: originalSnapshot.get("saleNumber"), reason: "Verify all reversal and replacement evidence", idempotencyKey: crypto.randomUUID(), operatingContext: context };
    await expect(call(branchManager, "salesCorrections", completion)).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await priorReturn.set({ organizationId, returnedQuantity: 1 });
    await expect(call(branchManager, "salesCorrections", { ...review, correctionId: accepted.correctionId, decision: "approved", idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await priorReturn.delete();
    await call(branchManager, "salesCorrections", { ...review, correctionId: accepted.correctionId, decision: "approved", reason: "Approve full controlled return and reissue", idempotencyKey: crypto.randomUUID() });
    expect((await adminDb.doc(`sales/${original.saleId}`).get()).data()).toEqual(originalSnapshot.data());
    await expect(call(branchManager, "salesCorrections", completion)).rejects.toMatchObject({ code: "functions/not-found" });
    const originalItem = (await adminDb.collection("saleItems").where("saleId", "==", original.saleId).get()).docs[0]!;
    const returned = await call<{ returnId: string; returnNumber: string }>(branchManager, "createSaleReturn", { branchId, saleId: original.saleId, lines: [{ saleItemId: originalItem.id, quantity: 1, condition: "restockable" }], resolution: "exchange_credit", reason: "Goods genuinely returned for approved correction", idempotencyKey: crypto.randomUUID(), operatingContext: context });
    await inspectReturnedGoods(branchManager, returned.returnId);
    const credit = await call<{ creditId: string }>(branchManager, "approveSaleReturn", { returnId: returned.returnId, idempotencyKey: crypto.randomUUID(), operatingContext: context });
    const replacement = await call<{ saleId: string }>(branchManager, "commitPosSale", { ...saleInput, payments: [{ method: "exchange_credit", reference: credit.creditId, amountMinor: gross }], idempotencyKey: crypto.randomUUID() });
    const replacementSnapshot = await adminDb.doc(`sales/${replacement.saleId}`).get();
    const finished = { ...completion, returnNumbers: [returned.returnNumber], replacementNumber: replacementSnapshot.get("saleNumber") };
    await expect(call(branchManager, "salesCorrections", { ...finished, replacementNumber: originalSnapshot.get("saleNumber") })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    const replacementItem = (await adminDb.collection("saleItems").where("saleId", "==", replacement.saleId).get()).docs[0]!;
    await replacementItem.ref.update({ unitPriceMinor: product.unitPriceMinor + 1 });
    await expect(call(branchManager, "salesCorrections", finished)).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await replacementItem.ref.update({ unitPriceMinor: product.unitPriceMinor });
    const journal = (await adminDb.collection("journalEntries").where("referenceId", "==", replacement.saleId).get()).docs[0]!;
    await journal.ref.update({ totalDebitMinor: Number(journal.get("totalDebitMinor")) + 1 });
    await expect(call(branchManager, "salesCorrections", finished)).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await journal.ref.update({ totalDebitMinor: journal.get("totalDebitMinor") });
    await expect(call(branchManager, "salesCorrections", finished)).resolves.toMatchObject({ status: "completed" });
    await expect(call(branchManager, "salesCorrections", finished)).resolves.toMatchObject({ status: "completed" });
    const record = await adminDb.doc(`saleCorrectionRequests/${accepted.correctionId}`).get();
    expect(record.data()).toMatchObject({ status: "completed", saleId: original.saleId, returnIds: [returned.returnId], replacementSaleId: replacement.saleId });
    expect(record.get("journalEntryIds")).toHaveLength(2);
    expect((await adminDb.doc(`saleCorrectionRequests/${rejected.correctionId}`).get()).get("status")).toBe("rejected");
    const page = await call<{ records: Array<{ id: string }> }>(branchManager, "salesCorrections", { action: "list", branchId, status: "completed", limit: 25, operatingContext: context });
    expect(page.records.some(item => item.id === accepted.correctionId)).toBe(true);
  }, 120000);
});
