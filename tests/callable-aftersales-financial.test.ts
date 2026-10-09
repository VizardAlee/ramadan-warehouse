import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { getApps as getAdminApps, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { balanceDocumentId, uniquenessDocumentId } from "../functions/src/inventory/calculations";

const projectId = "demo-ramadan-warehouse";
const adminApp = getAdminApps().find((app) => app.name === "aftersales-financial-tests") ?? initializeAdminApp({ projectId }, "aftersales-financial-tests");
const adminAuth = getAdminAuth(adminApp);
const adminDb = getFirestore(adminApp);
const apps: FirebaseApp[] = [];
const organizationId = "aftersales-financial-org";
const branchId = "aftersales-branch";
const customerId = "aftersales-customer";
const productId = "aftersales-product";
const bankAccountId = "aftersales-bank";
let administrator: ReturnType<typeof client>;

function client(name: string) {
  const app = initializeApp({ projectId, apiKey: "demo", appId: `aftersales-${name}` }, `aftersales-${name}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099"}`, { disableWarnings: true });
  const functions = getFunctions(app, "us-central1");
  connectFunctionsEmulator(functions, "127.0.0.1", Number(process.env.TEST_FUNCTIONS_PORT ?? 5001));
  return { auth, functions };
}
async function call<T = Record<string, unknown>>(name: string, data: Record<string, unknown>) {
  return (await httpsCallable(administrator.functions, name)(data)).data as T;
}

beforeAll(async () => {
  await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099"}/emulator/v1/projects/${projectId}/accounts`, { method: "DELETE" });
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8180"}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" });
  await adminDb.doc(`organizations/${organizationId}`).set({ name: "Aftersales test organization", status: "active" });
  const record = await adminAuth.createUser({ email: "aftersales-admin@example.test", password: "Password!234567" });
  await adminDb.doc(`users/${record.uid}`).set({ uid: record.uid, organizationId, roleId: "system_administrator", branchIds: [], warehouseIds: [], status: "active", authDisabled: false, authorizationVersion: 1 });
  administrator = client("administrator");
  await signInWithEmailAndPassword(administrator.auth, "aftersales-admin@example.test", "Password!234567");
  const now = FieldValue.serverTimestamp();
  await Promise.all([
    adminDb.doc(`branches/${branchId}`).set({ organizationId, name: "Head Office", code: "HO", status: "active", createdAt: now }),
    adminDb.doc(`customers/${customerId}`).set({ organizationId, name: "Test Customer", customerNumber: "CUST-001", active: true, createdAt: now }),
    adminDb.doc(`products/${productId}`).set({ organizationId, name: "Test Product", sku: "TEST-001", active: true, createdAt: now }),
    adminDb.doc(`bankAccounts/${bankAccountId}`).set({ organizationId, bankName: "Test Bank", accountName: "Services", accountNumberLast4: "4567", ledgerAccountCode: "1043", active: true, createdAt: now }),
  ]);

});
afterAll(async () => Promise.all(apps.map((app) => deleteApp(app))));

