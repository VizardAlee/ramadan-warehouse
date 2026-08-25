import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { getApps as getAdminApps, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { balanceDocumentId } from "../functions/src/inventory/calculations";

const projectId = "demo-ramadan-warehouse";
const adminApp = getAdminApps().find((app) => app.name === "procurement-callable-tests") ?? initializeAdminApp({ projectId }, "procurement-callable-tests");
const adminAuth = getAdminAuth(adminApp), adminDb = getFirestore(adminApp), apps: FirebaseApp[] = [];
const organizationId = "procurement-test-org", warehouseId = "warehouse-procurement", locationId = "procurement-receiving", productId = "product-procurement";
let administrator: ReturnType<typeof client>, warehouseManager: ReturnType<typeof client>, financeOfficer: ReturnType<typeof client>;

function client(name: string) {
  const app = initializeApp({ projectId, apiKey: "demo", appId: `procurement-${name}` }, `procurement-${name}`); apps.push(app);
  const auth = getAuth(app); connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const functions = getFunctions(app, "us-central1"); connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  return { auth, functions };
}
async function call<T = Record<string, unknown>>(target: ReturnType<typeof client>, name: string, data: Record<string, unknown>) {
  return (await httpsCallable(target.functions, name)(data)).data as T;
}
async function createActor(email: string, roleId: string) {
  const record = await adminAuth.createUser({ email, password: "Password!234567", displayName: roleId });
  await adminDb.doc(`users/${record.uid}`).set({ uid: record.uid, organizationId, email, displayName: roleId, roleId, branchIds: [], warehouseIds: roleId === "warehouse_manager" ? [warehouseId] : [], status: "active", authDisabled: false, authorizationVersion: 1, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  const result = client(email.replaceAll(/[^a-z]/g, "-")); await signInWithEmailAndPassword(result.auth, email, "Password!234567"); return result;
}

beforeAll(async () => {
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${projectId}/accounts`, { method: "DELETE" });
  await fetch(`http://127.0.0.1:8180/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" });
  administrator = await createActor("procurement-admin@example.test", "system_administrator");
  warehouseManager = await createActor("procurement-warehouse@example.test", "warehouse_manager");
  financeOfficer = await createActor("procurement-finance@example.test", "finance_officer");
  const now = FieldValue.serverTimestamp();
  await Promise.all([
    adminDb.doc(`warehouses/${warehouseId}`).set({ organizationId, name: "Central Warehouse", code: "CWH", status: "active", createdAt: now, updatedAt: now }),
    adminDb.doc(`inventoryLocations/${locationId}`).set({ organizationId, warehouseId, name: "Receiving Bay", code: "CWH-REC", type: "receiving", status: "active", createdAt: now, updatedAt: now }),
    adminDb.doc(`products/${productId}`).set({ organizationId, name: "620W Solar Panel", sku: "PANEL-620", unitOfMeasure: "unit", trackingType: "quantity", active: true, hasLedgerActivity: false, createdAt: now, updatedAt: now }),
    adminDb.doc(`productCosts/${productId}`).set({ organizationId, productId, defaultUnitCostMinor: 10_000, currency: "NGN", createdAt: now, updatedAt: now }),
  ]);
});
afterAll(async () => Promise.all(apps.map((app) => deleteApp(app))));

describe.sequential("procurement callables", () => {
  it("matches approved purchasing, receipt, supplier invoice, AP, and payment without over-receipt", async () => {
    const supplier = await call<{ supplierId: string; supplierNumber: string }>(administrator, "saveSupplier", { name: "Northern Solar Imports Ltd", phone: "07012345678", paymentTermsDays: 30, active: true, idempotencyKey: crypto.randomUUID() });
    expect(supplier.supplierNumber).toMatch(/^SUP-/);
    const order = await call<{ purchaseOrderId: string; purchaseOrderNumber: string }>(warehouseManager, "createPurchaseOrder", { supplierId: supplier.supplierId, warehouseId, receivingLocationId: locationId, lines: [{ productId, quantity: 5, unitCostMinor: 10_000, vatRateBasisPoints: 750 }], idempotencyKey: crypto.randomUUID(), operatingContext: { type: "warehouse", id: warehouseId } });
    expect(order.purchaseOrderNumber).toMatch(/^PO-CWH-/);
    await call(warehouseManager, "submitPurchaseOrder", { purchaseOrderId: order.purchaseOrderId, idempotencyKey: crypto.randomUUID(), operatingContext: { type: "warehouse", id: warehouseId } });
    await expect(call(warehouseManager, "approvePurchaseOrder", { purchaseOrderId: order.purchaseOrderId, idempotencyKey: crypto.randomUUID(), operatingContext: { type: "warehouse", id: warehouseId } })).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(call(administrator, "approvePurchaseOrder", { purchaseOrderId: order.purchaseOrderId, idempotencyKey: crypto.randomUUID() })).resolves.toMatchObject({ status: "approved" });

    const items = await adminDb.collection("purchaseOrderItems").where("purchaseOrderId", "==", order.purchaseOrderId).get(), item = items.docs[0]!;
    const receipt = await call<{ inventoryTransactionId: string; posted: boolean }>(warehouseManager, "receivePurchaseOrderItem", { purchaseOrderId: order.purchaseOrderId, purchaseOrderItemId: item.id, quantity: 5, receivedAt: new Date().toISOString(), supplierReference: "DEL-001", serialNumbers: [], idempotencyKey: crypto.randomUUID(), operatingContext: { type: "warehouse", id: warehouseId } });
    expect(receipt.posted).toBe(true);
    const balance = await adminDb.doc(`inventoryBalances/${balanceDocumentId(organizationId, productId, locationId)}`).get();
    expect(balance.data()).toMatchObject({ onHandQuantity: 5, availableQuantity: 5, totalValueMinor: 50_000 });
    await expect(call(warehouseManager, "receivePurchaseOrderItem", { purchaseOrderId: order.purchaseOrderId, purchaseOrderItemId: item.id, quantity: 1, receivedAt: new Date().toISOString(), serialNumbers: [], idempotencyKey: crypto.randomUUID(), operatingContext: { type: "warehouse", id: warehouseId } })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect((await balance.ref.get()).get("onHandQuantity")).toBe(5);

    const invoice = await call<{ supplierInvoiceId: string }>(financeOfficer, "submitSupplierInvoice", { purchaseOrderId: order.purchaseOrderId, supplierInvoiceNumber: "NSI-INV-001", invoiceDate: new Date().toISOString().slice(0, 10), lines: [{ purchaseOrderItemId: item.id, quantity: 5 }], idempotencyKey: crypto.randomUUID() });
    await expect(call(financeOfficer, "approveSupplierInvoice", { supplierInvoiceId: invoice.supplierInvoiceId, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(call(administrator, "approveSupplierInvoice", { supplierInvoiceId: invoice.supplierInvoiceId, idempotencyKey: crypto.randomUUID() })).resolves.toMatchObject({ approved: true });
    const [approvedInvoice, supplierRecord, invoiceJournal] = await Promise.all([adminDb.doc(`supplierInvoices/${invoice.supplierInvoiceId}`).get(), adminDb.doc(`suppliers/${supplier.supplierId}`).get(), adminDb.collection("journalEntries").where("referenceId", "==", invoice.supplierInvoiceId).get()]);
    expect(approvedInvoice.data()).toMatchObject({ status: "approved", netAmountMinor: 50_000, vatAmountMinor: 3_750, grossAmountMinor: 53_750, outstandingAmountMinor: 53_750 });
    expect(supplierRecord.get("outstandingBalanceMinor")).toBe(53_750);
    expect(invoiceJournal.docs[0]!.get("totalDebitMinor")).toBe(invoiceJournal.docs[0]!.get("totalCreditMinor"));

    const payment = await call<{ paymentId: string; recorded: boolean }>(financeOfficer, "recordSupplierPayment", { supplierId: supplier.supplierId, method: "bank_transfer", reference: "BANK-PAY-001", allocations: [{ supplierInvoiceId: invoice.supplierInvoiceId, amountMinor: 53_750 }], paidAt: new Date().toISOString(), idempotencyKey: crypto.randomUUID() });
    expect(payment.recorded).toBe(true);
    expect((await approvedInvoice.ref.get()).data()).toMatchObject({ status: "paid", outstandingAmountMinor: 0 });
    expect((await supplierRecord.ref.get()).get("outstandingBalanceMinor")).toBe(0);
    const paymentJournal = await adminDb.collection("journalEntries").where("referenceId", "==", payment.paymentId).get();
    expect(paymentJournal.docs[0]!.get("totalDebitMinor")).toBe(paymentJournal.docs[0]!.get("totalCreditMinor"));
  });
});
