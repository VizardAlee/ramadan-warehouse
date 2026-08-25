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

  it("requires administrator-approved credit, posts receivables, enforces the limit, and records repayment", async () => {
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
      expect.objectContaining({ id: saved.customerId, availableCreditMinor: 20_000 }),
    );
    const shift = await adminDb
      .collection("posShifts")
      .where("branchId", "==", branchId)
      .where("status", "==", "open")
      .limit(1)
      .get();
    const currentShift = shift.docs[0]!;
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
        creditAmountMinor: 12_900,
        lines: [{ productId, quantity: 1 }],
        payments: [],
        idempotencyKey: crypto.randomUUID(),
        operatingContext: { type: "branch", id: branchId },
      },
    );
    expect(sale.posted).toBe(true);
    const [saleRecord, customer, receivableLines, accountEntries] = await Promise.all([
      adminDb.doc(`sales/${sale.saleId}`).get(),
      adminDb.doc(`customers/${saved.customerId}`).get(),
      adminDb.collection("journalLines").where("journalEntryId", "==", (
        await adminDb.collection("journalEntries").where("referenceId", "==", sale.saleId).limit(1).get()
      ).docs[0]!.id).get(),
      adminDb.collection("customerAccountEntries").where("referenceId", "==", sale.saleId).get(),
    ]);
    expect(saleRecord.data()).toMatchObject({
      customerId: saved.customerId,
      paymentStatus: "credit",
      creditAmountMinor: 12_900,
      amountPaidMinor: 0,
    });
    expect(customer.data()).toMatchObject({
      outstandingBalanceMinor: 12_900,
      availableCreditMinor: 7_100,
    });
    expect(receivableLines.docs.some((line) => line.get("accountCode") === "1100" && line.get("debitMinor") === 12_900)).toBe(true);
    expect(accountEntries.size).toBe(1);

    const stockBeforeRejectedSale = await adminDb
      .doc(`inventoryBalances/${balanceDocumentId(organizationId, productId, locationId)}`)
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
    expect((await stockBeforeRejectedSale.ref.get()).get("onHandQuantity")).toBe(
      stockBeforeRejectedSale.get("onHandQuantity"),
    );

    await expect(
      call(branchManager, "recordCustomerPayment", {
        customerId: saved.customerId,
        branchId,
        method: "bank_transfer",
        amountMinor: 5_000,
        reference: "BANK-CR-001",
        idempotencyKey: crypto.randomUUID(),
        operatingContext: { type: "branch", id: branchId },
      }),
    ).resolves.toMatchObject({ recorded: true });
    expect((await adminDb.doc(`customers/${saved.customerId}`).get()).data()).toMatchObject({
      outstandingBalanceMinor: 7_900,
      availableCreditMinor: 12_100,
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
        lines: [{ productId, quantity: 1, unitPriceMinor: 12_000, vatRateBasisPoints: 750, priceVersion: 2 }],
        payments: [],
        idempotencyKey: crypto.randomUUID(),
        operatingContext: { type: "branch", id: branchId },
      }),
    ).rejects.toMatchObject({ code: "functions/invalid-argument" });
  });

  it("uses independent approval to restock a receipt return and redeem its exchange credit once", async () => {
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
    await expect(
      call(branchManager, "approveSaleReturn", {
        returnId: submitted.returnId,
        idempotencyKey: crypto.randomUUID(),
        operatingContext: { type: "branch", id: branchId },
      }),
    ).rejects.toMatchObject({ code: "functions/permission-denied" });

    const balanceReference = adminDb.doc(
      `inventoryBalances/${balanceDocumentId(organizationId, productId, locationId)}`,
    );
    const beforeApproval = await balanceReference.get();
    const approved = await call<{ creditId: string; approved: boolean }>(
      administrator,
      "approveSaleReturn",
      {
        returnId: submitted.returnId,
        notes: "Item inspected and sealed",
        idempotencyKey: crypto.randomUUID(),
      },
    );
    expect(approved).toMatchObject({ approved: true });
    expect(approved.creditId).toBeTruthy();
    const [afterApproval, returnRecord, creditRecord, returnInventory, returnJournal] =
      await Promise.all([
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

    const openShift = await adminDb
      .collection("posShifts")
      .where("branchId", "==", branchId)
      .where("status", "==", "open")
      .limit(1)
      .get();
    const shift = openShift.docs[0]!;
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
});
