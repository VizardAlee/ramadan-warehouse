import { initializeApp, deleteApp, type FirebaseApp } from "firebase/app";
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
import { getFirestore as clientDb, connectFirestoreEmulator, doc, getDoc } from "firebase/firestore";
import { getApps, initializeApp as adminApp } from "firebase-admin/app";
import { getAuth as adminAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uniquenessDocumentId } from "../functions/src/inventory/calculations";
import type { PosFastMoving } from "@/features/pos/fast-moving";
const projectId = process.env.TEST_FIREBASE_PROJECT_ID ?? "demo-ramadan-warehouse";
if (!projectId.startsWith("demo-") || !/^127\.0\.0\.1:/.test(process.env.FIRESTORE_EMULATOR_HOST ?? "") || !/^127\.0\.0\.1:/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "")) throw Error("Fast-moving tests require owned local demo emulators.");
const admin = getApps().find(a => a.name === "fast-moving-tests") ?? adminApp({ projectId }, "fast-moving-tests");
const db = getFirestore(admin), auth = adminAuth(admin), org = "fast-moving-org", branch = "fast-moving-store", other = "fast-moving-other", apps: FirebaseApp[] = [];
function client(name: string) {
  const app = initializeApp({ projectId, apiKey: "demo", appId: "demo-fast-moving" }, `fast-moving-${name}`); apps.push(app);
  const a = getAuth(app); connectAuthEmulator(a, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  const f = getFunctions(app, "us-central1"); connectFunctionsEmulator(f, "127.0.0.1", Number(process.env.TEST_FUNCTIONS_PORT ?? 5001));
  const d = clientDb(app), [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(":"); connectFirestoreEmulator(d, host!, Number(port)); return { a, f, d };
}
async function actor(name: string, permissions = ["sales.read.own_branch"]) {
  const email = `${name}@fast-moving.example.invalid`, password = "Synthetic-only-234567!", record = await auth.createUser({ email, password });
  await db.doc(`users/${record.uid}`).set({ organizationId: org, displayName: name, roleId: "sales_cashier", roleIds: ["sales_cashier"], branchIds: [branch], warehouseIds: [], status: "active", authDisabled: false, authorizationVersion: 1, effectivePermissions: permissions });
  const c = client(name); await signInWithEmailAndPassword(c.a, email, password); return c;
}
const summary = db.doc(`posFastMovingSummaries/${uniquenessDocumentId(org, "posFastMoving", branch)}`);
const suggest = async (c: ReturnType<typeof client>, store = branch) => (await httpsCallable<object, PosFastMoving>(c.f, "getPosWorkspace")({ branchId: store, fastMoving: true })).data;
let cashier: Awaited<ReturnType<typeof actor>>, denied: Awaited<ReturnType<typeof actor>>;
beforeAll(async () => {
  await db.doc(`organizations/${org}`).set({ status: "active" });
  for (const id of [branch, other]) {
    await db.doc(`branches/${id}`).set({ organizationId: org, status: "active", name: id, branchType: "store" });
    await db.doc(`inventoryLocations/${id}-stock`).set({ organizationId: org, branchId: id, type: "branch", status: "active", name: "Stock" });
  }
  cashier = await actor("cashier"); denied = await actor("denied", []);
  const batch = db.batch();
  for (const id of ["popular", "ordinary"]) batch.set(db.doc(`products/fast-moving-${id}`), { organizationId: org, unitOfMeasure: "unit", trackingType: "quantity", active: true, name: id });
  for (let n = 0; n < 20; n++) {
    batch.set(db.doc(`sales/fast-moving-sale${n}`), { organizationId: org, branchId: branch, status: "completed", itemCount: 1, recordedAt: Timestamp.fromMillis(Date.now() - (n % 5 + 1) * 86400000) });
    batch.set(db.doc(`saleItems/fast-moving-line${n}`), { organizationId: org, branchId: branch, saleId: `fast-moving-sale${n}`, productId: `fast-moving-${n < 12 ? "popular" : "ordinary"}`, quantity: 2, unitOfMeasure: "unit", itemKind: "goods" });
  }
  await batch.commit();
}, 120000);
afterAll(async () => { await Promise.all(apps.map(deleteApp)); });
describe("real SDK branch POS fast-moving projection", () => {
  it("allows scoped cashier suggestions without sales or margin payloads", async () => {
    const result = await suggest(cashier);
    expect(result).toMatchObject({ status: "ready", productIds: ["fast-moving-popular"], branchId: branch });
    expect(Object.keys(result).sort()).toEqual(["version", "branchId", "status", "productIds", "asOf", "expiresAt"].sort());
    await expect(getDoc(doc(cashier.d, "posFastMovingSummaries", summary.id))).rejects.toMatchObject({ code: "permission-denied" });
  });
  it("preserves anonymous, role and branch restrictions", async () => {
    await expect(suggest(client("anonymous"))).rejects.toMatchObject({ code: "functions/unauthenticated" });
    await expect(suggest(denied)).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(suggest(cashier, other)).rejects.toMatchObject({ code: "functions/permission-denied" });
  });
  it("ignores unapproved return requests and staged orders on a fresh calculation", async () => {
    await db.doc("saleReturns/fast-moving-pending-return").set({ organizationId: org, branchId: branch, saleId: "fast-moving-sale0", status: "submitted" });
    await db.doc("saleReturnItems/fast-moving-pending-item").set({ organizationId: org, branchId: branch, returnId: "fast-moving-pending-return", saleItemId: "fast-moving-line0", quantity: 2 });
    await db.doc("salesOrders/fast-moving-draft").set({ organizationId: org, branchId: branch, status: "payment_accepted", lines: [{ productId: "fast-moving-ordinary", quantity: 10000 }] });
    await summary.update({ "result.expiresAt": new Date(0).toISOString() });
    expect((await suggest(cashier)).productIds).toEqual(["fast-moving-popular"]);
  });
  it("shares a valid cache and refreshes approved return/cancellation corrections after expiry", async () => {
    const first = await suggest(cashier); const second = await suggest(cashier); expect(second).toEqual(first);
    const batch = db.batch();
    for (let n = 0; n < 8; n++) batch.set(db.doc(`saleReturnItemCounters/${uniquenessDocumentId(org, "saleReturnItem", `fast-moving-line${n}`)}`), { organizationId: org, saleId: `fast-moving-sale${n}`, saleItemId: `fast-moving-line${n}`, returnedQuantity: 2 });
    await batch.commit();
    expect(await suggest(cashier)).toEqual(first);
    await summary.update({ "result.expiresAt": new Date(0).toISOString() });
    expect((await suggest(cashier)).productIds).toEqual(["fast-moving-ordinary"]);
  });
  it("does not start a competing refresh during an existing branch lease", async () => {
    await summary.set({ organizationId: org, branchId: branch, version: 1, token: "synthetic-lease", leaseUntil: Date.now() + 90000 });
    expect(await suggest(cashier)).toMatchObject({ status: "refreshing", productIds: [] });
  });
  it("rejects missing item evidence rather than ranking a partial window", async () => {
    await summary.update({ leaseUntil: 0 });
    await db.doc("sales/fast-moving-sale19").update({ itemCount: 2 });
    expect(await suggest(cashier)).toMatchObject({ status: "unavailable", productIds: [] });
  });
  it("returns no partial ranking when the branch window exceeds the receipt cap", async () => {
    let batch = db.batch(), pending = 0;
    for (let n = 20; n < 1001; n++) {
      batch.set(db.doc(`sales/fast-moving-sale${n}`), { organizationId: org, branchId: branch, status: "completed", itemCount: 1, recordedAt: Timestamp.fromMillis(Date.now() - 86400000) });
      if (++pending === 400) { await batch.commit(); batch = db.batch(); pending = 0; }
    }
    if (pending) await batch.commit();
    await summary.update({ "result.expiresAt": new Date(0).toISOString(), leaseUntil: 0 });
    expect(await suggest(cashier)).toMatchObject({ status: "unavailable", productIds: [] });
  });

});
