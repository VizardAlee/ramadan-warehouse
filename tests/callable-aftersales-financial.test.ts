import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { getApps as getAdminApps, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { balanceDocumentId, uniquenessDocumentId } from "../functions/src/inventory/calculations";

const projectId = process.env.TEST_FIREBASE_PROJECT_ID ?? "demo-ramadan-warehouse";
if (!projectId.startsWith("demo-")) throw new Error("Aftersales acceptance requires an isolated demo project.");
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
  it("assigns existing employees without app accounts and audits reassignment without stock or financial changes", async () => {
    const created = await call<{ caseId: string }>("createAftersalesCase", { branchId, customerId, serviceType: "warranty", requestType: "repair", complaint: "Inspect inverter for warranty repair", idempotencyKey: crypto.randomUUID() });
    const employeeId = "service-technician";
    const employee = adminDb.doc(`employees/${employeeId}`);
    const mapping = adminDb.doc(`employeeStaffIds/${organizationId}_TECH-01`);
    await employee.set({ organizationId, staffId: "TECH-01", fullName: "Amina Technician", branchId, status: "active", userId: null, phone: "private-phone", monthlySalaryMinor: 9999 });
    await mapping.set({ organizationId, employeeId });
    for (const [name, roleId, assignedBranch] of [["cashier", "sales_cashier", branchId], ["other-manager", "branch_manager", "unassigned-service-store"]]) {
      const account = await adminAuth.createUser({ email: `${name}-assignment@example.test`, password: "Password!234567" });
      await adminDb.doc(`users/${account.uid}`).set({ uid: account.uid, organizationId, roleId, branchIds: [assignedBranch], warehouseIds: [], status: "active", authDisabled: false, authorizationVersion: 1 });
      const unauthorized = client(`${name}-assignment`);
      await signInWithEmailAndPassword(unauthorized.auth, `${name}-assignment@example.test`, "Password!234567");
      await expect(httpsCallable(unauthorized.functions, "updateAftersalesCase")({ caseId: created.caseId, action: "assign_staff", staffId: "TECH-01", reason: "Unauthorized assignment attempt", idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/permission-denied" });
    }
    const beforeStock = (await adminDb.collection("inventoryEntries").count().get()).data().count;
    const beforeJournals = (await adminDb.collection("journalEntries").count().get()).data().count;
    const input = { caseId: created.caseId, action: "assign_staff", operatingContext: { type: "branch", id: branchId }, staffId: "tech-01", reason: "Assign experienced repair technician", idempotencyKey: crypto.randomUUID() };
    expect(await call("updateAftersalesCase", input)).toMatchObject({ updated: true });
    expect(await call("updateAftersalesCase", input)).toMatchObject({ updated: false });
    await expect(call("updateAftersalesCase", { ...input, staffId: null })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    const saved = await adminDb.doc(`aftersalesCases/${created.caseId}`).get();
    expect(saved.get("assignedStaff")).toEqual({ employeeId, staffId: "TECH-01", name: "Amina Technician" });
    expect(saved.get("status")).toBe("open");
    const fresh = () => ({ ...input, idempotencyKey: crypto.randomUUID() });
    for (const changes of [{ status: "inactive" }, { status: "on_leave" }, { status: "active", organizationId: "foreign-org" }, { organizationId, status: "active", branchId: "foreign-store" }]) {
      await employee.update(changes);
      await expect(call("updateAftersalesCase", fresh())).rejects.toMatchObject({ code: "functions/failed-precondition" });
    }
    await employee.update({ organizationId, status: "active", branchId: null });
    expect(await call("updateAftersalesCase", fresh())).toMatchObject({ updated: true });
    const history = await adminDb.collection("auditLogs").where("entityId", "==", created.caseId).get();
    const events = history.docs.filter(doc => doc.get("action") === "aftersales_case.staff_assigned");
    expect(events).toHaveLength(2);
    expect(events[0]!.get("after").assignedStaff).toEqual({ employeeId, staffId: "TECH-01", name: "Amina Technician" });
    expect(events[0]!.get("reason")).toBe(input.reason);
    const unassign = { ...fresh(), staffId: null, reason: "Return case to unassigned service queue" };
    await call("updateAftersalesCase", unassign);
    expect((await saved.ref.get()).get("assignedStaff")).toBeNull();
    await saved.ref.update({ status: "completed" });
    await expect(call("updateAftersalesCase", fresh())).rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect((await adminDb.collection("journalEntries").count().get()).data().count).toBe(beforeJournals);
    expect((await adminDb.collection("inventoryEntries").count().get()).data().count).toBe(beforeStock);
    expect((await employee.get()).get("userId")).toBeNull();
  });
  it("receives partial supplier replacements at original cost with shared credit limits and safe concurrent retries", async () => {
    const returnId = "replacement-return", itemId = "replacement-item", caseId = "replacement-case", handoverId = "replacement-handover", locationId = "replacement-location", product = "replacement-product";
    const base = { organizationId, branchId, productId: product, saleId: "replacement-sale" };
    await adminDb.doc(`products/${product}`).set({ organizationId, name: "Replacement unit", sku: "REP-1", active: true, trackingType: "quantity" });
    // Use a separate store stock location to avoid ambiguous active sales-stock configuration.
    await adminDb.doc(`inventoryLocations/${locationId}`).set({ organizationId, branchId, type: "branch", status: "active" });
    await adminDb.doc(`suppliers/replacement-supplier`).set({ organizationId, name: "Warranty supplier", active: true, outstandingBalanceMinor: 1000 });
    await adminDb.doc(`saleReturns/${returnId}`).set({ ...base, status: "approved", inspectionStatus: "completed" });
    await adminDb.doc(`saleReturnItems/${itemId}`).set({ ...base, returnId, condition: "non_restockable", inspectionStatus: "completed", disposition: "warranty" });
    await adminDb.doc(`aftersalesCases/${caseId}`).set({ ...base, returnId, returnItemId: itemId, status: "completed" });
    const handover = adminDb.doc(`inventoryTransactions/${handoverId}`);
    await handover.set({ ...base, saleReturnId: returnId, returnItemId: itemId, aftersalesCaseId: caseId, supplierId: "replacement-supplier", transactionType: "held_return_supplier_handover", status: "posted", trackingType: "quantity", quantity: 3, originalCostMinor: 100, effectiveAt: Timestamp.now() });
    const balance = adminDb.doc(`inventoryBalances/${balanceDocumentId(organizationId, product, locationId)}`);
    await balance.set({ ...base, locationId, onHandQuantity: 5, reservedQuantity: 2, availableQuantity: 3, totalValueMinor: 500, version: 1 });
    const payload = { returnId, action: "receive_supplier_replacement", replacement: { handoverId, quantity: 1, supplierReference: "REPLACEMENT-01", confirmedResellable: true, reason: "Inspected supplier replacement safe for resale" }, idempotencyKey: crypto.randomUUID() };
    await expect(call("approveSaleReturn", { ...payload, replacement: { ...payload.replacement, confirmedResellable: false } })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    const period = adminDb.doc(`accountingPeriods/${uniquenessDocumentId(organizationId, new Date().toISOString().slice(0, 7))}`);
    await period.set({ organizationId, status: "closed" });
    await expect(call("approveSaleReturn", payload)).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await period.delete();
    const first = await call<{ transactionId: string; journalEntryId: string }>("approveSaleReturn", payload);
    expect(await call("approveSaleReturn", payload)).toEqual(first);
    const financeRecord = await adminAuth.createUser({ email: "replacement-finance@example.test", password: "Password!234567" });
    await adminDb.doc(`users/${financeRecord.uid}`).set({ uid: financeRecord.uid, organizationId, roleId: "finance_officer", branchIds: [branchId], warehouseIds: [], status: "active", authDisabled: false, authorizationVersion: 1 });
    const finance = client("replacement-finance");
    await signInWithEmailAndPassword(finance.auth, "replacement-finance@example.test", "Password!234567");
    // Return approval alone must not grant receiving, including replaying a known operation.
    await expect(httpsCallable(finance.functions, "approveSaleReturn")(payload)).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(call("approveSaleReturn", { ...payload, replacement: { ...payload.replacement, quantity: 2 } })).rejects.toMatchObject({ code: "functions/already-exists" });
    expect((await balance.get()).data()).toMatchObject({ onHandQuantity: 6, reservedQuantity: 2, availableQuantity: 4, totalValueMinor: 533 });
    expect((await handover.get()).data()).toMatchObject({ supplierSettledQuantity: 1, supplierSettledOriginalCostMinor: 33, supplierReplacementQuantity: 1 });
    const lines = (await adminDb.collection("journalLines").where("journalEntryId", "==", first.journalEntryId).get()).docs.map(doc => doc.data());
    expect(lines.find(line => line.accountCode === "1200")?.debitMinor).toBe(33);
    expect(lines.find(line => line.accountCode === "5000")?.creditMinor).toBe(33);
    expect((await adminDb.doc("suppliers/replacement-supplier").get()).get("outstandingBalanceMinor")).toBe(1000);
    await expect(call("reverseInventoryTransaction", { transactionId: first.transactionId, reason: "Cannot reverse just replacement stock", idempotencyKey: crypto.randomUUID() })).rejects.toThrow();
    // An already credited unit consumes the same original-cost/quantity limit.
    await handover.update({ supplierSettledQuantity: 2, supplierSettledOriginalCostMinor: 67 });
    const next = { ...payload, idempotencyKey: crypto.randomUUID() };
    const races = await Promise.allSettled([call("approveSaleReturn", next), call("approveSaleReturn", { ...next, idempotencyKey: crypto.randomUUID() })]);
    expect(races.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect((await handover.get()).data()).toMatchObject({ supplierSettledQuantity: 3, supplierSettledOriginalCostMinor: 100, supplierReplacementQuantity: 2, supplierSettlementStatus: "settled" });
    expect((await balance.get()).data()).toMatchObject({ onHandQuantity: 7, reservedQuantity: 2, totalValueMinor: 566 });
    await expect(call("approveSaleReturn", { ...payload, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    // Leave one stock location for following tests.
    await adminDb.doc(`inventoryLocations/${locationId}`).update({ status: "inactive" });
  });

  it("receives exact replacement serials without erasing the original unit's history", async () => {
    const returnId = "replacement-serial-return", itemId = "replacement-serial-item", caseId = "replacement-serial-case", handoverId = "replacement-serial-handover", product = "replacement-serial-product", locationId = "replacement-serial-location";
    const base = { organizationId, branchId, productId: product, saleId: "replacement-serial-sale" };
    await adminDb.doc(`products/${product}`).set({ organizationId, name: "Serialized warranty unit", sku: "REP-S", active: true, trackingType: "serial" });
    await adminDb.doc(`inventoryLocations/${locationId}`).set({ organizationId, branchId, type: "branch", status: "active" });
    await adminDb.doc(`saleReturns/${returnId}`).set({ ...base, status: "approved", inspectionStatus: "completed" });
    await adminDb.doc(`saleReturnItems/${itemId}`).set({ ...base, returnId, condition: "non_restockable", inspectionStatus: "completed", disposition: "warranty" });
    await adminDb.doc(`aftersalesCases/${caseId}`).set({ ...base, returnId, returnItemId: itemId, status: "completed" });
    const originalSerial = adminDb.doc(`serializedItems/${uniquenessDocumentId(organizationId, "OLD-REPLACED-1")}`);
    await originalSerial.set({ ...base, serialNumber: "OLD-REPLACED-1", active: false, status: "returned_to_supplier", lastTransactionId: handoverId, currentUnitCostMinor: 125 });
    await adminDb.doc(`inventoryTransactions/${handoverId}`).set({ ...base, saleReturnId: returnId, returnItemId: itemId, aftersalesCaseId: caseId, supplierId: "replacement-supplier", transactionType: "held_return_supplier_handover", status: "posted", trackingType: "serial", serialNumber: "OLD-REPLACED-1", serializedItemId: originalSerial.id, quantity: 1, originalCostMinor: 125, effectiveAt: Timestamp.now() });
    const payload = { returnId, action: "receive_supplier_replacement", replacement: { handoverId, quantity: 1, supplierReference: "SERIAL-REPLACEMENT-01", confirmedResellable: true, reason: "New warranty unit inspected safe for sale", serialNumber: "NEW-REPLACEMENT-1" }, idempotencyKey: crypto.randomUUID() };
    await expect(call("approveSaleReturn", { ...payload, replacement: { ...payload.replacement, serialNumber: undefined } })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    const duplicate = adminDb.doc(`serializedItems/${uniquenessDocumentId(organizationId, "NEW-REPLACEMENT-1")}`);
    await duplicate.set({ organizationId, active: true });
    await expect(call("approveSaleReturn", payload)).rejects.toMatchObject({ code: "functions/already-exists" });
    await duplicate.delete();
    await originalSerial.update({ status: "at_branch" });
    await expect(call("approveSaleReturn", payload)).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await originalSerial.update({ status: "returned_to_supplier" });
    const result = await call<{ transactionId: string }>("approveSaleReturn", payload);
    expect((await duplicate.get()).data()).toMatchObject({ status: "at_branch", active: true, currentUnitCostMinor: 125, replacementForSerialId: originalSerial.id, lastTransactionId: result.transactionId });
    expect((await originalSerial.get()).data()).toMatchObject({ status: "returned_to_supplier", active: false, saleId: "replacement-serial-sale", replacementSerialId: duplicate.id });
    if (process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
      const photo = { action: "upload_evidence", evidenceKind: "supplier_replacement", recordId: result.transactionId, stage: "receiving", serialNumber: "NEW-REPLACEMENT-1", note: "Replacement serial and condition verified", contentType: "image/png", base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jDqkAAAAASUVORK5CYII=", idempotencyKey: crypto.randomUUID() };
      await expect(call("getProcurementWorkspace", { ...photo, serialNumber: "OLD-REPLACED-1" })).rejects.toMatchObject({ code: "functions/invalid-argument" });
      const evidence = await call<{ evidenceId: string }>("getProcurementWorkspace", photo);
      expect(await call("getProcurementWorkspace", photo)).toMatchObject({ evidenceId: evidence.evidenceId, uploaded: false });
      const recorded = await adminDb.doc(`inventoryTransactions/${result.transactionId}/evidence/${evidence.evidenceId}`).get();
      expect(recorded.data()).toMatchObject({ kind: "supplier_replacement", productId: product, serialNumber: "NEW-REPLACEMENT-1", stage: "receiving" });
    }
    await adminDb.doc(`inventoryLocations/${locationId}`).update({ status: "inactive" });
  });

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
    await expect(call("createAftersalesCase", { ...input, complaint: "Changed original complaint" })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    await adminDb.doc(`idempotencyKeys/${organizationId}_createAftersalesCase_${key}`).update({ requestFingerprint: FieldValue.delete() });
    expect(await call("createAftersalesCase", input)).toMatchObject({ caseId: first.caseId, created: false });
    await expect(call("createAftersalesCase", { ...input, customerId: "different-customer" })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    const charge = { caseId: first.caseId, chargeAmountMinor: 0, reason: "Covered without charge", idempotencyKey: crypto.randomUUID() };
    await call("setAftersalesCharge", charge);
    expect(await call("setAftersalesCharge", charge)).toMatchObject({ recorded: false });
    await expect(call("setAftersalesCharge", { ...charge, chargeAmountMinor: 100 })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    const diagnosis = { caseId: first.caseId, status: "diagnosed", resolution: "Power board inspected", idempotencyKey: crypto.randomUUID() };
    await call("updateAftersalesCase", diagnosis);
    expect(await call("updateAftersalesCase", diagnosis)).toMatchObject({ updated: false });
    await expect(call("updateAftersalesCase", { ...diagnosis, status: "in_service" })).rejects.toMatchObject({ code: "functions/invalid-argument" });
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
    await expect(call("recordAftersalesPayment", { ...payment, amountMinor: 21_000 })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    const operation = adminDb.doc(`idempotencyKeys/${organizationId}_recordAftersalesPayment_${key}`);
    await operation.update({ requestFingerprint: FieldValue.delete() });
    expect(await call("recordAftersalesPayment", payment)).toMatchObject({ paymentId: first.paymentId, recorded: false });
    await expect(call("recordAftersalesPayment", { ...payment, bankAccountId: "different-bank" })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    const staff = await adminAuth.createUser({ email: "service-scope@example.test", password: "Password!234567" });
    await adminDb.doc(`users/${staff.uid}`).set({ uid: staff.uid, organizationId, roleId: "branch_manager", branchIds: [branchId], warehouseIds: [], status: "active", authDisabled: false, authorizationVersion: 1 });
    const scoped = client("service-scope");
    await signInWithEmailAndPassword(scoped.auth, "service-scope@example.test", "Password!234567");
    await adminDb.doc(`aftersalesCases/${created.caseId}`).update({ branchId: "unassigned-store" });
    await expect(httpsCallable(scoped.functions, "recordAftersalesPayment")(payment)).rejects.toMatchObject({ code: "functions/permission-denied" });
    await adminDb.doc(`aftersalesCases/${created.caseId}`).update({ branchId });
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
    // Service income plus restock and supplier-replacement original-cost restorations.
    // Neither restocking journal moves cash or creates taxable sales revenue.
    expect(income.profitMinor).toBe(20_000 + 33 + 125 + 66 + 125);
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
  it("bills catalogue services with immutable configured VAT and balanced partial receipts without physical stock", async () => {
    const service = await call<{ productId: string }>("saveProduct", { name: "Installation labour", sku: "LABOUR-CATALOGUE", itemKind: "service", trackingType: "quantity", unitOfMeasure: "job", active: true, defaultUnitCostMinor: 0, idempotencyKey: crypto.randomUUID() });
    const rate = { productId: service.productId, basePriceMinor: 10000, vatRateBasisPoints: 750, active: true, idempotencyKey: crypto.randomUUID() };
    await call("saveProductSalesPrice", rate);
    const work = await call<{ products: Array<{ id: string }>; serviceItems: Array<{ id: string; grossAmountMinor: number }> }>("getAftersalesWorkspace", { branchId });
    expect(work.products.some(product => product.id === service.productId)).toBe(false);
    expect(work.serviceItems.find(product => product.id === service.productId)?.grossAmountMinor).toBe(10750);
    const created = await call<{ caseId: string }>("createAftersalesCase", { branchId, customerId, serviceItemId: service.productId, serviceType: "non_warranty", requestType: "installation", complaint: "Install the customer's inverter", idempotencyKey: crypto.randomUUID() });
    await call("saveProductSalesPrice", { ...rate, basePriceMinor: 15000, vatRateBasisPoints: 0, idempotencyKey: crypto.randomUUID() });
    await call("setAftersalesCharge", { caseId: created.caseId, chargeAmountMinor: 10750, reason: "Agreed original catalogue charge including VAT", idempotencyKey: crypto.randomUUID() });
    const before = (await adminDb.collection("inventoryEntries").count().get()).data().count;
    const receipts = [];
    for (const amountMinor of [1455, 9295]) {
      const payload = { caseId: created.caseId, method: "bank_transfer", bankAccountId, amountMinor, reference: "Service instalment", idempotencyKey: crypto.randomUUID() };
      const paid = await call<{ paymentId: string }>("recordAftersalesPayment", payload);
      expect(await call("recordAftersalesPayment", payload)).toMatchObject({ paymentId: paid.paymentId, recorded: false });
      receipts.push((await adminDb.doc(`aftersalesPayments/${paid.paymentId}`).get()).data()!);
      const journal = await adminDb.doc(`journalEntries/${receipts.at(-1)!.journalEntryId}`).get();
      expect(journal.get("totalDebitMinor")).toBe(amountMinor);
      expect(journal.get("totalCreditMinor")).toBe(amountMinor);
      const lines = (await adminDb.collection("journalLines").where("journalEntryId", "==", journal.id).get()).docs;
      expect(lines.reduce((sum, line) => sum + line.get("debitMinor") - line.get("creditMinor"), 0)).toBe(0);
      expect(lines.find(line => line.get("accountCode") === "2100")?.get("creditMinor")).toBe(receipts.at(-1)!.vatAmountMinor);
    }
    expect(receipts.reduce((sum, payment) => sum + payment.vatAmountMinor, 0)).toBe(750);
    expect(receipts.reduce((sum, payment) => sum + payment.netAmountMinor, 0)).toBe(10000);
    const saved = await adminDb.doc(`aftersalesCases/${created.caseId}`).get();
    expect(saved.data()).toMatchObject({ serviceBillingVersion: 2, chargeVatMinor: 750, recognizedVatMinor: 750, amountPaidMinor: 10750, outstandingAmountMinor: 0, serviceCatalog: { basePriceMinor: 10000, vatRateBasisPoints: 750 } });
    const history = await call<{ payments: Array<{ id: string; amountMinor: number }>; nextCursor: string | null }>("getAftersalesWorkspace", { action: "list_payments", caseId: created.caseId });
    expect(history.payments).toHaveLength(2);
    const receipt = history.payments.find(row => row.amountMinor === 9295)!;
    const refund = { action: "refund", caseId: created.caseId, originalPaymentId: receipt.id, amountMinor: 1455, method: "bank_transfer", bankAccountId, reason: "Correct duplicated service collection", idempotencyKey: crypto.randomUUID() };
    const results = await Promise.all([call<{ recorded: boolean; paymentId: string }>("recordAftersalesPayment", refund), call<{ recorded: boolean; paymentId: string }>("recordAftersalesPayment", refund)]);
    expect(results.filter(result => result.recorded)).toHaveLength(1);
    expect(new Set(results.map(result => result.paymentId)).size).toBe(1);
    expect(await call("recordAftersalesPayment", refund)).toMatchObject({ recorded: false, paymentId: results[0]!.paymentId });
    for (const changed of [{ amountMinor: 1454 }, { reason: "Different refund instructions" }, { originalPaymentId: history.payments.find(row => row.id !== receipt.id)!.id }])
      await expect(call("recordAftersalesPayment", { ...refund, ...changed })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    const refunded = await adminDb.doc(`aftersalesPayments/${results[0]!.paymentId}`).get();
    expect(refunded.data()).toMatchObject({ entryType: "refund", originalPaymentId: receipt.id, amountMinor: 1455, vatAmountMinor: 102, bankAccountId, allocationPolicy: "cumulative_net_receipts" });
    const original = await adminDb.doc(`aftersalesPayments/${receipt.id}`).get();
    expect(original.data()).toMatchObject({ amountMinor: 9295, refundedAmountMinor: 1455 });
    const refundLines = (await adminDb.collection("journalLines").where("journalEntryId", "==", refunded.get("journalEntryId")).get()).docs;
    expect(refundLines.reduce((sum, line) => sum + line.get("debitMinor") - line.get("creditMinor"), 0)).toBe(0);
    expect(refundLines.find(line => line.get("accountCode") === "1043")?.get("creditMinor")).toBe(1455);
    expect(refundLines.find(line => line.get("accountCode") === "2100")?.get("debitMinor")).toBe(102);
    expect((await adminDb.doc(`aftersalesCases/${created.caseId}`).get()).data()).toMatchObject({ amountPaidMinor: 9295, outstandingAmountMinor: 1455, recognizedVatMinor: 648, chargeStatus: "partially_paid" });
    await expect(call("recordAftersalesPayment", { ...refund, amountMinor: 7841, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await expect(call("recordAftersalesPayment", { ...refund, originalPaymentId: results[0]!.paymentId, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await call("recordAftersalesPayment", { caseId: created.caseId, amountMinor: 1455, method: "cash", idempotencyKey: crypto.randomUUID() });
    expect((await adminDb.doc(`aftersalesCases/${created.caseId}`).get()).data()).toMatchObject({ amountPaidMinor: 10750, outstandingAmountMinor: 0, recognizedVatMinor: 750 });
    const competing = await Promise.allSettled([1, 2].map(() => call("recordAftersalesPayment", { ...refund, amountMinor: 4000, idempotencyKey: crypto.randomUUID() })));
    expect(competing.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = competing.find(result => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "functions/failed-precondition" });
    expect((await adminDb.doc(`aftersalesPayments/${receipt.id}`).get()).get("refundedAmountMinor")).toBe(5455);
    expect((await adminDb.collection("inventoryEntries").count().get()).data().count).toBe(before);
    await expect(call("createAftersalesCase", { branchId, customerId, serviceItemId: productId, serviceType: "warranty", requestType: "repair", complaint: "Physical product is not a service", idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
  });
  it("refunds legacy service receipts without inventing VAT and denies invalid journals, scope and permissions", async () => {
    const created = await call<{ caseId: string }>("createAftersalesCase", { branchId, customerId, serviceType: "non_warranty", requestType: "repair", complaint: "Repair legacy non-catalogue service", idempotencyKey: crypto.randomUUID() });
    await call("setAftersalesCharge", { caseId: created.caseId, chargeAmountMinor: 6000, reason: "Legacy quoted service charge", idempotencyKey: crypto.randomUUID() });
    const receipt = await call<{ paymentId: string }>("recordAftersalesPayment", { caseId: created.caseId, amountMinor: 6000, method: "cash", idempotencyKey: crypto.randomUUID() });
    const refund = { action: "refund", operatingContext: { type: "branch", id: branchId }, caseId: created.caseId, originalPaymentId: receipt.paymentId, amountMinor: 2500, method: "bank_transfer", bankAccountId, reason: "Reverse incorrect service receipt", idempotencyKey: crypto.randomUUID() };
    for (const [name, roleId, scope] of [["refund-cashier", "sales_cashier", branchId], ["refund-outside", "branch_manager", "outside"]]) {
      const user = await adminAuth.createUser({ email: `${name}@example.test`, password: "Password!234567" });
      await adminDb.doc(`users/${user.uid}`).set({ uid: user.uid, organizationId, roleId, branchIds: [scope], warehouseIds: [], status: "active", authDisabled: false, authorizationVersion: 1 });
      const denied = client(name!); await signInWithEmailAndPassword(denied.auth, `${name}@example.test`, "Password!234567");
      await expect(httpsCallable(denied.functions, "recordAftersalesPayment")(refund)).rejects.toMatchObject({ code: "functions/permission-denied" });
    }
    const original = await adminDb.doc(`aftersalesPayments/${receipt.paymentId}`).get();
    const journalRef = adminDb.doc(`journalEntries/${original.get("journalEntryId")}`);
    await journalRef.update({ totalCreditMinor: 5999 });
    await expect(call("recordAftersalesPayment", refund)).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await journalRef.update({ totalCreditMinor: 6000 });
    const period = adminDb.doc(`accountingPeriods/${uniquenessDocumentId(organizationId, new Date().toISOString().slice(0, 7))}`);
    await period.set({ organizationId, status: "closed" });
    await expect(call("recordAftersalesPayment", refund)).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await period.delete();
    const result = await call<{ paymentId: string }>("recordAftersalesPayment", refund);
    const saved = await adminDb.doc(`aftersalesPayments/${result.paymentId}`).get();
    expect(saved.get("entryType")).toBe("refund"); expect(saved.get("vatAmountMinor")).toBeUndefined();
    expect((await adminDb.doc(`aftersalesCases/${created.caseId}`).get()).data()).toMatchObject({ amountPaidMinor: 3500, outstandingAmountMinor: 2500, chargeStatus: "partially_paid" });
    const lines = (await adminDb.collection("journalLines").where("journalEntryId", "==", saved.get("journalEntryId")).get()).docs;
    expect(lines.find(line => line.get("accountCode") === "4100")?.get("debitMinor")).toBe(2500);
    expect(lines.some(line => line.get("accountCode") === "2100")).toBe(false);
    await expect(call("getAftersalesWorkspace", { action: "list_payments", caseId: created.caseId, paymentCursor: "foreign-payment" })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    await expect(call("recordAftersalesPayment", { ...refund, caseId: "foreign-case", idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/not-found" });
    await expect(call("recordAftersalesPayment", { ...refund, amountMinor: 3501, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
  });
  it("pages service receipt history without leaking another case or accepting a foreign cursor", async () => {
    const created = await call<{ caseId: string }>("createAftersalesCase", { branchId, customerId, serviceType: "warranty", requestType: "inspection", complaint: "Receipt-history pagination fixture", idempotencyKey: crypto.randomUUID() });
    const batch = adminDb.batch();
    for (let i = 0; i < 26; i++) batch.create(adminDb.collection("aftersalesPayments").doc(), { organizationId, branchId, caseId: created.caseId, amountMinor: 100, recordedAt: Timestamp.fromMillis(1000 + i) });
    batch.create(adminDb.doc("aftersalesPayments/other-case-cursor"), { organizationId, branchId, caseId: "another-case", recordedAt: Timestamp.fromMillis(2000) });
    await batch.commit();
    const input = { action: "list_payments", caseId: created.caseId, paymentLimit: 25 };
    const first = await call<{ payments: Array<{ id: string; caseId: string }>; nextCursor: string }>("getAftersalesWorkspace", input);
    expect(first.payments).toHaveLength(25); expect(first.payments.every(row => row.caseId === created.caseId)).toBe(true);
    const next = await call<{ payments: Array<{ id: string }>; nextCursor: null }>("getAftersalesWorkspace", { ...input, paymentCursor: first.nextCursor });
    expect(next.payments).toHaveLength(1); expect(next.nextCursor).toBeNull();
    expect(first.payments.some(row => row.id === next.payments[0]!.id)).toBe(false);
    await expect(call("getAftersalesWorkspace", { ...input, paymentCursor: "other-case-cursor" })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    await expect(call("getAftersalesWorkspace", { action: "list_payments" })).rejects.toMatchObject({ code: "functions/invalid-argument" });
  });
});