describe.sequential("aftersales and ledger-derived reports", () => {
  it("disposes held quantity returns atomically with partial cost allocation, no duplicate expense and safe retries", async () => {
    const returnId = "disposition-return", itemId = "disposition-item", locationId = "disposition-location";
    await adminDb.doc(`inventoryLocations/${locationId}`).set({ organizationId, branchId, type: "branch", status: "active", name: "Head Office stock" });
    await adminDb.doc(`saleReturns/${returnId}`).set({ organizationId, branchId, saleId: "disposition-sale", customerId, status: "approved", inspectionStatus: "completed" });
    await adminDb.doc(`saleReturnItems/${itemId}`).set({ organizationId, branchId, returnId, saleId: "disposition-sale", productId, productName: "Test Product", quantity: 3, serialNumbers: [], disposition: "repair", condition: "non_restockable", inspectionStatus: "completed", costAmountMinor: 100 });
    const routed = await call<{ caseId: string }>("approveSaleReturn", { returnId, action: "route_aftersales", aftersales: { returnItemId: itemId, complaint: "Repair and inspect all three units" }, idempotencyKey: crypto.randomUUID() });
    const payload = { returnId, action: "dispose_held", disposition: { caseId: routed.caseId, outcome: "restock", quantity: 1, reason: "Repaired and tested safe for resale", confirmedResellable: true }, idempotencyKey: crypto.randomUUID() };
    await expect(call("approveSaleReturn", payload)).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await adminDb.doc(`aftersalesCases/${routed.caseId}`).update({ status: "completed" });
    await expect(call("approveSaleReturn", { ...payload, disposition: { ...payload.disposition, confirmedResellable: false } })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    const balanceRef = adminDb.doc(`inventoryBalances/${balanceDocumentId(organizationId, productId, locationId)}`);
    await balanceRef.set({ organizationId, branchId, productId, locationId, onHandQuantity: 5, reservedQuantity: 2, availableQuantity: 3, totalValueMinor: 500, version: 1 });
    const first = await call<{ transactionId: string; journalEntryId: string }>("approveSaleReturn", payload);
    expect(await call("approveSaleReturn", payload)).toMatchObject(first);
    await expect(call("approveSaleReturn", { ...payload, disposition: { ...payload.disposition, quantity: 2 } })).rejects.toMatchObject({ code: "functions/already-exists" });
    expect((await balanceRef.get()).data()).toMatchObject({ onHandQuantity: 6, reservedQuantity: 2, availableQuantity: 4, totalValueMinor: 533 });
    const journal = await adminDb.doc(`journalEntries/${first.journalEntryId}`).get();
    expect(journal.data()).toMatchObject({ totalDebitMinor: 33, totalCreditMinor: 33, referenceId: first.transactionId });
    const stock = await adminDb.collection("inventoryEntries").where("transactionId", "==", first.transactionId).get();
    expect(stock.docs.reduce((sum, doc) => sum + doc.get("quantityDelta"), 0)).toBe(0);
    expect(stock.docs.reduce((sum, doc) => sum + doc.get("valueDeltaMinor"), 0)).toBe(0);
    await expect(call("reverseInventoryTransaction", { transactionId: first.transactionId, reason: "Cannot bypass linked disposition", idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    const journalCount = (await adminDb.collection("journalEntries").count().get()).data().count;
    const scrap = await call<{ transactionId: string }>("approveSaleReturn", { ...payload, disposition: { ...payload.disposition, outcome: "scrap", quantity: 1 }, idempotencyKey: crypto.randomUUID() });
    expect((await adminDb.collection("inventoryEntries").where("transactionId", "==", scrap.transactionId).get()).docs[0]!.data()).toMatchObject({ quantityDelta: 0, heldQuantityDelta: -1, valueDeltaMinor: 0, heldOriginalCostMinor: 34 });
    await adminDb.doc("suppliers/disposition-supplier").set({ organizationId, name: "Warranty supplier", active: true });
    const handover = { ...payload, disposition: { ...payload.disposition, outcome: "supplier_handover", supplierId: "disposition-supplier", handoverReference: "HANDOVER-001", quantity: 1 }, idempotencyKey: crypto.randomUUID() };
    await adminDb.doc("suppliers/disposition-supplier").update({ organizationId: "other-org" });
    await expect(call("approveSaleReturn", handover)).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await adminDb.doc("suppliers/disposition-supplier").update({ organizationId });
    const handed = await call<{ transactionId: string }>("approveSaleReturn", handover);
    expect((await adminDb.doc(`inventoryTransactions/${handed.transactionId}`).get()).data()).toMatchObject({ supplierSettlementStatus: "not_recorded", originalCostMinor: 33, supplierId: "disposition-supplier", journalEntryId: null });
    expect((await adminDb.collection("journalEntries").count().get()).data().count).toBe(journalCount);
    expect((await balanceRef.get()).data()).toMatchObject({ onHandQuantity: 6, totalValueMinor: 533 });
    expect((await adminDb.doc(`saleReturnItems/${itemId}`).get()).data()).toMatchObject({ heldDisposedQuantity: 3, heldDisposedCostMinor: 100 });
    await expect(call("approveSaleReturn", { ...handover, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect((await adminDb.doc(`aftersalesCases/${routed.caseId}`).get()).get("recentDispositions")).toHaveLength(3);
  }, 300_000);
  it("allows only one exact serial disposition under concurrent requests and enforces accounting locks", async () => {
    const returnId = "serial-disposition-return", itemId = "serial-disposition-item", serialNumber = "DISPOSE-SN-1";
    await adminDb.doc(`saleReturns/${returnId}`).set({ organizationId, branchId, saleId: "serial-disposition-sale", customerId, status: "approved", inspectionStatus: "completed" });
    await adminDb.doc(`saleReturnItems/${itemId}`).set({ organizationId, branchId, returnId, saleId: "serial-disposition-sale", productId, productName: "Test Product", quantity: 1, serialNumbers: [serialNumber], disposition: "warranty", condition: "non_restockable", inspectionStatus: "completed", costAmountMinor: 125 });
    const serial = adminDb.doc(`serializedItems/${uniquenessDocumentId(organizationId, serialNumber)}`);
    await serial.set({ organizationId, branchId, productId, saleId: "serial-disposition-sale", lastSaleReturnId: returnId, status: "returned_held", active: false, currentUnitCostMinor: 125 });
    const routed = await call<{ caseId: string }>("approveSaleReturn", { returnId, action: "route_aftersales", aftersales: { returnItemId: itemId, serialNumber, complaint: "Inspect serial before returning to stock" }, idempotencyKey: crypto.randomUUID() });
    await adminDb.doc(`aftersalesCases/${routed.caseId}`).update({ status: "cancelled" });
    const payload = { returnId, action: "dispose_held", disposition: { caseId: routed.caseId, outcome: "restock", quantity: 1, reason: "Inspected resellable serial unit", confirmedResellable: true }, idempotencyKey: crypto.randomUUID() };
    await serial.update({ lastSaleReturnId: "wrong-return" });
    await expect(call("approveSaleReturn", payload)).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await serial.update({ lastSaleReturnId: returnId });
    const periodId = uniquenessDocumentId(organizationId, new Date().toISOString().slice(0, 7));
    await adminDb.doc(`accountingPeriods/${periodId}`).set({ organizationId, status: "closed" });
    await expect(call("approveSaleReturn", payload)).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await adminDb.doc(`accountingPeriods/${periodId}`).delete();
    const results = await Promise.allSettled([call("approveSaleReturn", payload), call("approveSaleReturn", { ...payload, idempotencyKey: crypto.randomUUID() })]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect((await serial.get()).data()).toMatchObject({ status: "at_branch", active: true, currentLocationId: "disposition-location" });
    expect((await serial.get()).get("saleId")).toBeUndefined();
    expect((await adminDb.doc(`saleReturnItems/${itemId}`).get()).data()).toMatchObject({ heldDisposedQuantity: 1, heldDisposedCostMinor: 125 });
  }, 300_000);
  it("routes only exact held serials and denies access from another store", async () => {
    const returnId = "serial-service-return", returnItemId = "serial-service-item", serialNumber = "SERVICE-UNIT-1";
    await adminDb.doc(`saleReturns/${returnId}`).set({ organizationId, branchId, saleId: "serial-sale", customerId, customerName: "Test Customer", status: "approved", inspectionStatus: "completed" });
    await adminDb.doc(`saleReturnItems/${returnItemId}`).set({ organizationId, branchId, returnId, saleId: "serial-sale", productId, productName: "Serialized product", quantity: 1, serialNumbers: [serialNumber], disposition: "warranty", condition: "non_restockable", inspectionStatus: "completed" });
    const serialRef = adminDb.doc(`serializedItems/${uniquenessDocumentId(organizationId, serialNumber)}`);
    await serialRef.set({ organizationId, branchId, productId, saleId: "serial-sale", lastSaleReturnId: returnId, status: "sold", active: false });
    const payload = { returnId, action: "route_aftersales", aftersales: { returnItemId, serialNumber, complaint: "Inspect this exact warranty unit" }, idempotencyKey: crypto.randomUUID() };
    await expect(call("approveSaleReturn", { ...payload, aftersales: { ...payload.aftersales, serialNumber: "WRONG-UNIT" } })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    await expect(call("approveSaleReturn", payload)).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await serialRef.update({ status: "returned_held" });
    const before = (await serialRef.get()).data();
    const created = await call<{ caseId: string }>("approveSaleReturn", payload);
    expect((await serialRef.get()).data()).toEqual(before);
    expect((await adminDb.doc(`aftersalesCases/${created.caseId}`).get()).data()).toMatchObject({ serialNumber, quantity: 1, chargeStatus: "not_quoted" });
    const user = await adminAuth.createUser({ email: "service-other-store@example.test", password: "Password!234567" });
    await adminDb.doc(`users/${user.uid}`).set({ uid: user.uid, organizationId, roleId: "branch_manager", branchIds: ["other-store"], warehouseIds: [], status: "active", authorizationVersion: 1 });
    const manager = client("service-other-store"); await signInWithEmailAndPassword(manager.auth, "service-other-store@example.test", "Password!234567");
    await expect(httpsCallable(manager.functions, "getAftersalesWorkspace")({ caseId: created.caseId })).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(httpsCallable(manager.functions, "approveSaleReturn")({ ...payload, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/permission-denied" });
  }, 300_000);
  it("routes inspected returns once without changing stock, money or original walk-in identity", async () => {
    const returnId = "service-routing-return", returnItemId = "service-routing-item";
    const parent = adminDb.doc(`saleReturns/${returnId}`), item = adminDb.doc(`saleReturnItems/${returnItemId}`);
    await parent.set({ organizationId, branchId, saleId: "original-sale", saleNumber: "SALE-ROUTE", returnNumber: "RET-ROUTE", customerId: null, customerName: "Walk-in", kind: "goods_return", status: "approved", inspectionStatus: "completed" });
    await item.set({ organizationId, branchId, returnId, saleId: "original-sale", productId, productName: "Test Product", quantity: 2, serialNumbers: [], disposition: "repair", condition: "non_restockable", inspectionStatus: "completed" });
    const counts = async () => Promise.all(["inventoryEntries", "journalEntries", "customers"].map(async name => (await adminDb.collection(name).count().get()).data().count));
    const before = await counts();
    const payload = { returnId, action: "route_aftersales", aftersales: { returnItemId, complaint: "Inspect and repair returned goods", contactName: "Returning customer", contactPhone: "08012345678" }, idempotencyKey: crypto.randomUUID() };
    await expect(call("approveSaleReturn", { ...payload, aftersales: { returnItemId, complaint: "Missing walk-in contacts" } })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    const [first, second] = await Promise.all([call<{ caseId: string }>("approveSaleReturn", payload), call<{ caseId: string }>("approveSaleReturn", { ...payload, idempotencyKey: crypto.randomUUID() })]);
    expect(first.caseId).toBe(second.caseId);
    expect(await call("approveSaleReturn", payload)).toMatchObject(first);
    await expect(call("approveSaleReturn", { ...payload, aftersales: { ...payload.aftersales, complaint: "Changed request under the same key" } })).rejects.toMatchObject({ code: "functions/already-exists" });
    expect((await adminDb.doc(`aftersalesCases/${first.caseId}`).get()).data()).toMatchObject({ returnId, returnItemId, quantity: 2, status: "open", chargeStatus: "not_quoted", customerId: null, customerName: "Returning customer" });
    expect((await item.get()).get("aftersalesCaseLinks")).toHaveLength(1);
    expect(await call("getAftersalesWorkspace", { caseId: first.caseId })).toMatchObject({ cases: [expect.objectContaining({ id: first.caseId, returnId })] });
    await item.update({ disposition: "resellable" });
    await expect(call("approveSaleReturn", { ...payload, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await item.update({ disposition: "repair", organizationId: "other-org" });
    await expect(call("approveSaleReturn", { ...payload, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/not-found" });
    await item.update({ organizationId }); await parent.update({ inspectionStatus: "required" });
    await expect(call("approveSaleReturn", { ...payload, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect((await parent.get()).get("customerName")).toBe("Walk-in");
    expect(await counts()).toEqual(before);
  }, 300_000);
  it.skipIf(!process.env.FIREBASE_STORAGE_EMULATOR_HOST)("keeps serial photos private, stage-bound, immutable and safely retryable without ledger effects", async () => {
    const created = await call<{ caseId: string }>("createAftersalesCase", { branchId, customerId, productId, serialNumber: "SN-PHOTO", serviceType: "warranty", requestType: "repair", complaint: "Serial label and initial condition", idempotencyKey: crypto.randomUUID() });
    const recordId = created.caseId;
    const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jDqkAAAAASUVORK5CYII=";
    const upload = { action: "upload_evidence", recordId, stage: "intake", serialNumber: "sn-photo", note: "Serial label confirmed manually", contentType: "image/png", base64, idempotencyKey: crypto.randomUUID() };
    const beforeStock = (await adminDb.collection("inventoryEntries").count().get()).data().count;
    const beforeJournals = (await adminDb.collection("journalEntries").count().get()).data().count;
    await expect(call("getAftersalesWorkspace", { ...upload, stage: "handover" })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await expect(call("getAftersalesWorkspace", { ...upload, serialNumber: "WRONG" })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    await expect(call("getAftersalesWorkspace", { ...upload, contentType: "image/jpeg" })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    const first = await call<{ evidenceId: string; uploaded: boolean }>("getAftersalesWorkspace", upload);
    expect(first.uploaded).toBe(true);
    await call("updateAftersalesCase", { caseId: recordId, status: "diagnosed", resolution: "Board inspected carefully", idempotencyKey: crypto.randomUUID() });
    expect(await call("getAftersalesWorkspace", upload)).toMatchObject({ evidenceId: first.evidenceId, uploaded: false });
    await expect(call("getAftersalesWorkspace", { ...upload, note: "Changed historical note" })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    expect(await call("getAftersalesWorkspace", { action: "list_evidence", recordId })).toMatchObject({ evidence: [{ evidenceId: first.evidenceId, stage: "intake", serialNumber: "SN-PHOTO", recordedStatus: "open" }] });
    expect(await call("getAftersalesWorkspace", { action: "read_evidence", recordId, evidenceId: first.evidenceId })).toMatchObject({ base64, contentType: "image/png" });
    const metadata = await adminDb.doc(`aftersalesCases/${recordId}/evidence/${first.evidenceId}`).get();
    expect(metadata.get("generation")).toBeTruthy(); expect(metadata.get("uploadedBy")).toBe(administrator.auth.currentUser!.uid);
    const [stored] = await getStorage(adminApp).bucket("demo-ramadan-warehouse.appspot.com").file(metadata.get("path")).getMetadata();
    expect(stored.metadata?.firebaseStorageDownloadTokens).toBeUndefined();
    const outsider = await adminAuth.createUser({ email: "evidence-outsider@example.test", password: "Password!234567" });
    await adminDb.doc("organizations/other-org").set({ name: "Other test organization", status: "active" });
    await adminDb.doc(`users/${outsider.uid}`).set({ uid: outsider.uid, organizationId: "other-org", roleId: "system_administrator", branchIds: [], warehouseIds: [], status: "active", authorizationVersion: 1 });
    const outside = client("evidence-outsider"); await signInWithEmailAndPassword(outside.auth, "evidence-outsider@example.test", "Password!234567");
    await expect(httpsCallable(outside.functions, "getAftersalesWorkspace")({ action: "read_evidence", recordId, evidenceId: first.evidenceId })).rejects.toMatchObject({ code: "functions/not-found" });
    await adminDb.doc(`aftersalesCases/${recordId}`).update({ evidenceIds: Array.from({ length: 20 }, (_, index) => `photo-${index}`) });
    await expect(call("getAftersalesWorkspace", { ...upload, stage: "diagnosis", idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect((await adminDb.collection("inventoryEntries").count().get()).data().count).toBe(beforeStock);
    expect((await adminDb.collection("journalEntries").count().get()).data().count).toBe(beforeJournals);
  }, 300_000);

  it.skipIf(!process.env.FIREBASE_STORAGE_EMULATOR_HOST)("links supplier handover evidence only to exact returned units and enforces store scope", async () => {
    const recordId = "supplier-photo-return";
    await adminDb.doc(`supplierReturns/${recordId}`).set({ organizationId, branchId, productId, status: "posted", serialNumbers: ["SUP-1", "SUP-2"] });
    const upload = { action: "upload_evidence", recordId, stage: "handover", serialNumber: "SUP-1", note: "Supplier accepted this serial", contentType: "image/png", base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jDqkAAAAASUVORK5CYII=", idempotencyKey: crypto.randomUUID() };
    await expect(call("getProcurementWorkspace", { ...upload, serialNumber: "NOT-RETURNED" })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    const photo = await call<{ evidenceId: string }>("getProcurementWorkspace", upload);
    expect(await call("getProcurementWorkspace", upload)).toMatchObject({ evidenceId: photo.evidenceId, uploaded: false });
    await expect(call("getAftersalesWorkspace", { action: "read_evidence", recordId, evidenceId: photo.evidenceId })).rejects.toMatchObject({ code: "functions/not-found" });
    const user = await adminAuth.createUser({ email: "evidence-manager@example.test", password: "Password!234567" });
    await adminDb.doc(`users/${user.uid}`).set({ uid: user.uid, organizationId, roleId: "branch_manager", branchIds: ["another-store"], warehouseIds: [], status: "active", authorizationVersion: 1 });
    const manager = client("evidence-manager"); await signInWithEmailAndPassword(manager.auth, "evidence-manager@example.test", "Password!234567");
    await expect(httpsCallable(manager.functions, "getProcurementWorkspace")({ action: "read_evidence", recordId, evidenceId: photo.evidenceId })).rejects.toMatchObject({ code: "functions/permission-denied" });
    const reader = await adminAuth.createUser({ email: "evidence-auditor@example.test", password: "Password!234567" });
    await adminDb.doc(`users/${reader.uid}`).set({ uid: reader.uid, organizationId, roleId: "auditor", branchIds: [], warehouseIds: [], status: "active", authorizationVersion: 1 });
    const auditor = client("evidence-auditor"); await signInWithEmailAndPassword(auditor.auth, "evidence-auditor@example.test", "Password!234567");
    await expect(httpsCallable(auditor.functions, "getProcurementWorkspace")({ ...upload, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/permission-denied" });
    const metadata = await adminDb.doc(`supplierReturns/${recordId}/evidence/${photo.evidenceId}`).get();
    await getStorage(adminApp).bucket("demo-ramadan-warehouse.appspot.com").file(metadata.get("path")).save(Buffer.from("tampered"));
    // Generation-qualified reads must not fall back to the replaced current object.
    await expect(call("getProcurementWorkspace", { action: "read_evidence", recordId, evidenceId: photo.evidenceId })).rejects.toBeTruthy();
  }, 300_000);
  it.skipIf(!process.env.FIREBASE_STORAGE_EMULATOR_HOST)("validates GRN serial evidence against the posted ledger without reposting goods", async () => {
    const recordId = "photo-grn", transactionId = "photo-receipt-movement", locationId = "photo-receiving-location";
    await adminDb.doc(`purchaseReceipts/${recordId}`).set({ organizationId, branchId, productId, purchaseOrderId: "photo-order", inventoryTransactionId: transactionId, receivingLocationId: locationId, quantity: 1 });
    await adminDb.doc(`inventoryTransactions/${transactionId}`).set({ organizationId, status: "posted", transactionType: "inventory_receipt", referenceId: "photo-order", destinationLocationId: locationId });
    await adminDb.doc("inventoryEntries/photo-received-unit").set({ organizationId, transactionId, locationId, productId, quantityDelta: 1, serialNumber: "REC-1" });
    const stock = (await adminDb.collection("inventoryEntries").count().get()).data().count;
    const journals = (await adminDb.collection("journalEntries").count().get()).data().count;
    const upload = { action: "upload_evidence", evidenceKind: "purchase_receipt", recordId, stage: "receiving", serialNumber: "REC-1", note: "Received serial and packaging confirmed", contentType: "image/png", base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jDqkAAAAASUVORK5CYII=", idempotencyKey: crypto.randomUUID() };
    await expect(call("getProcurementWorkspace", { ...upload, serialNumber: "ANOTHER-UNIT" })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    await expect(call("getProcurementWorkspace", { ...upload, stage: "handover" })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    const photo = await call<{ evidenceId: string }>("getProcurementWorkspace", upload);
    expect(await call("getProcurementWorkspace", upload)).toMatchObject({ evidenceId: photo.evidenceId, uploaded: false });
    expect(await call("getProcurementWorkspace", { action: "list_evidence", evidenceKind: "purchase_receipt", recordId })).toMatchObject({ evidence: [{ stage: "receiving", serialNumber: "REC-1", recordedStatus: "received" }] });
    expect(await call("getProcurementWorkspace", { action: "read_evidence", evidenceKind: "purchase_receipt", recordId, evidenceId: photo.evidenceId })).toMatchObject({ base64: upload.base64 });
    await expect(call("getProcurementWorkspace", { action: "read_evidence", recordId, evidenceId: photo.evidenceId })).rejects.toMatchObject({ code: "functions/not-found" });
    await adminDb.doc(`inventoryTransactions/${transactionId}`).update({ status: "draft" });
    await expect(call("getProcurementWorkspace", { ...upload, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect((await adminDb.collection("inventoryEntries").count().get()).data().count).toBe(stock);
    expect((await adminDb.collection("journalEntries").count().get()).data().count).toBe(journals);
  }, 300_000);

  it.skipIf(!process.env.FIREBASE_STORAGE_EMULATOR_HOST)("records return inspection evidence before approval and preserves retry/read access afterwards", async () => {
    const recordId = "photo-customer-return";
    await adminDb.doc(`saleReturns/${recordId}`).set({ organizationId, branchId, kind: "goods_return", status: "submitted", inspectionStatus: "required" });
    await adminDb.doc("saleReturnItems/photo-returned-unit").set({ organizationId, returnId: recordId, productId, quantity: 1, serialNumbers: ["RET-1"] });
    const stock = (await adminDb.collection("inventoryEntries").count().get()).data().count;
    const journals = (await adminDb.collection("journalEntries").count().get()).data().count;
    const upload = { action: "upload_evidence", recordId, stage: "inspection", serialNumber: "RET-1", note: "Inspected serial label and damage", contentType: "image/png", base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jDqkAAAAASUVORK5CYII=", idempotencyKey: crypto.randomUUID() };
    await expect(call("getSaleReturnWorkspace", { ...upload, serialNumber: "NOT-RETURNED" })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    const photo = await call<{ evidenceId: string }>("getSaleReturnWorkspace", upload);
    expect((await adminDb.doc(`saleReturns/${recordId}`).get()).get("inspectionStatus")).toBe("required");
    await adminDb.doc(`saleReturns/${recordId}`).update({ status: "approved" });
    expect(await call("getSaleReturnWorkspace", upload)).toMatchObject({ evidenceId: photo.evidenceId, uploaded: false });
    expect(await call("getSaleReturnWorkspace", { action: "read_evidence", recordId, evidenceId: photo.evidenceId })).toMatchObject({ base64: upload.base64 });
    await expect(call("getSaleReturnWorkspace", { ...upload, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await adminDb.doc(`saleReturns/${recordId}`).update({ status: "submitted", kind: "reservation_cancellation" });
    await expect(call("getSaleReturnWorkspace", { ...upload, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect((await adminDb.collection("inventoryEntries").count().get()).data().count).toBe(stock);
    expect((await adminDb.collection("journalEntries").count().get()).data().count).toBe(journals);
  }, 300_000);

  it("records a complimentary warranty case without stock or journal effects", async () => {
    const beforeStock = (await adminDb.collection("inventoryEntries").count().get()).data().count;
    const beforeJournals = (await adminDb.collection("journalEntries").count().get()).data().count;
    const key = crypto.randomUUID();
    const input = { branchId, customerId, productId, serviceType: "warranty", requestType: "warranty", complaint: "Inverter is not starting", idempotencyKey: key };
    const first = await call<{ caseId: string; created: boolean }>("createAftersalesCase", input);
    const again = await call<{ caseId: string; created: boolean }>("createAftersalesCase", input);
    expect(first).toMatchObject({ created: true });
    expect(again).toMatchObject({ caseId: first.caseId, created: false });
    await call("setAftersalesCharge", { caseId: first.caseId, chargeAmountMinor: 0, reason: "Covered without charge", idempotencyKey: crypto.randomUUID() });
    await call("updateAftersalesCase", { caseId: first.caseId, status: "diagnosed", resolution: "Power board inspected", idempotencyKey: crypto.randomUUID() });
    await call("updateAftersalesCase", { caseId: first.caseId, status: "awaiting_collection", resolution: "Power board repaired", idempotencyKey: crypto.randomUUID() });
    await call("updateAftersalesCase", { caseId: first.caseId, status: "completed", resolution: "Customer collected repaired item", idempotencyKey: crypto.randomUUID() });
    expect((await adminDb.doc(`aftersalesCases/${first.caseId}`).get()).data()).toMatchObject({ status: "completed", chargeStatus: "complimentary" });
    expect((await adminDb.collection("journalEntries").count().get()).data().count).toBe(beforeJournals);
    expect((await adminDb.collection("inventoryEntries").count().get()).data().count).toBe(beforeStock);
  });

  it("tracks paid non-warranty service and uses the selected bank ledger account exactly once", async () => {
    const created = await call<{ caseId: string }>("createAftersalesCase", { branchId, customerId, productId, serviceType: "non_warranty", requestType: "repair", complaint: "Damaged cable needs replacement", idempotencyKey: crypto.randomUUID() });
    await call("setAftersalesCharge", { caseId: created.caseId, chargeAmountMinor: 50_000, reason: "Out-of-warranty labour", idempotencyKey: crypto.randomUUID() });
    const key = crypto.randomUUID();
    const payment = { caseId: created.caseId, method: "bank_transfer", bankAccountId, amountMinor: 20_000, reference: "TRANSFER-001", idempotencyKey: key };
    const first = await call<{ paymentId: string; recorded: boolean }>("recordAftersalesPayment", payment);
    expect((await call<typeof first>("recordAftersalesPayment", payment))).toMatchObject({ paymentId: first.paymentId, recorded: false });
    expect((await adminDb.doc(`aftersalesCases/${created.caseId}`).get()).data()).toMatchObject({ chargeStatus: "partially_paid", outstandingAmountMinor: 30_000 });
    const posted = await adminDb.collection("journalEntries").where("referenceId", "==", first.paymentId).get();
    expect(posted.size).toBe(1);
    const lines = await adminDb.collection("journalLines").where("journalEntryId", "==", posted.docs[0]!.id).get();
    expect(lines.docs.map((line) => line.get("accountCode"))).toEqual(expect.arrayContaining(["1043", "4100"]));
    expect((await adminDb.doc(`aftersalesPayments/${first.paymentId}`).get()).get("bankAccountId")).toBe(bankAccountId);
    await expect(call("recordAftersalesPayment", { ...payment, idempotencyKey: crypto.randomUUID(), bankAccountId: "wrong-account" })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect((await adminDb.doc(`aftersalesCases/${created.caseId}`).get()).get("outstandingAmountMinor")).toBe(30_000);
  });

  it("provides four ledger-derived statements and tax evidence without a fabricated statutory rule", async () => {
    const posted = await adminDb.collection("journalEntries").where("organizationId", "==", organizationId).limit(1).get();
    const effectiveAt = (posted.docs[0]!.get("effectiveAt") as Timestamp).toDate();
    const year = effectiveAt.getUTCFullYear();
    const month = effectiveAt.getUTCMonth();
    const period = {
      fromDate: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10),
      toDate: new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10),
    };
    const trial = await call<{ totalDebitMinor: number; totalCreditMinor: number }>("generateFinancialStatement", { ...period, reportType: "trial_balance" });
    expect(trial.totalDebitMinor).toBe(trial.totalCreditMinor);
    const income = await call<{ profitMinor: number }>("generateFinancialStatement", { ...period, reportType: "income_statement" });
    // Service income plus the two original-cost COGS restorations above.
    // Neither restocking journal moves cash or creates taxable sales revenue.
    expect(income.profitMinor).toBe(20_000 + 33 + 125);
    const balance = await call<{ balanced: boolean }>("generateFinancialStatement", { ...period, reportType: "balance_sheet" });
    expect(balance.balanced).toBe(true);
    const cashFlow = await call<{ netCashMovementMinor: number }>("generateFinancialStatement", { ...period, reportType: "cash_flow" });
    expect(cashFlow.netCashMovementMinor).toBe(20_000);
    const tax = await call<{ statutoryRuleReviewRequired: boolean; vat: { calculatedLiabilityMinor: number } }>("getTaxWorkspace", period);
    expect(tax).toMatchObject({ statutoryRuleReviewRequired: true, vat: { calculatedLiabilityMinor: 0 } });
  });
  it("includes more than 10,000 ledger lines, 1,000 journals and 100 company accounts", async () => {
    const effectiveAt = Timestamp.now();
    const date = effectiveAt.toDate().toISOString().slice(0, 10);
    const period = { fromDate: date, toDate: date, branchId };
    const beforeCash = await call<{ netCashMovementMinor: number }>("generateFinancialStatement", { ...period, reportType: "cash_flow" });
    const beforeTax = await call<{ vat: { calculatedLiabilityMinor: number } }>("getTaxWorkspace", period);
    const count = 3340;
    const documents: Array<{ path: string; data: Record<string, unknown> }> = [];
    for (let index = 0; index < 100; index++) documents.push({ path: `bankAccounts/paging-${String(index).padStart(3, "0")}`, data: { organizationId, ledgerAccountCode: `B${index}`, active: true } });
    documents.push({ path: "bankAccounts/zz-paging-bank", data: { organizationId, ledgerAccountCode: "1998", active: true } });
    for (let index = 0; index < count; index++) {
      const entryId = `paging-${String(index).padStart(5, "0")}`;
      documents.push({ path: `journalEntries/${entryId}`, data: { organizationId, branchId, journalType: "branch_sale", effectiveAt, status: "posted" } });
      for (const [code, debit, credit] of [["1998", 2, 0], ["4010", 0, 1], ["2100", 0, 1]] as const)
        documents.push({ path: `journalLines/${entryId}-${code}`, data: { organizationId, branchId, journalEntryId: entryId, effectiveAt, accountCode: code, accountName: code, debitMinor: debit, creditMinor: credit } });
    }
    for (let offset = 0; offset < documents.length; offset += 400) {
      const batch = adminDb.batch();
      for (const document of documents.slice(offset, offset + 400)) batch.set(adminDb.doc(document.path), document.data);
      await batch.commit();
    }
    const trial = await call<{ totalDebitMinor: number; totalCreditMinor: number }>("generateFinancialStatement", { ...period, reportType: "trial_balance" });
    expect(trial.totalDebitMinor).toBe(trial.totalCreditMinor);
    expect(trial.totalDebitMinor).toBeGreaterThanOrEqual(count * 2);
    const cash = await call<{ netCashMovementMinor: number }>("generateFinancialStatement", { ...period, reportType: "cash_flow" });
    expect(cash.netCashMovementMinor).toBe(beforeCash.netCashMovementMinor + count * 2);
    const tax = await call<{ vat: { calculatedLiabilityMinor: number } }>("getTaxWorkspace", period);
    expect(tax.vat.calculatedLiabilityMinor).toBe(beforeTax.vat.calculatedLiabilityMinor + count);
    const balance = await call<{ balanced: boolean }>("generateFinancialStatement", { ...period, reportType: "balance_sheet" });
    expect(balance.balanced).toBe(true);
  }, 120_000);
});
