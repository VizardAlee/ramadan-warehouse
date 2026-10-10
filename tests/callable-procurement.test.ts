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
  connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099"}`, { disableWarnings: true });
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
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099"}/emulator/v1/projects/${projectId}/accounts`,
    { method: "DELETE" },
  );
  await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8180"}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
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
  it("prevents a concurrent supplier credit and replacement from settling the same handed-over unit", async () => {
    const supplier = await call<{ supplierId: string }>(administrator, "saveSupplier", { name: "Replacement race supplier", phone: "07011113333", idempotencyKey: crypto.randomUUID() });
    const product = "replacement-race-product", returnId = "replacement-race-return", itemId = "replacement-race-item", caseId = "replacement-race-case", handoverId = "replacement-race-handover";
    await adminDb.doc(`products/${product}`).set({ organizationId, name: "Warranty race product", sku: "REP-RACE", unitOfMeasure: "unit", trackingType: "quantity", active: true });
    const order = await call<{ purchaseOrderId: string }>(headOfficeManager, "createPurchaseOrder", { supplierId: supplier.supplierId, branchId: headOfficeId, receivingLocationId: headOfficeLocationId, lines: [{ productId: product, quantity: 1, unitCostMinor: 10000, vatRateBasisPoints: 0 }], idempotencyKey: crypto.randomUUID() });
    await call(headOfficeManager, "submitPurchaseOrder", { ...order, idempotencyKey: crypto.randomUUID() });
    await call(headOfficeManager, "approvePurchaseOrder", { ...order, idempotencyKey: crypto.randomUUID() });
    const poLine = (await adminDb.collection("purchaseOrderItems").where("purchaseOrderId", "==", order.purchaseOrderId).get()).docs[0]!;
    const receipt = await call<{ receiptId: string }>(headOfficeManager, "receivePurchaseOrderItem", { ...order, purchaseOrderItemId: poLine.id, quantity: 1, receivedAt: new Date().toISOString(), serialNumbers: [], idempotencyKey: crypto.randomUUID() });
    const invoice = await call<{ supplierInvoiceId: string }>(headOfficeManager, "submitSupplierInvoice", { ...order, supplierInvoiceNumber: "REPLACEMENT-RACE-INV", invoiceDate: new Date().toISOString().slice(0, 10), lines: [{ purchaseOrderItemId: poLine.id, quantity: 1 }], idempotencyKey: crypto.randomUUID() });
    await call(headOfficeManager, "approveSupplierInvoice", { ...invoice, idempotencyKey: crypto.randomUUID() });
    const line = (await adminDb.collection("supplierInvoiceItems").where("supplierInvoiceId", "==", invoice.supplierInvoiceId).get()).docs[0]!;
    const base = { organizationId, branchId: headOfficeId, productId: product, saleId: "replacement-race-sale" };
    await adminDb.doc(`saleReturns/${returnId}`).set({ ...base, status: "approved", inspectionStatus: "completed" });
    await adminDb.doc(`saleReturnItems/${itemId}`).set({ ...base, returnId, condition: "non_restockable", inspectionStatus: "completed", disposition: "warranty" });
    await adminDb.doc(`aftersalesCases/${caseId}`).set({ ...base, returnId, returnItemId: itemId, status: "completed" });
    const handover = adminDb.doc(`inventoryTransactions/${handoverId}`);
    await handover.set({ ...base, saleReturnId: returnId, returnItemId: itemId, aftersalesCaseId: caseId, supplierId: supplier.supplierId, transactionNumber: "INV-REP-RACE", transactionType: "held_return_supplier_handover", status: "posted", trackingType: "quantity", quantity: 1, originalCostMinor: 10000, effectiveAt: Timestamp.now() });
    const credit = { ...invoice, supplierInvoiceItemId: line.id, receiptId: receipt.receiptId, heldHandoverId: handoverId, quantity: 1, creditNoteReference: "REP-RACE-CN", reason: "Supplier accepted credit instead of replacement", returnedAt: new Date().toISOString(), idempotencyKey: crypto.randomUUID() };
    const replacement = { returnId, action: "receive_supplier_replacement", replacement: { handoverId, quantity: 1, supplierReference: "REP-RACE-RECEIPT", confirmedResellable: true, reason: "Inspected same-product replacement unit" }, idempotencyKey: crypto.randomUUID() };
    const outcomes = await Promise.allSettled([call(administrator, "postSupplierReturn", credit), call(administrator, "approveSaleReturn", replacement)]);
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect((await handover.get()).data()).toMatchObject({ supplierSettledQuantity: 1, supplierSettledOriginalCostMinor: 10000, supplierSettlementStatus: "settled" });
    const wasReplacement = outcomes[1]!.status === "fulfilled";
    const balance = await adminDb.doc(`inventoryBalances/${balanceDocumentId(organizationId, product, headOfficeLocationId)}`).get();
    expect(balance.get("onHandQuantity")).toBe(wasReplacement ? 2 : 1);
    expect((await adminDb.doc(`suppliers/${supplier.supplierId}`).get()).get("outstandingBalanceMinor")).toBe(wasReplacement ? 10000 : 0);
  });
  it("settles partial held handovers without issuing stock twice and shares original purchase credit limits", async () => {
    const supplier = await call<{ supplierId: string }>(administrator, "saveSupplier", { name: "Held goods supplier", phone: "07011112222", idempotencyKey: crypto.randomUUID() });
    const product = "held-credit-product";
    await adminDb.doc(`products/${product}`).set({ organizationId, name: "Held credit panel", sku: "HELD-CREDIT", unitOfMeasure: "unit", trackingType: "quantity", active: true });
    await adminDb.doc(`productCosts/${product}`).set({ organizationId, productId: product, defaultUnitCostMinor: 10000 });
    const order = await call<{ purchaseOrderId: string }>(headOfficeManager, "createPurchaseOrder", { supplierId: supplier.supplierId, branchId: headOfficeId, receivingLocationId: headOfficeLocationId, lines: [{ productId: product, quantity: 3, unitCostMinor: 10000, vatRateBasisPoints: 750 }], idempotencyKey: crypto.randomUUID() });
    await call(headOfficeManager, "submitPurchaseOrder", { ...order, idempotencyKey: crypto.randomUUID() });
    await call(headOfficeManager, "approvePurchaseOrder", { ...order, idempotencyKey: crypto.randomUUID() });
    const item = (await adminDb.collection("purchaseOrderItems").where("purchaseOrderId", "==", order.purchaseOrderId).get()).docs[0]!;
    const receipt = await call<{ receiptId: string }>(headOfficeManager, "receivePurchaseOrderItem", { ...order, purchaseOrderItemId: item.id, quantity: 3, receivedAt: new Date().toISOString(), serialNumbers: [], idempotencyKey: crypto.randomUUID() });
    const invoice = await call<{ supplierInvoiceId: string }>(headOfficeManager, "submitSupplierInvoice", { ...order, supplierInvoiceNumber: "HELD-INV-001", invoiceDate: new Date().toISOString().slice(0, 10), lines: [{ purchaseOrderItemId: item.id, quantity: 3 }], idempotencyKey: crypto.randomUUID() });
    await call(headOfficeManager, "approveSupplierInvoice", { ...invoice, idempotencyKey: crypto.randomUUID() });
    await call(headOfficeManager, "recordSupplierPayment", { supplierId: supplier.supplierId, branchId: headOfficeId, method: "cash", allocations: [{ ...invoice, amountMinor: 25_000 }], paidAt: new Date().toISOString(), idempotencyKey: crypto.randomUUID() });
    const line = (await adminDb.collection("supplierInvoiceItems").where("supplierInvoiceId", "==", invoice.supplierInvoiceId).get()).docs[0]!;
    const base = { organizationId, branchId: headOfficeId, productId: product };
    // Trusted fixtures represent an already-approved customer return and its posted physical handover.
    await adminDb.doc("saleReturns/held-credit-return").set({ ...base, status: "approved" });
    await adminDb.doc("saleReturnItems/held-credit-item").set({ ...base, returnId: "held-credit-return", condition: "non_restockable", inspectionStatus: "completed" });
    await adminDb.doc("aftersalesCases/held-credit-case").set({ ...base, returnId: "held-credit-return", returnItemId: "held-credit-item" });
    const handover = adminDb.doc("inventoryTransactions/held-credit-handover");
    await handover.set({ ...base, transactionNumber: "INV-HELD-1", status: "posted", transactionType: "held_return_supplier_handover", trackingType: "quantity", supplierId: supplier.supplierId, supplierName: "Held goods supplier", quantity: 3, originalCostMinor: 10_001, aftersalesCaseId: "held-credit-case", returnItemId: "held-credit-item", saleReturnId: "held-credit-return", effectiveAt: Timestamp.now() });
    const payload = { ...invoice, supplierInvoiceItemId: line.id, receiptId: receipt.receiptId, heldHandoverId: handover.id, quantity: 1, creditNoteReference: "HELD-CN-1", reason: "Supplier accepted previously handed-over goods", returnedAt: new Date().toISOString(), idempotencyKey: crypto.randomUUID() };
    const balance = adminDb.doc(`inventoryBalances/${balanceDocumentId(organizationId, product, headOfficeLocationId)}`);
    const before = (await balance.get()).data();
    const entriesBefore = (await adminDb.collection("inventoryEntries").where("productId", "==", product).get()).size;
    await expect(call(warehouseManager, "postSupplierReturn", payload)).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(call(administrator, "postSupplierReturn", { ...payload, heldHandoverId: "foreign-handover" })).rejects.toMatchObject({ code: "functions/not-found" });
    await expect(call(headOfficeManager, "postSupplierReturn", { ...payload, serialNumbers: ["invented"] })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    const period = adminDb.doc(`accountingPeriods/${uniquenessDocumentId(organizationId, payload.returnedAt.slice(0, 7))}`);
    await period.set({ organizationId, status: "closed" });
    await expect(call(headOfficeManager, "postSupplierReturn", payload)).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await period.delete();
    await handover.update({ branchId: "another-store" });
    await expect(call(administrator, "postSupplierReturn", payload)).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await handover.update({ branchId: headOfficeId });
    const result = await call<{ returnId: string; journalEntryId: string; posted: boolean }>(headOfficeManager, "postSupplierReturn", payload);
    expect((await call(headOfficeManager, "postSupplierReturn", payload)).posted).toBe(false);
    await expect(call(headOfficeManager, "postSupplierReturn", { ...payload, quantity: 2 })).rejects.toMatchObject({ code: "functions/already-exists" });
    expect((await handover.get()).data()).toMatchObject({ supplierSettledQuantity: 1, supplierSettledOriginalCostMinor: 3334, supplierSettlementStatus: "partially_settled" });
    expect((await adminDb.doc(`supplierReturns/${result.returnId}`).get()).data()).toMatchObject({ heldHandoverId: handover.id, physicalStockIssued: false, grossAmountMinor: 10750, payableReductionMinor: 7250, supplierCreditMinor: 3500, inventoryTransactionId: handover.id });
    const journal = await adminDb.doc(`journalEntries/${result.journalEntryId}`).get();
    expect(journal.get("totalDebitMinor")).toBe(journal.get("totalCreditMinor"));
    const journalLines = (await adminDb.collection("journalLines").where("journalEntryId", "==", result.journalEntryId).get()).docs.map(doc => doc.data());
    expect(journalLines.find(row => row.accountCode === "5000")?.creditMinor).toBe(3334);
    expect(journalLines.find(row => row.accountCode === "1300")?.creditMinor).toBe(750);
    expect(journalLines.some(row => row.accountCode === "1200")).toBe(false);
    const workspace = await call<{ handover: { settledQuantity: number }; invoices: Array<{ id: string }> }>(headOfficeManager, "getProcurementWorkspace", { view: "held_supplier_handover", heldHandoverId: handover.id, limit: 1 });
    expect(workspace.handover.settledQuantity).toBe(1); expect(workspace.invoices.map(row => row.id)).toContain(invoice.supplierInvoiceId);
    await expect(call(headOfficeManager, "getProcurementWorkspace", { view: "held_supplier_handover", heldHandoverId: handover.id, cursor: "bad-cursor" })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    const next = { ...payload, quantity: 2, creditNoteReference: "HELD-CN-2", idempotencyKey: crypto.randomUUID() };
    const races = await Promise.allSettled([call(headOfficeManager, "postSupplierReturn", next), call(headOfficeManager, "postSupplierReturn", { ...next, creditNoteReference: "HELD-CN-3", idempotencyKey: crypto.randomUUID() })]);
    expect(races.filter(row => row.status === "fulfilled")).toHaveLength(1);
    expect((await handover.get()).data()).toMatchObject({ supplierSettledQuantity: 3, supplierSettledOriginalCostMinor: 10001, supplierSettlementStatus: "settled" });
    expect((await line.ref.get()).data()).toMatchObject({ returnedQuantity: 3, returnedNetMinor: 30000, returnedVatMinor: 2250 });
    expect((await adminDb.doc(`suppliers/${supplier.supplierId}`).get()).data()).toMatchObject({ outstandingBalanceMinor: 0, advanceBalanceMinor: 25000 });
    expect((await balance.get()).data()).toEqual(before);
    expect((await adminDb.collection("inventoryEntries").where("productId", "==", product).get()).size).toBe(entriesBefore);
    await expect(call(headOfficeManager, "postSupplierReturn", { ...payload, heldHandoverId: undefined, creditNoteReference: "DOUBLE-CREDIT", idempotencyKey: crypto.randomUUID() })).rejects.toThrow();
    const movementId = (await adminDb.doc(`purchaseReceipts/${receipt.receiptId}`).get()).get("inventoryTransactionId");
    await expect(call(administrator, "reverseInventoryTransaction", { transactionId: movementId, reason: "Cannot reverse credited purchase", idempotencyKey: crypto.randomUUID() })).rejects.toThrow();
  });
  it.each(["serial", "batch"])("restores %s stock and exact original value through a linked supplier correction", async trackingType => {
    const supplier = await call<{ supplierId: string }>(administrator, "saveSupplier", { name: `${trackingType} correction supplier`, phone: "07055557777", idempotencyKey: crypto.randomUUID() });
    const product = `supplier-correction-${trackingType}`, serialNumbers = trackingType === "serial" ? ["CORRECT-A", "CORRECT-B", "CORRECT-C"] : [];
    await adminDb.doc(`products/${product}`).set({ organizationId, name: product, sku: product, unitOfMeasure: "unit", trackingType, active: true });
    const order = await call<{ purchaseOrderId: string }>(headOfficeManager, "createPurchaseOrder", { supplierId: supplier.supplierId, branchId: headOfficeId, receivingLocationId: headOfficeLocationId,
      lines: [{ productId: product, quantity: 3, unitCostMinor: 10001, vatRateBasisPoints: 750 }], idempotencyKey: crypto.randomUUID() });
    await call(headOfficeManager, "submitPurchaseOrder", { ...order, idempotencyKey: crypto.randomUUID() });
    await call(headOfficeManager, "approvePurchaseOrder", { ...order, idempotencyKey: crypto.randomUUID() });
    const item = (await adminDb.collection("purchaseOrderItems").where("purchaseOrderId", "==", order.purchaseOrderId).get()).docs[0]!;
    const receipt = await call<{ receiptId: string }>(headOfficeManager, "receivePurchaseOrderItem", { ...order, purchaseOrderItemId: item.id, quantity: 3, receivedAt: new Date().toISOString(), serialNumbers,
      ...(trackingType === "batch" ? { lot: { lotNumber: "CORRECTION-BATCH" } } : {}), idempotencyKey: crypto.randomUUID() });
    const invoice = await call<{ supplierInvoiceId: string }>(headOfficeManager, "submitSupplierInvoice", { ...order, supplierInvoiceNumber: `CORRECTION-${trackingType}`, invoiceDate: new Date().toISOString().slice(0, 10), lines: [{ purchaseOrderItemId: item.id, quantity: 3 }], idempotencyKey: crypto.randomUUID() });
    await call(headOfficeManager, "approveSupplierInvoice", { ...invoice, idempotencyKey: crypto.randomUUID() });
    const line = (await adminDb.collection("supplierInvoiceItems").where("supplierInvoiceId", "==", invoice.supplierInvoiceId).get()).docs[0]!;
    const returned = await call<{ returnId: string; inventoryTransactionId: string }>(headOfficeManager, "postSupplierReturn", { ...invoice, supplierInvoiceItemId: line.id, receiptId: receipt.receiptId, quantity: 2, serialNumbers: serialNumbers.slice(0, 2), creditNoteReference: `CORRECTION-CN-${trackingType}`, reason: "Original goods accepted for supplier credit", returnedAt: new Date().toISOString(), idempotencyKey: crypto.randomUUID() });
    const correction = { action: "reverse_return", returnId: returned.returnId, reason: "Supplier rescinded credit and physically returned the goods", goodsBackInStore: true, confirmedResellable: true, reversedAt: new Date().toISOString(), idempotencyKey: crypto.randomUUID() };
    const positions = await adminDb.collection("inventoryBalances").where("organizationId", "==", organizationId).where("productId", "==", product).get();
    const before = positions.docs[0]!;
    expect(before.get("onHandQuantity")).toBe(1);
    // A later movement or corrupted linkage must reject before any financial change.
    await before.ref.update({ lastTransactionId: "later-movement" });
    await expect(call(headOfficeManager, "postSupplierReturn", correction)).rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect((await adminDb.doc(`supplierReturns/${returned.returnId}`).get()).get("status")).toBe("posted");
    await before.ref.update({ lastTransactionId: returned.inventoryTransactionId });
    await call(headOfficeManager, "postSupplierReturn", correction);
    expect((await before.ref.get()).data()).toMatchObject({ onHandQuantity: 3, availableQuantity: 3, totalValueMinor: 30003 });
    expect((await line.ref.get()).data()).toMatchObject({ returnedQuantity: 0, returnedNetMinor: 0, returnedVatMinor: 0 });
    expect((await adminDb.doc(`supplierInvoices/${invoice.supplierInvoiceId}`).get()).get("outstandingAmountMinor")).toBe(32253);
    if (trackingType === "serial") {
      const serials = await adminDb.collection("serializedItems").where("productId", "==", product).get();
      expect(serials.docs.every(serial => serial.get("active") && serial.get("currentLocationId") === headOfficeLocationId)).toBe(true);
    } else {
      expect((await adminDb.doc(`inventoryLots/${before.get("lotId")}`).get()).get("remainingQuantity")).toBe(3);
    }
  });

  it("posts a multi-product credit note all-or-nothing, with shared payable/advance projections and concurrent replay", async () => {
    const supplier = await call<{ supplierId: string }>(administrator, "saveSupplier", { name: "Multi-product credit supplier", phone: "07055556666", idempotencyKey: crypto.randomUUID() });
    const products = ["multi-credit-a", "multi-credit-b"];
    for (const id of products) {
      await adminDb.doc(`products/${id}`).set({ organizationId, name: id, sku: id, unitOfMeasure: "unit", trackingType: "quantity", active: true, hasLedgerActivity: false });
      await adminDb.doc(`productCosts/${id}`).set({ organizationId, productId: id, defaultUnitCostMinor: 10000, currency: "NGN" });
    }
    const order = await call<{ purchaseOrderId: string }>(headOfficeManager, "createPurchaseOrder", { supplierId: supplier.supplierId,
      branchId: headOfficeId, receivingLocationId: headOfficeLocationId,
      lines: products.map(productId => ({ productId, quantity: 3, unitCostMinor: 10000, vatRateBasisPoints: 750 })), idempotencyKey: crypto.randomUUID() });
    await call(headOfficeManager, "submitPurchaseOrder", { ...order, idempotencyKey: crypto.randomUUID() });
    await call(headOfficeManager, "approvePurchaseOrder", { ...order, idempotencyKey: crypto.randomUUID() });
    const items = (await adminDb.collection("purchaseOrderItems").where("purchaseOrderId", "==", order.purchaseOrderId).get()).docs;
    const receipts: Record<string, string> = {};
    for (const item of items) {
      const receipt = await call<{ receiptId: string }>(headOfficeManager, "receivePurchaseOrderItem", { ...order, purchaseOrderItemId: item.id,
        quantity: 3, receivedAt: new Date().toISOString(), serialNumbers: [], idempotencyKey: crypto.randomUUID() });
      receipts[item.id] = receipt.receiptId;
    }
    const invoice = await call<{ supplierInvoiceId: string }>(headOfficeManager, "submitSupplierInvoice", { ...order, supplierInvoiceNumber: "MULTI-CREDIT-INV",
      invoiceDate: new Date().toISOString().slice(0, 10), lines: items.map(item => ({ purchaseOrderItemId: item.id, quantity: 2 })), idempotencyKey: crypto.randomUUID() });
    await call(headOfficeManager, "approveSupplierInvoice", { ...invoice, idempotencyKey: crypto.randomUUID() });
    await call(headOfficeManager, "recordSupplierPayment", { supplierId: supplier.supplierId, branchId: headOfficeId, method: "cash",
      allocations: [{ ...invoice, amountMinor: 40000 }], paidAt: new Date().toISOString(), idempotencyKey: crypto.randomUUID() });
    const lines = (await adminDb.collection("supplierInvoiceItems").where("supplierInvoiceId", "==", invoice.supplierInvoiceId).get()).docs;
    const payload = { ...invoice, returnedAt: new Date().toISOString(), reason: "Two products accepted for supplier credit", creditNoteReference: "MULTI-CN-1", idempotencyKey: crypto.randomUUID(),
      lines: lines.map(line => ({ supplierInvoiceItemId: line.id, receiptId: receipts[line.get("purchaseOrderItemId")]!, quantity: 1, serialNumbers: [], idempotencyKey: crypto.randomUUID() })) };
    const stockRefs = products.map(id => adminDb.doc(`inventoryBalances/${balanceDocumentId(organizationId, id, headOfficeLocationId)}`));
    const originals = (await adminDb.getAll(...stockRefs)).map(snapshot => snapshot.data());
    const invoiceRef = adminDb.doc(`supplierInvoices/${invoice.supplierInvoiceId}`), supplierRef = adminDb.doc(`suppliers/${supplier.supplierId}`);
    const invoiceBefore = (await invoiceRef.get()).data(), supplierBefore = (await supplierRef.get()).data();
    // The last line has sufficient physical stock but exceeds its invoiced quantity.
    await expect(call(headOfficeManager, "postSupplierReturn", { ...payload, lines: [payload.lines[0], { ...payload.lines[1], quantity: 3 }] })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect((await adminDb.getAll(...stockRefs)).map(snapshot => snapshot.data())).toEqual(originals);
    expect((await invoiceRef.get()).data()).toEqual(invoiceBefore);
    expect((await supplierRef.get()).data()).toEqual(supplierBefore);
    expect((await adminDb.collection("supplierReturns").where("supplierInvoiceId", "==", invoice.supplierInvoiceId).get()).empty).toBe(true);
    await expect(call(warehouseManager, "postSupplierReturn", payload)).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(call(headOfficeManager, "postSupplierReturn", { ...payload, heldHandoverId: "already-issued-goods" })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    type Result = { documentId: string; posted: boolean; returns: Array<{ returnId: string; journalEntryId: string; inventoryTransactionId: string }> };
    const results = await Promise.all([call<Result>(headOfficeManager, "postSupplierReturn", payload), call<Result>(headOfficeManager, "postSupplierReturn", payload)]);
    expect(results.filter(result => result.posted)).toHaveLength(1);
    expect(results[0]!.returns.map(result => result.returnId)).toEqual(results[1]!.returns.map(result => result.returnId));
    expect(results[0]!.documentId).toBe(payload.idempotencyKey);
    expect((await invoiceRef.get()).data()).toMatchObject({ outstandingAmountMinor: 0, creditedAmountMinor: 3000, status: "paid" });
    expect((await supplierRef.get()).data()).toMatchObject({ outstandingBalanceMinor: 0, advanceBalanceMinor: 18500, advanceBalancesByLocation: { [`branch:${headOfficeId}`]: 18500 } });
    expect((await adminDb.getAll(...stockRefs)).map(snapshot => snapshot.get("onHandQuantity"))).toEqual([2, 2]);
    const returns = await adminDb.getAll(...results[0]!.returns.map(result => adminDb.doc(`supplierReturns/${result.returnId}`)));
    expect(returns.every(record => record.get("creditDocumentId") === payload.idempotencyKey)).toBe(true);
    expect(new Set(returns.map(record => record.get("returnNumber"))).size).toBe(2);
    expect(returns.reduce((sum, record) => sum + record.get("grossAmountMinor"), 0)).toBe(21500);
    const journals = await adminDb.getAll(...results[0]!.returns.map(result => adminDb.doc(`journalEntries/${result.journalEntryId}`)));
    expect(journals.every(journal => journal.get("totalDebitMinor") === journal.get("totalCreditMinor"))).toBe(true);
    expect(new Set(journals.map(journal => journal.get("journalNumber"))).size).toBe(2);
    expect((await call<Result>(headOfficeManager, "postSupplierReturn", payload)).posted).toBe(false);
    await expect(call(headOfficeManager, "postSupplierReturn", { ...payload, reason: "Changed commercial instructions" })).rejects.toMatchObject({ code: "functions/already-exists" });
    await expect(call(headOfficeManager, "postSupplierReturn", { ...payload, idempotencyKey: crypto.randomUUID(), lines: payload.lines.map(line => ({ ...line, idempotencyKey: crypto.randomUUID() })) })).rejects.toMatchObject({ code: "functions/already-exists" });
    expect((await adminDb.getAll(...stockRefs)).map(snapshot => snapshot.get("onHandQuantity"))).toEqual([2, 2]);
    const returned = returns[0]!, originalJournal = journals[0]!;
    const correction = { action: "reverse_return", returnId: returned.id, reason: "Wrong product on supplier credit note", goodsBackInStore: true, confirmedResellable: true,
      reversedAt: new Date().toISOString(), idempotencyKey: crypto.randomUUID() };
    const beforeCorrection = (await adminDb.getAll(invoiceRef, supplierRef, ...stockRefs)).map(snapshot => snapshot.data());
    await expect(call(headOfficeManager, "postSupplierReturn", { ...correction, goodsBackInStore: false })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    await expect(call(headOfficeManager, "postSupplierReturn", { ...correction, confirmedResellable: false })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    await expect(call(warehouseManager, "postSupplierReturn", correction)).rejects.toMatchObject({ code: "functions/permission-denied" });
    const periodKey = correction.reversedAt.slice(0, 7), periodRef = adminDb.doc(`accountingPeriods/${uniquenessDocumentId(organizationId, periodKey)}`);
    await periodRef.set({ organizationId, periodKey, status: "closed" });
    try { await expect(call(headOfficeManager, "postSupplierReturn", correction)).rejects.toMatchObject({ code: "functions/failed-precondition" }); }
    finally { await periodRef.delete(); }
    expect((await adminDb.getAll(invoiceRef, supplierRef, ...stockRefs)).map(snapshot => snapshot.data())).toEqual(beforeCorrection);
    // A credit already consumed/refunded must never be removed a second time.
    await supplierRef.update({ advanceBalanceMinor: 0, advanceBalancesByLocation: { [`branch:${headOfficeId}`]: 0 } });
    await expect(call(headOfficeManager, "postSupplierReturn", correction)).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await supplierRef.update({ advanceBalanceMinor: 18500, advanceBalancesByLocation: { [`branch:${headOfficeId}`]: 18500 } });
    type CorrectionResult = { reversed: boolean; inventoryTransactionId: string; journalEntryId: string; journalNumber: string };
    const corrections = await Promise.all([call<CorrectionResult>(headOfficeManager, "postSupplierReturn", correction), call<CorrectionResult>(headOfficeManager, "postSupplierReturn", correction)]);
    expect(corrections.filter(value => value.reversed)).toHaveLength(1);
    expect(corrections[0]!.inventoryTransactionId).toBe(corrections[1]!.inventoryTransactionId);
    expect(corrections[0]!.journalEntryId).toBe(corrections[1]!.journalEntryId);
    const reversedRecord = await returned.ref.get();
    expect(reversedRecord.data()).toMatchObject({ status: "reversed", grossAmountMinor: returned.get("grossAmountMinor"), reversalJournalEntryId: corrections[0]!.journalEntryId });
    expect((await originalJournal.ref.get()).data()).toEqual(originalJournal.data());
    expect((await adminDb.doc(`journalEntries/${corrections[0]!.journalEntryId}`).get()).data()).toMatchObject({ totalDebitMinor: originalJournal.get("totalCreditMinor"), totalCreditMinor: originalJournal.get("totalDebitMinor"), reversalOfJournalEntryId: originalJournal.id });
    expect((await supplierRef.get()).data()).toMatchObject({ outstandingBalanceMinor: returned.get("payableReductionMinor"), advanceBalanceMinor: 18500 - returned.get("supplierCreditMinor") });
    expect((await invoiceRef.get()).data()).toMatchObject({ outstandingAmountMinor: returned.get("payableReductionMinor"), creditedAmountMinor: 3000 - returned.get("payableReductionMinor") });
    expect((await adminDb.getAll(...stockRefs)).map(snapshot => snapshot.get("onHandQuantity")).sort()).toEqual([2, 3]);
    expect((await adminDb.doc(`supplierReturns/${returns[1]!.id}`).get()).get("status")).toBe("posted");
    expect((await call<CorrectionResult>(headOfficeManager, "postSupplierReturn", correction)).reversed).toBe(false);
    await expect(call(headOfficeManager, "postSupplierReturn", { ...correction, reason: "Changed correction instructions" })).rejects.toMatchObject({ code: "functions/already-exists" });
    await expect(call(headOfficeManager, "postSupplierReturn", { ...correction, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/already-exists" });
    const correctedHistory = await call<{ returns: Array<{ id: string; status: string; reversalJournalNumber: string }> }>(headOfficeManager, "getProcurementWorkspace", { view: "supplier_returns", ...invoice, limit: 25 });
    expect(correctedHistory.returns.find(record => record.id === returned.id)).toMatchObject({ status: "reversed", reversalJournalNumber: corrections[0]!.journalNumber });
  });

  it("atomically returns goods, credits unpaid invoices, creates surplus credit and prevents duplicate or stock-only reversals", async () => {
    const supplier = await call<{ supplierId: string }>(administrator, "saveSupplier", { name: "Goods-return supplier", phone: "07077778888", idempotencyKey: crypto.randomUUID() });
    const returnProduct = "supplier-return-product";
    await adminDb.doc(`products/${returnProduct}`).set({ organizationId, name: "Return test panel", sku: "RETURN-PANEL", unitOfMeasure: "unit", trackingType: "quantity", active: true, hasLedgerActivity: false });
    await adminDb.doc(`productCosts/${returnProduct}`).set({ organizationId, productId: returnProduct, defaultUnitCostMinor: 10000, currency: "NGN" });
    const order = await call<{ purchaseOrderId: string }>(headOfficeManager, "createPurchaseOrder", { supplierId: supplier.supplierId, branchId: headOfficeId, receivingLocationId: headOfficeLocationId, lines: [{ productId: returnProduct, quantity: 3, unitCostMinor: 10000, vatRateBasisPoints: 750 }], idempotencyKey: crypto.randomUUID() });
    await call(headOfficeManager, "submitPurchaseOrder", { ...order, idempotencyKey: crypto.randomUUID() });
    await call(headOfficeManager, "approvePurchaseOrder", { ...order, idempotencyKey: crypto.randomUUID() });
    const item = (await adminDb.collection("purchaseOrderItems").where("purchaseOrderId", "==", order.purchaseOrderId).get()).docs[0]!;
    const receipt = await call<{ receiptId: string }>(headOfficeManager, "receivePurchaseOrderItem", { ...order, purchaseOrderItemId: item.id, quantity: 3, receivedAt: new Date().toISOString(), serialNumbers: [], idempotencyKey: crypto.randomUUID() });
    const invoice = await call<{ supplierInvoiceId: string }>(headOfficeManager, "submitSupplierInvoice", { ...order, supplierInvoiceNumber: "RETURN-INV-001", invoiceDate: new Date().toISOString().slice(0, 10), lines: [{ purchaseOrderItemId: item.id, quantity: 3 }], idempotencyKey: crypto.randomUUID() });
    await call(headOfficeManager, "approveSupplierInvoice", { ...invoice, idempotencyKey: crypto.randomUUID() });
    const line = (await adminDb.collection("supplierInvoiceItems").where("supplierInvoiceId", "==", invoice.supplierInvoiceId).get()).docs[0]!;
    await call(headOfficeManager, "recordSupplierPayment", { supplierId: supplier.supplierId, branchId: headOfficeId, method: "cash", allocations: [{ ...invoice, amountMinor: 25_000 }], paidAt: new Date().toISOString(), idempotencyKey: crypto.randomUUID() });
    const payload = { ...invoice, supplierInvoiceItemId: line.id, receiptId: receipt.receiptId, quantity: 1, serialNumbers: [], creditNoteReference: "CN-RETURN-001", reason: "Goods damaged on arrival", returnedAt: new Date().toISOString(), idempotencyKey: crypto.randomUUID() };
    await expect(call(warehouseManager, "postSupplierReturn", payload)).rejects.toMatchObject({ code: "functions/permission-denied" });
    const financeOnly = await createActor("return-finance-only@example.test", "finance_officer");
    await expect(call(financeOnly, "postSupplierReturn", payload)).rejects.toMatchObject({ code: "functions/permission-denied" });
    const periodKey = payload.returnedAt.slice(0, 7), period = adminDb.doc(`accountingPeriods/${uniquenessDocumentId(organizationId, periodKey)}`);
    await period.set({ organizationId, periodKey, status: "closed" });
    try { await expect(call(headOfficeManager, "postSupplierReturn", payload)).rejects.toMatchObject({ code: "functions/failed-precondition" }); }
    finally { await period.delete(); }
    expect((await adminDb.doc(`purchaseReceipts/${receipt.receiptId}`).get()).get("returnedQuantity")).toBeUndefined();
    const [first, retry] = await Promise.all([call<{ returnId: string; posted: boolean; inventoryTransactionId: string; journalEntryId: string }>(headOfficeManager, "postSupplierReturn", payload), call<{ returnId: string; posted: boolean }>(headOfficeManager, "postSupplierReturn", payload)]);
    expect(first.returnId).toBe(retry.returnId);
    expect([first.posted, retry.posted].sort()).toEqual([false, true]);
    expect((await adminDb.doc(`supplierReturns/${first.returnId}`).get()).data()).toMatchObject({ grossAmountMinor: 10_750, payableReductionMinor: 7_250, supplierCreditMinor: 3_500 });
    expect((await adminDb.doc(`supplierInvoices/${invoice.supplierInvoiceId}`).get()).data()).toMatchObject({ status: "paid", grossAmountMinor: 32_250, outstandingAmountMinor: 0, creditedAmountMinor: 7_250 });
    const supplierRef = adminDb.doc(`suppliers/${supplier.supplierId}`);
    expect((await supplierRef.get()).data()).toMatchObject({ outstandingBalanceMinor: 0, advanceBalanceMinor: 3_500, advanceBalancesByLocation: { [`branch:${headOfficeId}`]: 3_500 } });
    const journal = await adminDb.doc(`journalEntries/${first.journalEntryId}`).get();
    expect(journal.get("totalDebitMinor")).toBe(journal.get("totalCreditMinor"));
    expect(journal.get("referenceId")).toBe(first.returnId);
    await expect(call(headOfficeManager, "postSupplierReturn", { ...payload, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/already-exists" });
    await expect(call(headOfficeManager, "postSupplierReturn", { ...payload, quantity: 2 })).rejects.toMatchObject({ code: "functions/already-exists" });
    await expect(call(administrator, "reverseInventoryTransaction", { transactionId: first.inventoryTransactionId, reason: "Stock-only reversal not allowed", idempotencyKey: crypto.randomUUID() })).rejects.toThrow();
    const originalMovement = (await adminDb.doc(`purchaseReceipts/${receipt.receiptId}`).get()).get("inventoryTransactionId");
    await expect(call(administrator, "reverseInventoryTransaction", { transactionId: originalMovement, reason: "Receipt with credits must not reverse", idempotencyKey: crypto.randomUUID() })).rejects.toThrow();
    const next = { ...payload, creditNoteReference: "CN-RETURN-002", quantity: 2, idempotencyKey: crypto.randomUUID() };
    await call(headOfficeManager, "postSupplierReturn", next);
    expect((await adminDb.doc(`inventoryBalances/${balanceDocumentId(organizationId, returnProduct, headOfficeLocationId)}`).get()).get("onHandQuantity")).toBe(0);
    expect((await supplierRef.get()).get("advanceBalanceMinor")).toBe(25_000);
    expect((await line.ref.get()).data()).toMatchObject({ returnedQuantity: 3, returnedNetMinor: 30_000, returnedVatMinor: 2_250 });
    await expect(call(headOfficeManager, "postSupplierReturn", { ...payload, creditNoteReference: "CN-OVER", idempotencyKey: crypto.randomUUID() })).rejects.toThrow();
    const history = await call<{ returns: unknown[]; nextCursor: string }>(headOfficeManager, "getProcurementWorkspace", { view: "supplier_returns", ...invoice, limit: 1 });
    expect(history.returns).toHaveLength(1); expect(history.nextCursor).toBeTruthy();
    expect(history.returns[0]).toMatchObject({ serialized: false });
    expect(history.returns[0]).not.toHaveProperty("serialNumbers");
    const older = await call<{ returns: unknown[] }>(headOfficeManager, "getProcurementWorkspace", { view: "supplier_returns", ...invoice, limit: 1, cursor: history.nextCursor });
    expect(older.returns).toHaveLength(1);
    const receipts = await call<{ receipts: { returnedQuantity: number }[] }>(headOfficeManager, "getProcurementWorkspace", { view: "supplier_return_receipts", ...invoice, supplierInvoiceItemId: line.id, limit: 25 });
    expect(receipts.receipts[0]!.returnedQuantity).toBe(3);
    await call(headOfficeManager, "recordSupplierPayment", { supplierId: supplier.supplierId, branchId: headOfficeId, purpose: "advance_refund", method: "bank_transfer", bankAccountId, reference: "CREDIT-REFUND-001", notes: "Supplier refunded returned goods", amountMinor: 25_000, paidAt: new Date().toISOString(), idempotencyKey: crypto.randomUUID() });
    expect((await supplierRef.get()).get("advanceBalanceMinor")).toBe(0);
  });
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
    const receipt = await call<{ receiptId: string }>(headOfficeManager, "receivePurchaseOrderItem", {
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
    const receiptsInput = { view: "purchase_receipts", purchaseOrderId: order.purchaseOrderId, limit: 1 };
    const history = await call<{ receipts: { id: string; receiptNumber: string }[] }>(headOfficeManager, "getProcurementWorkspace", receiptsInput);
    expect(history.receipts[0]!.id).toBe(receipt.receiptId);
    const printed = await call<{ document: { receiptNumber: string; quantity: number; receivingStore: string; inventoryReference: string } }>(headOfficeManager, "getProcurementWorkspace", { ...receiptsInput, receiptId: receipt.receiptId });
    expect(printed.document).toMatchObject({ quantity: 2, receivingStore: "Head Office" });
    expect(printed.document.receiptNumber).toBe(`GRN-${printed.document.inventoryReference}`);
    expect((await balance.ref.get()).get("onHandQuantity")).toBe(2);
    // Legacy receipts derive their reference from the original immutable movement.
    await adminDb.doc(`purchaseReceipts/${receipt.receiptId}`).update({ receiptNumber: FieldValue.delete(), unitOfMeasure: FieldValue.delete() });
    const legacy = await call<{ document: { receiptNumber: string } }>(headOfficeManager, "getProcurementWorkspace", { ...receiptsInput, receiptId: receipt.receiptId });
    expect(legacy.document.receiptNumber).toBe(printed.document.receiptNumber);
    expect((await adminDb.doc(`purchaseReceipts/${receipt.receiptId}`).get()).get("receiptNumber")).toBeUndefined();
    await expect(call(warehouseManager, "getProcurementWorkspace", receiptsInput)).rejects.toThrow();
    await expect(call(headOfficeManager, "getProcurementWorkspace", { ...receiptsInput, receiptId: "unrelated-receipt" })).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(call(headOfficeManager, "getProcurementWorkspace", { ...receiptsInput, cursor: "unrelated-receipt" })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    await adminDb.doc(`purchaseReceipts/${receipt.receiptId}`).update({ quantity: 3 });
    await expect(call(headOfficeManager, "getProcurementWorkspace", { ...receiptsInput, receiptId: receipt.receiptId })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await adminDb.doc(`purchaseReceipts/${receipt.receiptId}`).update({ quantity: 2 });
  });

  it("prints serialized receiving evidence from the original ledger without moving stock again", async () => {
    const serialProduct = "grn-serialized-product";
    await adminDb.doc(`products/${serialProduct}`).set({ organizationId, name: "Serialized inverter", sku: "SERIAL-GRN", unitOfMeasure: "unit", trackingType: "serial", active: true, hasLedgerActivity: false });
    await adminDb.doc(`productCosts/${serialProduct}`).set({ organizationId, productId: serialProduct, defaultUnitCostMinor: 10000, currency: "NGN" });
    const supplier = await call<{ supplierId: string }>(administrator, "saveSupplier", { name: "Serial GRN supplier", phone: "07055556666", idempotencyKey: crypto.randomUUID() });
    const order = await call<{ purchaseOrderId: string }>(headOfficeManager, "createPurchaseOrder", { supplierId: supplier.supplierId, branchId: headOfficeId, receivingLocationId: headOfficeLocationId, lines: [{ productId: serialProduct, quantity: 2, unitCostMinor: 10000 }], idempotencyKey: crypto.randomUUID() });
    await call(headOfficeManager, "submitPurchaseOrder", { ...order, idempotencyKey: crypto.randomUUID() });
    await call(headOfficeManager, "approvePurchaseOrder", { ...order, idempotencyKey: crypto.randomUUID() });
    const items = await adminDb.collection("purchaseOrderItems").where("purchaseOrderId", "==", order.purchaseOrderId).get();
    const receive = (serial: string) => call<{ receiptId: string }>(headOfficeManager, "receivePurchaseOrderItem", { ...order, purchaseOrderItemId: items.docs[0]!.id, quantity: 1, serialNumbers: [serial], receivedAt: new Date().toISOString(), notes: "Checked serial at receiving", idempotencyKey: crypto.randomUUID() });
    const first = await receive("GRN-SERIAL-1"), second = await receive("GRN-SERIAL-2");
    const page = await call<{ receipts: { id: string }[]; nextCursor: string | null }>(headOfficeManager, "getProcurementWorkspace", { view: "purchase_receipts", ...order, limit: 1 });
    expect(page.receipts[0]!.id).toBe(second.receiptId);
    const older = await call<{ receipts: { id: string }[] }>(headOfficeManager, "getProcurementWorkspace", { view: "purchase_receipts", ...order, limit: 1, cursor: page.nextCursor });
    expect(older.receipts[0]!.id).toBe(first.receiptId);
    const input = { view: "purchase_receipts", ...order, receiptId: first.receiptId };
    const note = await call<{ document: { serialNumbers: string[]; notes: string } }>(headOfficeManager, "getProcurementWorkspace", input);
    expect(note.document.serialNumbers).toEqual(["GRN-SERIAL-1"]);
    expect(note.document.notes).toBe("Checked serial at receiving");
    await call(headOfficeManager, "getProcurementWorkspace", input);
    const balance = await adminDb.doc(`inventoryBalances/${balanceDocumentId(organizationId, serialProduct, headOfficeLocationId)}`).get();
    expect(balance.get("onHandQuantity")).toBe(2);
    const invoice = await call<{ supplierInvoiceId: string }>(headOfficeManager, "submitSupplierInvoice", { ...order, supplierInvoiceNumber: "SERIAL-RETURN-INV", invoiceDate: new Date().toISOString().slice(0, 10), lines: [{ purchaseOrderItemId: items.docs[0]!.id, quantity: 2 }], idempotencyKey: crypto.randomUUID() });
    await call(headOfficeManager, "approveSupplierInvoice", { ...invoice, idempotencyKey: crypto.randomUUID() });
    const line = (await adminDb.collection("supplierInvoiceItems").where("supplierInvoiceId", "==", invoice.supplierInvoiceId).get()).docs[0]!;
    const payload = { ...invoice, supplierInvoiceItemId: line.id, receiptId: first.receiptId, quantity: 1, serialNumbers: ["GRN-SERIAL-2"], creditNoteReference: "SERIAL-CN-1", reason: "Faulty serial returned", returnedAt: new Date().toISOString(), idempotencyKey: crypto.randomUUID() };
    await expect(call(headOfficeManager, "postSupplierReturn", payload)).rejects.toMatchObject({ code: "functions/failed-precondition" });
    const serial = (await adminDb.collection("serializedItems").where("productId", "==", serialProduct).where("serialNumber", "==", "GRN-SERIAL-1").get()).docs[0]!;
    await serial.ref.update({ status: "reserved" });
    await expect(call(headOfficeManager, "postSupplierReturn", { ...payload, serialNumbers: ["GRN-SERIAL-1"] })).rejects.toThrow();
    await serial.ref.update({ status: "available" });
    await call(headOfficeManager, "postSupplierReturn", { ...payload, serialNumbers: ["GRN-SERIAL-1"] });
    expect((await serial.ref.get()).data()).toMatchObject({ status: "returned_to_supplier", active: false });
    expect((await balance.ref.get()).get("onHandQuantity")).toBe(1);
    const heldSerial = (await adminDb.collection("serializedItems").where("productId", "==", serialProduct).where("serialNumber", "==", "GRN-SERIAL-2").get()).docs[0]!;
    const base = { organizationId, branchId: headOfficeId, productId: serialProduct };
    await adminDb.doc("saleReturns/serial-held-return").set({ ...base, status: "approved" });
    await adminDb.doc("saleReturnItems/serial-held-item").set({ ...base, returnId: "serial-held-return", condition: "non_restockable", inspectionStatus: "completed" });
    await adminDb.doc("aftersalesCases/serial-held-case").set({ ...base, returnId: "serial-held-return", returnItemId: "serial-held-item" });
    await adminDb.doc("inventoryTransactions/serial-held-handover").set({ ...base, transactionNumber: "INV-SERIAL-HELD", status: "posted", transactionType: "held_return_supplier_handover", trackingType: "serial", serialNumber: "GRN-SERIAL-2", serializedItemId: heldSerial.id, supplierId: supplier.supplierId, quantity: 1, originalCostMinor: 10000, aftersalesCaseId: "serial-held-case", returnItemId: "serial-held-item", saleReturnId: "serial-held-return", effectiveAt: Timestamp.now() });
    await heldSerial.ref.update({ branchId: headOfficeId, status: "returned_to_supplier", active: false, lastTransactionId: "serial-held-handover" });
    const heldPayload = { ...payload, heldHandoverId: "serial-held-handover", receiptId: second.receiptId, creditNoteReference: "HELD-SERIAL-CN", returnedAt: new Date().toISOString(), idempotencyKey: crypto.randomUUID() };
    await expect(call(headOfficeManager, "postSupplierReturn", { ...heldPayload, serialNumbers: ["GRN-SERIAL-1"] })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await expect(call(headOfficeManager, "postSupplierReturn", { ...heldPayload, receiptId: first.receiptId })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await heldSerial.ref.update({ status: "available", active: true });
    await expect(call(headOfficeManager, "postSupplierReturn", heldPayload)).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await heldSerial.ref.update({ status: "returned_to_supplier", active: false });
    await call(headOfficeManager, "postSupplierReturn", heldPayload);
    expect((await balance.ref.get()).get("onHandQuantity")).toBe(1);
    expect((await heldSerial.ref.get()).get("status")).toBe("returned_to_supplier");
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

  it("receives unused supplier advances once, without reducing invoice debt or moving stock", async () => {
    const { supplierId } = await call<{ supplierId: string }>(administrator, "saveSupplier", {
      name: "Refund Supplier", phone: "07099998888", active: true, idempotencyKey: crypto.randomUUID(),
    });
    const supplier = adminDb.doc(`suppliers/${supplierId}`);
    await call(headOfficeManager, "recordSupplierPayment", { supplierId, branchId: headOfficeId, purpose: "advance", amountMinor: 40_000, method: "bank_transfer", bankAccountId, reference: "REF-ADV", paidAt: new Date().toISOString(), idempotencyKey: crypto.randomUUID() });
    await supplier.update({ active: false }); // Revoking new purchases must not trap existing money.
    const before = await adminDb.collection("inventoryTransactions").where("organizationId", "==", organizationId).get();
    const refund = { supplierId, branchId: headOfficeId, purpose: "advance_refund", amountMinor: 10_000, method: "bank_transfer", bankAccountId, reference: "REF-RECEIVED", notes: "Unused deposit returned", paidAt: new Date().toISOString(), idempotencyKey: crypto.randomUUID() };
    const results = await Promise.all([1, 2].map(() => call<{ paymentId: string; recorded: boolean }>(headOfficeManager, "recordSupplierPayment", refund)));
    expect(results[0]!.paymentId).toBe(results[1]!.paymentId);
    expect(results.filter((result) => result.recorded)).toHaveLength(1);
    expect((await supplier.get()).data()).toMatchObject({ advanceBalanceMinor: 30_000, outstandingBalanceMinor: 0, advanceBalancesByLocation: { [`branch:${headOfficeId}`]: 30_000 } });
    const payment = await adminDb.doc(`supplierPayments/${results[0]!.paymentId}`).get();
    expect(payment.data()).toMatchObject({ purpose: "advance_refund", direction: "inflow", bankAccountId, ledgerAccountCode: "1041" });
    const lines = await adminDb.collection("journalLines").where("journalEntryId", "==", payment.get("journalEntryId")).get();
    expect(lines.docs.map((line) => [line.get("accountCode"), line.get("debitMinor"), line.get("creditMinor")])).toEqual(expect.arrayContaining([["1041", 10_000, 0], ["1250", 0, 10_000]]));
    await expect(call(headOfficeManager, "recordSupplierPayment", { ...refund, amountMinor: 40_000, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    const otherStoreRefund = Object.fromEntries(Object.entries(refund).filter(([key]) => key !== "branchId"));
    await expect(call(administrator, "recordSupplierPayment", { ...otherStoreRefund, warehouseId, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await expect(call(warehouseManager, "recordSupplierPayment", { ...refund, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/permission-denied" });
    const competing = await Promise.allSettled([1, 2].map(() => call(headOfficeManager, "recordSupplierPayment", { ...refund, amountMinor: 25_000, idempotencyKey: crypto.randomUUID() })));
    expect(competing.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const statement = await call<{ closingAdvanceMinor: number; closingPayableMinor: number }>(headOfficeManager, "getProcurementWorkspace", { view: "supplier_account", supplierId, branchId: headOfficeId, limit: 25 });
    expect(statement).toMatchObject({ closingAdvanceMinor: 5_000, closingPayableMinor: 0 });
    expect((await adminDb.collection("inventoryTransactions").where("organizationId", "==", organizationId).get()).size).toBe(before.size);
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
    // Statements use Nigerian business dates, including the hour before UTC midnight.
    const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + 86_400_000));
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
