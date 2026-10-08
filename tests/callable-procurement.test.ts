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
  getAdminApps().find((app) => app.name === "procurement-callable-tests") ??
  initializeAdminApp({ projectId }, "procurement-callable-tests");
const adminAuth = getAdminAuth(adminApp),
  adminDb = getFirestore(adminApp),
  apps: FirebaseApp[] = [];
const organizationId = "procurement-test-org",
  warehouseId = "warehouse-procurement",
  locationId = "procurement-receiving",
  headOfficeId = "branch-head-office",
  headOfficeLocationId = "head-office-receiving",
  productId = "product-procurement";
const bankAccountId = "procurement-bank-account";
let administrator: ReturnType<typeof client>,
  warehouseManager: ReturnType<typeof client>,
  headOfficeManager: ReturnType<typeof client>;

function client(name: string) {
  const app = initializeApp(
    { projectId, apiKey: "demo", appId: `procurement-${name}` },
    `procurement-${name}`,
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
    roleIds:
      roleId === "branch_manager"
        ? ["warehouse_manager", "branch_manager"]
        : [roleId],
    branchIds: roleId === "branch_manager" ? [headOfficeId] : [],
    warehouseIds: roleId === "warehouse_manager" ? [warehouseId] : [],
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
  await adminDb.doc(`organizations/${organizationId}`).set({ name: "Procurement test organization", status: "active" });
  administrator = await createActor(
    "procurement-admin@example.test",
    "system_administrator",
  );
  warehouseManager = await createActor(
    "procurement-warehouse@example.test",
    "warehouse_manager",
  );
  headOfficeManager = await createActor(
    "procurement-head-office@example.test",
    "branch_manager",
  );
  const now = FieldValue.serverTimestamp();
  await Promise.all([
    adminDb.doc(`bankAccounts/${bankAccountId}`).set({
      organizationId,
      bankName: "Test Bank",
      accountName: "Purchasing",
      accountNumberLast4: "5678",
      ledgerAccountCode: "1041",
      active: true,
      createdAt: now,
      updatedAt: now,
    }),
    adminDb.doc(`warehouses/${warehouseId}`).set({
      organizationId,
      name: "Central Warehouse",
      code: "CWH",
      status: "active",
      createdAt: now,
      updatedAt: now,
    }),
    adminDb.doc(`branches/${headOfficeId}`).set({
      organizationId,
      name: "Head Office",
      code: "HO",
      branchType: "head_office",
      status: "active",
      createdAt: now,
      updatedAt: now,
    }),
    adminDb.doc(`inventoryLocations/${headOfficeLocationId}`).set({
      organizationId,
      branchId: headOfficeId,
      name: "Head Office Stock",
      code: "HO-STOCK",
      type: "branch",
      status: "active",
      createdAt: now,
      updatedAt: now,
    }),
    adminDb.doc(`inventoryLocations/${locationId}`).set({
      organizationId,
      warehouseId,
      name: "Receiving Bay",
      code: "CWH-REC",
      type: "receiving",
      status: "active",
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
      hasLedgerActivity: false,
      createdAt: now,
      updatedAt: now,
    }),
    adminDb.doc(`productCosts/${productId}`).set({
      organizationId,
      productId,
      defaultUnitCostMinor: 10_000,
      currency: "NGN",
      createdAt: now,
      updatedAt: now,
    }),
  ]);
});
afterAll(async () => Promise.all(apps.map((app) => deleteApp(app))));

