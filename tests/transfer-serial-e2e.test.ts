import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { getApps as getAdminApps, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uniquenessDocumentId } from "../functions/src/inventory/calculations";

const projectId = "demo-ramadan-warehouse";
const organizationId = "serial-transfer-org";
const adminApp = getAdminApps().find((app) => app.name === "serial-transfer-e2e") ?? initializeAdminApp({ projectId }, "serial-transfer-e2e");
const adminAuth = getAdminAuth(adminApp);
const adminDb = getFirestore(adminApp);
const apps: FirebaseApp[] = [];
function client(name: string) {
  const app = initializeApp({ projectId, apiKey: "demo", appId: `serial-${name}` }, `serial-${name}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const functions = getFunctions(app, "us-central1");
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  return { auth, functions };
}
async function call<T>(target: ReturnType<typeof client>, name: string, data: Record<string, unknown>) {
  return (await httpsCallable(target.functions, name)(data)).data as T;
}
async function actor(name: string, roleId: string, branchIds: string[] = [], warehouseIds: string[] = []) {
  const email = `serial-${name}@example.test`;
  const user = await adminAuth.createUser({ email, password: "Password!234567" });
  await adminDb.doc(`users/${user.uid}`).set({ uid: user.uid, organizationId, email, displayName: name, roleId, branchIds, warehouseIds, status: "active", authDisabled: false, authorizationVersion: 1 });
  const result = client(name);
  await signInWithEmailAndPassword(result.auth, email, "Password!234567");
  return { ...result, uid: user.uid };
}

let creator: Awaited<ReturnType<typeof actor>>;
let manager: Awaited<ReturnType<typeof actor>>;
let picker: Awaited<ReturnType<typeof actor>>;
let logistics: Awaited<ReturnType<typeof actor>>;
let receiver: Awaited<ReturnType<typeof actor>>;
const serialNumbers = ["INV-6200-001", "INV-6200-002", "INV-6200-003"];
const serialIds = serialNumbers.map((serial) => uniquenessDocumentId(organizationId, serial));

beforeAll(async () => {
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${projectId}/accounts`, { method: "DELETE" });
  await fetch(`http://127.0.0.1:8180/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" });
  await Promise.all([
    adminDb.doc(`organizations/${organizationId}`).set({ name: "Serial Test", openingStockEnabled: true, createdAt: FieldValue.serverTimestamp() }),
    adminDb.doc("warehouses/serial-wh").set({ organizationId, name: "Central", code: "CEN", status: "active" }),
    adminDb.doc("branches/serial-branch").set({ organizationId, name: "Kaduna", code: "KAD", status: "active" }),
    adminDb.doc("inventoryLocations/serial-origin").set({ organizationId, warehouseId: "serial-wh", name: "Available", code: "AVL", type: "warehouse", status: "active", systemManaged: false }),
    adminDb.doc("inventoryLocations/serial-branch-location").set({ organizationId, branchId: "serial-branch", name: "Branch available", code: "BRA", type: "branch", status: "active", systemManaged: false }),
    adminDb.doc("products/serial-product").set({ organizationId, name: "6.2kVA Hybrid Inverter", sku: "INV-6.2K", unitOfMeasure: "unit", trackingType: "serial", active: true, hasLedgerActivity: false }),
    adminDb.doc("productCosts/serial-product").set({ organizationId, productId: "serial-product", defaultUnitCostMinor: 850_000_00, currency: "NGN" }),
  ]);
  creator = await actor("creator", "system_administrator");
  manager = await actor("manager", "warehouse_manager", [], ["serial-wh"]);
  picker = await actor("picker", "warehouse_officer", [], ["serial-wh"]);
  logistics = await actor("logistics", "logistics_officer", [], ["serial-wh"]);
  receiver = await actor("receiver", "branch_manager", ["serial-branch"]);
  await call(creator, "postOpeningStock", { productId: "serial-product", destinationLocationId: "serial-origin", quantity: 3, unitCostMinor: 850_000_00, serialNumbers, effectiveAt: new Date().toISOString(), reason: "Controlled serial opening import", externalAccount: "migration", idempotencyKey: crypto.randomUUID() });
}, 60_000);
afterAll(async () => Promise.all(apps.map((app) => deleteApp(app))));

describe.sequential("serialized transfer callable E2E", () => {
  it("moves exact unique serials through reservation, pick, pack, transit, receipt and closure idempotently", async () => {
    const created = await call<{ transferId: string }>(creator, "createAdminTransfer", { originWarehouseId: "serial-wh", originLocationId: "serial-origin", destinationBranchId: "serial-branch", destinationLocationId: "serial-branch-location", purpose: "Serialized inverter replenishment", priority: "high", items: [{ productId: "serial-product", quantity: 3 }], directTransferReason: "Branch installation demand", idempotencyKey: crypto.randomUUID() });
    const transferId = created.transferId;
    const transferItemId = `${transferId}__serial-product`;
    await call(creator, "submitTransfer", { transferId, expectedVersion: 0, idempotencyKey: crypto.randomUUID() });
    await call(manager, "approveTransfer", { transferId, expectedVersion: 1, idempotencyKey: crypto.randomUUID() });
    const foreignSerialId = uniquenessDocumentId("another-org", "FOREIGN-001");
    const otherProductSerialId = uniquenessDocumentId(organizationId, "OTHER-PRODUCT-001");
    await Promise.all([
      adminDb.doc(`serializedItems/${foreignSerialId}`).set({ organizationId: "another-org", productId: "serial-product", serialNumber: "FOREIGN-001", currentLocationId: "serial-origin", status: "available", active: true }),
      adminDb.doc(`serializedItems/${otherProductSerialId}`).set({ organizationId, productId: "other-product", serialNumber: "OTHER-PRODUCT-001", currentLocationId: "serial-origin", status: "available", active: true }),
    ]);
    for (const invalidSerialId of [foreignSerialId, otherProductSerialId]) {
      await expect(call(manager, "reserveTransferStock", { transferId, expectedVersion: 1, lines: [{ transferItemId, productId: "serial-product", quantity: 3, serialItemIds: [serialIds[0], serialIds[1], invalidSerialId], lotAllocations: [] }], idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    }
    await call(manager, "reserveTransferStock", { transferId, expectedVersion: 1, lines: [{ transferItemId, productId: "serial-product", quantity: 3, serialItemIds: serialIds, lotAllocations: [] }], idempotencyKey: crypto.randomUUID() });

    const competing = await call<{ transferId: string }>(creator, "createAdminTransfer", { originWarehouseId: "serial-wh", originLocationId: "serial-origin", destinationBranchId: "serial-branch", destinationLocationId: "serial-branch-location", purpose: "Competing serialized allocation", priority: "normal", items: [{ productId: "serial-product", quantity: 1 }], directTransferReason: "Conflict validation transfer", idempotencyKey: crypto.randomUUID() });
    await call(creator, "submitTransfer", { transferId: competing.transferId, expectedVersion: 0, idempotencyKey: crypto.randomUUID() });
    await call(manager, "approveTransfer", { transferId: competing.transferId, expectedVersion: 1, idempotencyKey: crypto.randomUUID() });
    await expect(call(manager, "reserveTransferStock", { transferId: competing.transferId, expectedVersion: 1, lines: [{ transferItemId: `${competing.transferId}__serial-product`, productId: "serial-product", quantity: 1, serialItemIds: [serialIds[0]], lotAllocations: [] }], idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });

    await call(picker, "startTransferPicking", { transferId, expectedVersion: 1, idempotencyKey: crypto.randomUUID() });
    await expect(call(picker, "recordPickedItems", { transferId, expectedVersion: 1, lines: [{ transferItemId, quantity: 3, serialItemIds: [serialIds[0], serialIds[1], otherProductSerialId], lotAllocations: [] }], idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    const picked = await call<{ pickId: string }>(picker, "recordPickedItems", { transferId, expectedVersion: 1, lines: [{ transferItemId, quantity: 3, serialItemIds: serialIds, lotAllocations: [] }], idempotencyKey: crypto.randomUUID() });
    await call(manager, "verifyPickedItems", { transferId, expectedVersion: 1, pickId: picked.pickId, accepted: true, idempotencyKey: crypto.randomUUID() });
    const pkg = await call<{ packageId: string }>(picker, "createTransferPackage", { transferId, expectedVersion: 1, lines: [{ transferItemId, quantity: 3, serialItemIds: serialIds, lotAllocations: [] }], idempotencyKey: crypto.randomUUID() });
    await expect(call(picker, "createTransferPackage", { transferId, expectedVersion: 1, lines: [{ transferItemId, quantity: 1, serialItemIds: [serialIds[0]], lotAllocations: [] }], idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    await call(picker, "sealTransferPackage", { transferId, expectedVersion: 1, packageId: pkg.packageId, idempotencyKey: crypto.randomUUID() });
    await call(manager, "verifyPacking", { transferId, expectedVersion: 1, packageId: pkg.packageId, idempotencyKey: crypto.randomUUID() });
    const dispatchBase = { transferId, expectedVersion: 1, packageIds: [pkg.packageId], driverName: "Musa Bello", verifiedBy: manager.uid };
    const dispatch = await call<{ dispatchId: string }>(logistics, "createTransferDispatch", { ...dispatchBase, idempotencyKey: crypto.randomUUID() });
    const dispatchKey = crypto.randomUUID();
    await call(logistics, "confirmTransferDispatch", { ...dispatchBase, dispatchId: dispatch.dispatchId, idempotencyKey: dispatchKey });
    await call(logistics, "confirmTransferDispatch", { ...dispatchBase, dispatchId: dispatch.dispatchId, idempotencyKey: dispatchKey });
    for (const id of serialIds) expect((await adminDb.doc(`serializedItems/${id}`).get()).get("status")).toBe("in_transit");

    const receiptBase = { transferId, expectedVersion: 1, dispatchId: dispatch.dispatchId, deliveryCondition: "partially_damaged", lines: [{ transferItemId, receivedQuantity: 2, damagedQuantity: 1, missingQuantity: 0, rejectedQuantity: 0, serialItemIds: serialIds.slice(0, 2), damagedSerialItemIds: [serialIds[2]], lotAllocations: [] }] };
    const receipt = await call<{ receiptId: string }>(receiver, "createTransferReceipt", { ...receiptBase, idempotencyKey: crypto.randomUUID() });
    const receiptKey = crypto.randomUUID();
    await call(receiver, "confirmTransferReceipt", { ...receiptBase, receiptId: receipt.receiptId, idempotencyKey: receiptKey });
    await call(receiver, "confirmTransferReceipt", { ...receiptBase, receiptId: receipt.receiptId, idempotencyKey: receiptKey });
    for (const id of serialIds.slice(0, 2)) {
      const serial = await adminDb.doc(`serializedItems/${id}`).get();
      expect(serial.data()).toMatchObject({ currentLocationId: "serial-branch-location", status: "at_branch", active: true });
      expect((await adminDb.collection("inventoryEntries").where("serializedItemId", "==", id).get()).size).toBe(6);
    }
    const transfer = await adminDb.doc(`transfers/${transferId}`).get();
    expect((await adminDb.doc(`serializedItems/${serialIds[2]}`).get()).data()).toMatchObject({ currentLocationId: transfer.get("damagedLocationId"), status: "damaged", active: true });
    const discrepancy = (await adminDb.collection("transferDiscrepancies").where("transferId", "==", transferId).where("status", "==", "open").get()).docs[0]!;
    await call(creator, "resolveTransferDiscrepancy", { transferId, expectedVersion: 1, discrepancyId: discrepancy.id, resolutionType: "written_off", note: "Damaged inverter condemned after inspection", idempotencyKey: crypto.randomUUID() });
    expect((await adminDb.doc(`serializedItems/${serialIds[2]}`).get()).data()).toMatchObject({ status: "written_off", active: false });
    await call(manager, "closeTransfer", { transferId, expectedVersion: 1, idempotencyKey: crypto.randomUUID() });
    expect((await adminDb.doc(`transfers/${transferId}`).get()).get("status")).toBe("closed");
    expect((await adminDb.collection("inventoryTransactions").where("transferId", "==", transferId).get()).size).toBe(4);
  }, 90_000);
});
