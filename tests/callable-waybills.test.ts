import { initializeApp, deleteApp, type FirebaseApp } from "firebase/app";
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
import { getApps, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SaleDocument } from "@/features/pos/types";
import type { WaybillRow } from "@/features/waybills/waybill-register";

const projectId = "demo-ramadan-warehouse";
if (!/^127\.0\.0\.1:/.test(process.env.FIRESTORE_EMULATOR_HOST ?? "") || !/^127\.0\.0\.1:/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? ""))
  throw new Error("Waybill integration tests require owned local demo emulators.");
const admin = getApps().find(app => app.name === "waybill-sdk") ?? initializeAdminApp({ projectId }, "waybill-sdk");
const db = getFirestore(admin), adminAuth = getAdminAuth(admin), apps: FirebaseApp[] = [];
const org = "waybill-sdk-org", branchId = "waybill-sdk-branch", saleId = "waybill-sdk-sale", invoiceNumber = "SAL-WB-FIXTURE-1";
const recordIds = Array.from({ length: 30 }, (_, index) => `waybill-sdk-${String(index).padStart(2, "0")}`);
function client(name: string) {
  const app = initializeApp({ projectId, apiKey: "demo", appId: "waybill-sdk" }, `waybill-sdk-${name}`); apps.push(app);
  const auth = getAuth(app); connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  const functions = getFunctions(app, "us-central1"); connectFunctionsEmulator(functions, "127.0.0.1", Number(process.env.TEST_FUNCTIONS_PORT ?? 5001));
  return { auth, functions };
}
async function actor(name: string, roleId: string, branches: string[], permissions?: string[]) {
  const email = `${name}@waybill.example.invalid`, password = "Synthetic-fixture-only-123!";
  const user = await adminAuth.createUser({ email, password });
  await db.doc(`users/${user.uid}`).set({ organizationId: org, displayName: "Fixture staff", roleId, roleIds: [roleId], branchIds: branches, warehouseIds: [], status: "active", authDisabled: false, authorizationVersion: 1, ...(permissions ? { effectivePermissions: permissions } : {}) });
  const target = client(name); await signInWithEmailAndPassword(target.auth, email, password); return target;
}
async function call<T>(target: ReturnType<typeof client>, name: string, data: object) {
  return (await httpsCallable<object, T>(target.functions, name)(data)).data;
}
let manager: Awaited<ReturnType<typeof actor>>, reader: Awaited<ReturnType<typeof actor>>, outsider: Awaited<ReturnType<typeof actor>>;
type Page = { rows: WaybillRow[]; nextCursor: string | null };
const list = { action: "list_waybills", branchId, invoiceNumber, limit: 25 };
beforeAll(async () => {
  await db.doc(`organizations/${org}`).set({ status: "active", legalName: "Synthetic Waybill Fixtures", phoneNumbers: [] });
  await db.doc(`branches/${branchId}`).set({ organizationId: org, name: "Fixture store", status: "active" });
  manager = await actor("manager", "branch_manager", [branchId]);
  reader = await actor("reader", "sales_cashier", [branchId], ["sales.read.own_branch"]);
  outsider = await actor("outsider", "branch_manager", ["waybill-other-store"]);
  const batch = db.batch();
  batch.set(db.doc(`sales/${saleId}`), { organizationId: org, branchId, branchName: "Fixture store", branchCode: "WB", saleNumber: invoiceNumber, status: "completed", customerName: "Synthetic walk-in", recordedAt: Timestamp.now(), postedAt: Timestamp.now(), grossAmountMinor: 100, amountPaidMinor: 100, creditAmountMinor: 0 });
  batch.set(db.doc("salesReceipts/waybill-sdk-receipt"), { organizationId: org, branchId, saleId, receiptNumber: "RCT-WB-FIXTURE-1" });
  batch.set(db.doc("saleItems/waybill-sdk-item"), { organizationId: org, branchId, saleId, productName: "Synthetic goods", sku: "WB-FIXTURE", unitOfMeasure: "unit", quantity: 30 });
  batch.set(db.doc("salePayments/waybill-sdk-payment"), { organizationId: org, branchId, saleId, status: "confirmed", method: "cash", amountMinor: 100 });
  batch.set(db.doc("inventoryBalances/waybill-sdk-balance"), { organizationId: org, branchId, onHandQuantity: 100, reservedQuantity: 0, totalValueMinor: 1000 });
  batch.set(db.doc("journalEntries/waybill-sdk-journal"), { organizationId: org, branchId, referenceId: saleId, totalDebitMinor: 100, totalCreditMinor: 100 });
  for (const id of recordIds) batch.set(db.doc(`saleCollections/${id}`), { organizationId: org, branchId, saleId, referenceNumber: invoiceNumber, collectedAt: Timestamp.fromMillis(1000000), collector: "Synthetic collector", releasedBy: manager.auth.currentUser!.uid, totalQuantity: 1, lines: [{ saleItemId: "waybill-sdk-item", productName: "Synthetic goods", quantity: 1 }] });
  await batch.commit();
}, 120000);
afterAll(async () => { await Promise.all(apps.map(deleteApp)); });
describe.sequential("waybill register through real callable SDK and synthetic local records", () => {
  it("pages tied handovers without loss and opens an older selected handover directly", async () => {
    const first = await call<Page>(manager, "getSaleDocument", list);
    const second = await call<Page>(manager, "getSaleDocument", { ...list, cursor: first.nextCursor });
    expect(first.rows).toHaveLength(25); expect(second.rows).toHaveLength(5); expect(second.nextCursor).toBeNull();
    expect(new Set([...first.rows, ...second.rows].map(row => row.id))).toEqual(new Set(recordIds));
    const selected = await call<SaleDocument>(manager, "getSaleDocument", { saleId, collectionId: second.rows[0]!.id });
    expect(selected.collections?.map(row => row.id)).toEqual([second.rows[0]!.id]);
    expect(first.rows.every(row => row.branchId === branchId && row.invoiceNumber === invoiceNumber)).toBe(true);
    expect(first.rows[0]).not.toHaveProperty("costAmountMinor");
  });
  it("retains anonymous, local-scope and wrong-invoice protections", async () => {
    await expect(call(client("anonymous"), "getSaleDocument", list)).rejects.toMatchObject({ code: "functions/unauthenticated" });
    await expect(call(outsider, "getSaleDocument", list)).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(call(manager, "getSaleDocument", { saleId: "another-sale", collectionId: recordIds[0] })).rejects.toMatchObject({ code: "functions/not-found" });
    expect(await call<Page>(manager, "getSaleDocument", { ...list, invoiceNumber: "NO-SUCH-INVOICE" })).toEqual({ rows: [], nextCursor: null });
    await expect(call(manager, "getSaleDocument", { ...list, invoiceNumber: "NO-SUCH-INVOICE", cursor: recordIds[0] })).rejects.toMatchObject({ code: "functions/invalid-argument" });
  });
  it("includes recorded historical handovers with no timestamp and can continue from their cursor", async () => {
    const id = "waybill-sdk-legacy";
    await db.doc(`saleCollections/${id}`).set({ organizationId: org, branchId, saleId, referenceNumber: invoiceNumber, collector: "Synthetic historical collector", releasedBy: manager.auth.currentUser!.uid, totalQuantity: 1, lines: [{ saleItemId: "waybill-sdk-item", productName: "Synthetic goods", quantity: 1 }] });
    const result = await call<Page>(manager, "getSaleDocument", { ...list, limit: 100 });
    expect(result.rows.find(row => row.id === id)?.collectedAt).toBeNull();
    const selected = await call<SaleDocument>(manager, "getSaleDocument", { saleId, collectionId: id });
    expect(selected.collections?.[0]?.collectedAt).toBeNull();
    expect(await call<Page>(manager, "getSaleDocument", { ...list, cursor: id })).toEqual({ rows: [], nextCursor: null });
  });
  it("saves only dispatch metadata, replays the original confirmation and rejects stale/concurrent edits", async () => {
    const paths = ["sales/" + saleId, "inventoryBalances/waybill-sdk-balance", "salePayments/waybill-sdk-payment", "journalEntries/waybill-sdk-journal"];
    const before = await db.getAll(...paths.map(path => db.doc(path)));
    const input = { action: "update_dispatch_details", saleId, collectionId: recordIds[0], expectedVersion: 0, dispatcherPhone: "+234 800 synthetic", vehiclePlate: "TEST-WB-123", deliveryRecipientName: "Synthetic recipient", idempotencyKey: crypto.randomUUID() };
    const saved = await call(manager, "confirmPosSaleOrder", input);
    expect(saved).toMatchObject({ collectionId: recordIds[0], dispatcherPhone: input.dispatcherPhone, vehiclePlate: input.vehiclePlate, deliveryRecipientName: input.deliveryRecipientName, dispatchDetailsVersion: 1 });
    expect(await call(manager, "confirmPosSaleOrder", input)).toEqual(saved);
    await expect(call(manager, "confirmPosSaleOrder", { ...input, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await expect(call(reader, "confirmPosSaleOrder", { ...input, expectedVersion: 1, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/permission-denied" });
    const page = await call<Page>(manager, "getSaleDocument", { ...list, limit: 100 });
    expect(page.rows.find(row => row.id === recordIds[0])).toMatchObject({ dispatcherPhone: input.dispatcherPhone, vehiclePlate: input.vehiclePlate, deliveryRecipientName: input.deliveryRecipientName });
    const after = await db.getAll(...paths.map(path => db.doc(path)));
    expect(after.map(snapshot => snapshot.data())).toEqual(before.map(snapshot => snapshot.data()));
  });
});