describe.sequential("procurement callables", () => {
  it("receives a purchase directly into Head Office without creating a warehouse", async () => {
    const supplier = await call<{ supplierId: string }>(
      administrator,
      "saveSupplier",
      {
        name: "Head Office Supply Partner",
        phone: "07011112222",
        paymentTermsDays: 0,
        active: true,
        idempotencyKey: crypto.randomUUID(),
      },
    );
    const context = { type: "branch", id: headOfficeId };
    const workspace = await call<{
      branches: Array<{ id: string; branchType: string }>;
      locations: Array<{ id: string; branchId?: string }>;
    }>(headOfficeManager, "getProcurementWorkspace", {
      branchId: headOfficeId,
      operatingContext: context,
    });
    expect(workspace.branches).toContainEqual(
      expect.objectContaining({ id: headOfficeId, branchType: "head_office" }),
    );
    expect(workspace.locations).toContainEqual(
      expect.objectContaining({ id: headOfficeLocationId, branchId: headOfficeId }),
    );
    const order = await call<{
      purchaseOrderId: string;
      purchaseOrderNumber: string;
    }>(headOfficeManager, "createPurchaseOrder", {
      supplierId: supplier.supplierId,
      branchId: headOfficeId,
      receivingLocationId: headOfficeLocationId,
      lines: [
        {
          productId,
          quantity: 2,
          unitCostMinor: 12_000,
          vatRateBasisPoints: 0,
        },
      ],
      idempotencyKey: crypto.randomUUID(),
      operatingContext: context,
    });
    expect(order.purchaseOrderNumber).toMatch(/^PO-HO-/);
    await call(headOfficeManager, "submitPurchaseOrder", {
      purchaseOrderId: order.purchaseOrderId,
      idempotencyKey: crypto.randomUUID(),
      operatingContext: context,
    });
    await call(headOfficeManager, "approvePurchaseOrder", {
      purchaseOrderId: order.purchaseOrderId,
      idempotencyKey: crypto.randomUUID(),
      operatingContext: context,
    });
    const item = (
      await adminDb
        .collection("purchaseOrderItems")
        .where("purchaseOrderId", "==", order.purchaseOrderId)
        .get()
    ).docs[0]!;
    await call(headOfficeManager, "receivePurchaseOrderItem", {
      purchaseOrderId: order.purchaseOrderId,
      purchaseOrderItemId: item.id,
      quantity: 2,
      receivedAt: new Date().toISOString(),
      serialNumbers: [],
      idempotencyKey: crypto.randomUUID(),
      operatingContext: context,
    });
    const [savedOrder, balance] = await Promise.all([
      adminDb.doc(`purchaseOrders/${order.purchaseOrderId}`).get(),
      adminDb
        .doc(
          `inventoryBalances/${balanceDocumentId(organizationId, productId, headOfficeLocationId)}`,
        )
        .get(),
    ]);
    expect(savedOrder.data()).toMatchObject({
      branchId: headOfficeId,
      operationalLocationType: "head_office",
      operationalLocationId: headOfficeId,
    });
    expect(savedOrder.data()).not.toHaveProperty("warehouseId");
    expect(balance.data()).toMatchObject({
      branchId: headOfficeId,
      onHandQuantity: 2,
      availableQuantity: 2,
    });
  });

  it("matches approved purchasing, receipt, supplier invoice, AP, and payment without over-receipt", async () => {
    const supplier = await call<{ supplierId: string; supplierNumber: string }>(
      administrator,
      "saveSupplier",
      {
        name: "Northern Solar Imports Ltd",
        phone: "07012345678",
        paymentTermsDays: 30,
        active: true,
        idempotencyKey: crypto.randomUUID(),
      },
    );
    expect(supplier.supplierNumber).toMatch(/^SUP-/);
    const order = await call<{
      purchaseOrderId: string;
      purchaseOrderNumber: string;
    }>(warehouseManager, "createPurchaseOrder", {
      supplierId: supplier.supplierId,
      warehouseId,
      receivingLocationId: locationId,
      lines: [
        {
          productId,
          quantity: 5,
          unitCostMinor: 10_000,
          vatRateBasisPoints: 750,
        },
      ],
      idempotencyKey: crypto.randomUUID(),
      operatingContext: { type: "warehouse", id: warehouseId },
    });
    expect(order.purchaseOrderNumber).toMatch(/^PO-CWH-/);
    await call(warehouseManager, "submitPurchaseOrder", {
      purchaseOrderId: order.purchaseOrderId,
      idempotencyKey: crypto.randomUUID(),
      operatingContext: { type: "warehouse", id: warehouseId },
    });
    await expect(
      call(warehouseManager, "approvePurchaseOrder", {
        purchaseOrderId: order.purchaseOrderId,
        idempotencyKey: crypto.randomUUID(),
        operatingContext: { type: "warehouse", id: warehouseId },
      }),
    ).resolves.toMatchObject({ status: "approved" });
    const orderAudit = await adminDb
      .collection("auditLogs")
      .where("entityId", "==", order.purchaseOrderId)
      .where("action", "==", "purchase_order.approved")
      .get();
    expect(orderAudit.docs[0]?.get("actorUserId")).toBe(
      warehouseManager.auth.currentUser!.uid,
    );

    const items = await adminDb
        .collection("purchaseOrderItems")
        .where("purchaseOrderId", "==", order.purchaseOrderId)
        .get(),
      item = items.docs[0]!;
    const receipt = await call<{
      inventoryTransactionId: string;
      posted: boolean;
    }>(warehouseManager, "receivePurchaseOrderItem", {
      purchaseOrderId: order.purchaseOrderId,
      purchaseOrderItemId: item.id,
      quantity: 5,
      receivedAt: new Date().toISOString(),
      supplierReference: "DEL-001",
      serialNumbers: [],
      idempotencyKey: crypto.randomUUID(),
      operatingContext: { type: "warehouse", id: warehouseId },
    });
    expect(receipt.posted).toBe(true);
    const balance = await adminDb
      .doc(
        `inventoryBalances/${balanceDocumentId(organizationId, productId, locationId)}`,
      )
      .get();
    expect(balance.data()).toMatchObject({
      onHandQuantity: 5,
      availableQuantity: 5,
      totalValueMinor: 50_000,
    });
    await expect(
      call(warehouseManager, "receivePurchaseOrderItem", {
        purchaseOrderId: order.purchaseOrderId,
        purchaseOrderItemId: item.id,
        quantity: 1,
        receivedAt: new Date().toISOString(),
        serialNumbers: [],
        idempotencyKey: crypto.randomUUID(),
        operatingContext: { type: "warehouse", id: warehouseId },
      }),
    ).rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect((await balance.ref.get()).get("onHandQuantity")).toBe(5);

    const invoice = await call<{ supplierInvoiceId: string }>(
      warehouseManager,
      "submitSupplierInvoice",
      {
        purchaseOrderId: order.purchaseOrderId,
        supplierInvoiceNumber: "NSI-INV-001",
        invoiceDate: new Date().toISOString().slice(0, 10),
        lines: [{ purchaseOrderItemId: item.id, quantity: 5 }],
        idempotencyKey: crypto.randomUUID(),
        operatingContext: { type: "warehouse", id: warehouseId },
      },
    );
    await expect(
      call(warehouseManager, "approveSupplierInvoice", {
        supplierInvoiceId: invoice.supplierInvoiceId,
        idempotencyKey: crypto.randomUUID(),
        operatingContext: { type: "warehouse", id: warehouseId },
      }),
    ).resolves.toMatchObject({ approved: true });
    const [approvedInvoice, supplierRecord, invoiceJournal] = await Promise.all(
      [
        adminDb.doc(`supplierInvoices/${invoice.supplierInvoiceId}`).get(),
        adminDb.doc(`suppliers/${supplier.supplierId}`).get(),
        adminDb
          .collection("journalEntries")
          .where("referenceId", "==", invoice.supplierInvoiceId)
          .get(),
      ],
    );
    expect(approvedInvoice.data()).toMatchObject({
      status: "approved",
      netAmountMinor: 50_000,
      vatAmountMinor: 3_750,
      grossAmountMinor: 53_750,
      outstandingAmountMinor: 53_750,
    });
    expect(supplierRecord.get("outstandingBalanceMinor")).toBe(53_750);
    expect(invoiceJournal.docs[0]!.get("totalDebitMinor")).toBe(
      invoiceJournal.docs[0]!.get("totalCreditMinor"),
    );

    const payment = await call<{ paymentId: string; recorded: boolean }>(
      warehouseManager,
      "recordSupplierPayment",
      {
        supplierId: supplier.supplierId,
        method: "bank_transfer",
        bankAccountId,
        reference: "BANK-PAY-001",
        allocations: [
          { supplierInvoiceId: invoice.supplierInvoiceId, amountMinor: 53_750 },
        ],
        paidAt: new Date().toISOString(),
        idempotencyKey: crypto.randomUUID(),
        operatingContext: { type: "warehouse", id: warehouseId },
      },
    );
    expect(payment.recorded).toBe(true);
    expect((await approvedInvoice.ref.get()).data()).toMatchObject({
      status: "paid",
      outstandingAmountMinor: 0,
    });
    expect(
      (await supplierRecord.ref.get()).get("outstandingBalanceMinor"),
    ).toBe(0);
    const paymentJournal = await adminDb
      .collection("journalEntries")
      .where("referenceId", "==", payment.paymentId)
      .get();
    expect(paymentJournal.docs[0]!.get("totalDebitMinor")).toBe(
      paymentJournal.docs[0]!.get("totalCreditMinor"),
    );
    expect((await adminDb.doc(`supplierPayments/${payment.paymentId}`).get()).data())
      .toMatchObject({ bankAccountId, ledgerAccountCode: "1041" });
    const paymentLines = await adminDb.collection("journalLines")
      .where("journalEntryId", "==", paymentJournal.docs[0]!.id).get();
    expect(paymentLines.docs.map((line) => line.get("accountCode"))).toContain("1041");
  });

  it("ages current supplier debt without guessing legacy dates and pages unpaid invoices", async () => {
    const supplierId = "aging-supplier";
    await adminDb.doc(`suppliers/${supplierId}`).set({ organizationId, name: "Aging supplier", active: true, outstandingBalanceMinor: 2100 });
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const ago = (days: number) => new Date(Date.parse(`${today}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
    for (const [index, days] of [0, 30, 60, 90, 91, null].entries()) {
      await adminDb.doc(`supplierInvoices/aging-${index}`).set({ organizationId, supplierId, branchId: headOfficeId, status: index === 1 ? "partially_paid" : "approved", outstandingAmountMinor: (index + 1) * 100, supplierInvoiceNumber: `AGING-${index}`, ...(days === null ? {} : { dueDate: ago(days) }) });
    }
    await adminDb.doc("supplierInvoices/aging-paid").set({ organizationId, supplierId, branchId: headOfficeId, status: "paid", outstandingAmountMinor: 9999, dueDate: ago(10) });
    await adminDb.doc("supplierInvoices/aging-other").set({ organizationId, supplierId, warehouseId, status: "approved", outstandingAmountMinor: 700, dueDate: ago(10) });
    const input = { view: "supplier_payables", supplierId, branchId: headOfficeId, limit: 1 };
    type Payables = { invoices: { id: string }[]; nextCursor: string | null; totalOutstandingMinor: number; aging: { name: string; amountMinor: number }[] };
    const first = await call<Payables>(headOfficeManager, "getProcurementWorkspace", input);
    expect(first.invoices).toHaveLength(1);
    expect(first.totalOutstandingMinor).toBe(2100);
    expect(first.aging.map((bucket) => bucket.amountMinor)).toEqual([100, 200, 300, 400, 500, 600]);
    const second = await call<Payables>(headOfficeManager, "getProcurementWorkspace", { ...input, cursor: first.nextCursor });
    expect(second.invoices[0]!.id).not.toBe(first.invoices[0]!.id);
    expect(second.totalOutstandingMinor).toBe(2100);
    expect((await adminDb.doc("supplierInvoices/aging-5").get()).get("dueDate")).toBeUndefined();
    await expect(call(warehouseManager, "getProcurementWorkspace", input)).rejects.toThrow();
    await expect(call(headOfficeManager, "getProcurementWorkspace", { ...input, cursor: "aging-other" })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    await call(headOfficeManager, "recordSupplierPayment", { supplierId, branchId: headOfficeId, method: "cash", allocations: [{ supplierInvoiceId: "aging-0", amountMinor: 100 }], paidAt: new Date().toISOString(), idempotencyKey: crypto.randomUUID() });
    const afterPayment = await call<Payables>(headOfficeManager, "getProcurementWorkspace", input);
    expect(afterPayment.totalOutstandingMinor).toBe(2000);
    expect(afterPayment.aging[0]!.amountMinor).toBe(0);
    await expect(call(headOfficeManager, "getProcurementWorkspace", { ...input, cursor: "aging-0" })).rejects.toMatchObject({ code: "functions/invalid-argument" });
  });

  it("keeps supplier advances separate, applies partial amounts once and preserves paginated statements", async () => {
    const { supplierId } = await call<{ supplierId: string }>(administrator, "saveSupplier", {
      name: "Advance Supplier", phone: "07033334444", active: true, idempotencyKey: crypto.randomUUID(),
    });
    const advance = { supplierId, branchId: headOfficeId, purpose: "advance", amountMinor: 40_000,
      method: "bank_transfer", bankAccountId, reference: "ADV-001", paidAt: new Date().toISOString(), idempotencyKey: crypto.randomUUID() };
    const [first, retry] = await Promise.all([
      call<{ paymentId: string; recorded: boolean }>(headOfficeManager, "recordSupplierPayment", advance),
      call<{ paymentId: string; recorded: boolean }>(headOfficeManager, "recordSupplierPayment", advance),
    ]);
    expect(first.paymentId).toBe(retry.paymentId);
    expect([first.recorded, retry.recorded].sort()).toEqual([false, true]);
    const supplier = adminDb.doc(`suppliers/${supplierId}`);
    expect((await supplier.get()).data()).toMatchObject({ outstandingBalanceMinor: 0, advanceBalanceMinor: 40_000 });
    const advancePayment = await adminDb.doc(`supplierPayments/${first.paymentId}`).get();
    const lines = await adminDb.collection("journalLines").where("journalEntryId", "==", advancePayment.get("journalEntryId")).get();
    expect(lines.docs.map((line) => [line.get("accountCode"), line.get("debitMinor"), line.get("creditMinor")])).toEqual(expect.arrayContaining([["1250", 40_000, 0], ["1041", 0, 40_000]]));
    expect(lines.docs.every((line) => line.get("branchId") === headOfficeId)).toBe(true);
    // Existing approved invoice fixtures; the preceding test covers actual PO → GRN → invoice posting.
    const invoices = [adminDb.collection("supplierInvoices").doc(), adminDb.collection("supplierInvoices").doc()];
    await supplier.update({ outstandingBalanceMinor: 30_000 });
    for (const [index, invoice] of invoices.entries()) {
      const amount = index === 0 ? 20_000 : 10_000;
      await invoice.set({ organizationId, supplierId, branchId: headOfficeId, status: "approved", outstandingAmountMinor: amount, supplierInvoiceNumber: `ADV-INV-${index}`, createdAt: FieldValue.serverTimestamp() });
      await adminDb.collection("supplierAccountEntries").add({ organizationId, supplierId, branchId: headOfficeId, entryType: "supplier_invoice", referenceNumber: `ADV-INV-${index}`, amountMinor: amount, effectiveAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp() });
    }
    const application = { supplierId, branchId: headOfficeId, source: "advance_balance", method: "cash", allocations: [{ supplierInvoiceId: invoices[0]!.id, amountMinor: 10_000 }], paidAt: new Date().toISOString(), idempotencyKey: crypto.randomUUID() };
    const applied = await call<{ paymentId: string }>(headOfficeManager, "recordSupplierPayment", application);
    expect((await supplier.get()).data()).toMatchObject({ outstandingBalanceMinor: 20_000, advanceBalanceMinor: 30_000 });
    expect((await invoices[0]!.get()).data()).toMatchObject({ status: "partially_paid", outstandingAmountMinor: 10_000 });
    const applicationPayment = await adminDb.doc(`supplierPayments/${applied.paymentId}`).get();
    expect(applicationPayment.get("method")).toBe("supplier_advance");
    expect(applicationPayment.get("bankAccountId")).toBeUndefined();
    const applicationLines = await adminDb.collection("journalLines").where("journalEntryId", "==", applicationPayment.get("journalEntryId")).get();
    expect(applicationLines.docs.map((line) => [line.get("accountCode"), line.get("debitMinor"), line.get("creditMinor")])).toEqual(expect.arrayContaining([["2000", 10_000, 0], ["1250", 0, 10_000]]));
    await call(headOfficeManager, "recordSupplierPayment", { supplierId, branchId: headOfficeId, method: "cash", allocations: [{ supplierInvoiceId: invoices[1]!.id, amountMinor: 5_000 }], paidAt: new Date().toISOString(), idempotencyKey: crypto.randomUUID() });
    const concurrent = await Promise.allSettled([1, 2].map(() => call(headOfficeManager, "recordSupplierPayment", { ...application, idempotencyKey: crypto.randomUUID() })));
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await supplier.get()).data()).toMatchObject({ outstandingBalanceMinor: 5_000, advanceBalanceMinor: 20_000 });
    expect((await supplier.get()).get("advanceBalancesByLocation")).toEqual({ [`branch:${headOfficeId}`]: 20_000 });
    const otherStorePayment = { supplierId, warehouseId, source: "advance_balance", method: "cash", paidAt: new Date().toISOString() };
    await expect(call(administrator, "recordSupplierPayment", { ...otherStorePayment, allocations: [{ supplierInvoiceId: invoices[1]!.id, amountMinor: 1_000 }], idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    await expect(call(headOfficeManager, "recordSupplierPayment", { ...application, allocations: [{ supplierInvoiceId: invoices[1]!.id, amountMinor: 6_000 }], idempotencyKey: crypto.randomUUID() })).rejects.toThrow();
    await expect(call(warehouseManager, "recordSupplierPayment", { ...application, idempotencyKey: crypto.randomUUID() })).rejects.toThrow();
    const statement = await call<{ entries: unknown[]; nextCursor: string; closingPayableMinor: number; closingAdvanceMinor: number }>(headOfficeManager, "getProcurementWorkspace", { view: "supplier_account", supplierId, branchId: headOfficeId, limit: 1 });
    expect(statement.entries).toHaveLength(1);
    expect(statement.nextCursor).toBeTruthy();
    expect(statement.closingPayableMinor).toBe(5_000);
    expect(statement.closingAdvanceMinor).toBe(20_000);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const future = await call<{ entries: unknown[]; openingPayableMinor: number; closingPayableMinor: number; openingAdvanceMinor: number; closingAdvanceMinor: number }>(headOfficeManager, "getProcurementWorkspace", { view: "supplier_account", supplierId, branchId: headOfficeId, from: tomorrow, limit: 25 });
    expect(future).toMatchObject({ entries: [], openingPayableMinor: 5_000, closingPayableMinor: 5_000, openingAdvanceMinor: 20_000, closingAdvanceMinor: 20_000 });
    const page = await call<{ entries: Array<{ id: string }> }>(headOfficeManager, "getProcurementWorkspace", { view: "supplier_account", supplierId, branchId: headOfficeId, limit: 1, cursor: statement.nextCursor });
    expect(page.entries[0]!.id).not.toBe(statement.nextCursor);
    await expect(call(headOfficeManager, "getProcurementWorkspace", { view: "supplier_account", supplierId })).rejects.toThrow();
    await expect(call(warehouseManager, "getProcurementWorkspace", { view: "supplier_account", supplierId, branchId: headOfficeId })).rejects.toThrow();
    expect((await adminDb.collection("supplierPayments").where("supplierId", "==", supplierId).get()).size).toBe(4);
    const otherStoreInvoice = adminDb.collection("supplierInvoices").doc();
    await otherStoreInvoice.set({ organizationId, supplierId, warehouseId, status: "approved", outstandingAmountMinor: 1_000, supplierInvoiceNumber: "OTHER-STORE" });
    await supplier.update({ outstandingBalanceMinor: 6_000 });
    await expect(call(administrator, "recordSupplierPayment", { ...otherStorePayment, allocations: [{ supplierInvoiceId: otherStoreInvoice.id, amountMinor: 1_000 }], idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect((await supplier.get()).get("advanceBalancesByLocation")).toEqual({ [`branch:${headOfficeId}`]: 20_000 });
    await supplier.update({ active: false });
    const workspace = await call<{ suppliers: Array<{ id: string; active: boolean }> }>(headOfficeManager, "getProcurementWorkspace", { branchId: headOfficeId });
    expect(workspace.suppliers).toContainEqual(expect.objectContaining({ id: supplierId, active: false }));
    await expect(call(headOfficeManager, "recordSupplierPayment", { ...advance, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
  });
});
