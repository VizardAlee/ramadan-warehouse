import { createHash } from "node:crypto";
import { initializeApp, deleteApp, type FirebaseApp } from "firebase/app";
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
import { getFirestore as clientDb, connectFirestoreEmulator, doc, getDoc } from "firebase/firestore";
import { getApps, initializeApp as adminApp } from "firebase-admin/app";
import { getAuth as adminAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PosCustomer } from "@/features/pos/types";
import type { PosCustomerSearchPage } from "@/features/pos/customer-selector";
const projectId = process.env.TEST_FIREBASE_PROJECT_ID ?? "demo-ramadan-warehouse";
if (!projectId.startsWith("demo-") || !/^127\.0\.0\.1:/.test(process.env.FIRESTORE_EMULATOR_HOST ?? "") || !/^127\.0\.0\.1:/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "")) throw Error("POS customer search tests require owned local demo emulators.");
const admin = getApps().find(app => app.name === "pos-customer-search-tests") ?? adminApp({ projectId }, "pos-customer-search-tests");
const db = getFirestore(admin), auth = adminAuth(admin), org = "pos-customer-search-org", other = "pos-customer-search-foreign";
const branch = "pos-customer-search-store", foreignBranch = "pos-customer-search-foreign-store", apps: FirebaseApp[] = [];
function client(name: string) {
  const app = initializeApp({ projectId, apiKey: "demo", appId: "demo-customer-search" }, `pos-search-${name}`); apps.push(app);
  const a = getAuth(app); connectAuthEmulator(a, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  const f = getFunctions(app, "us-central1"); connectFunctionsEmulator(f, "127.0.0.1", Number(process.env.TEST_FUNCTIONS_PORT ?? 5001));
  const d = clientDb(app), [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(":"); connectFirestoreEmulator(d, host!, Number(port));
  return { a, f, d };
}
type Client = ReturnType<typeof client>;
async function actor(name: string, extra: Record<string, unknown> = {}) {
  const email = `${name}@pos-search.example.invalid`, password = "Synthetic-only-234567!", record = await auth.createUser({ email, password });
  await db.doc(`users/${record.uid}`).set({ organizationId: org, displayName: name, roleId: "sales_cashier", roleIds: ["sales_cashier"], branchIds: [branch], warehouseIds: [], status: "active", authDisabled: false, authorizationVersion: 1, effectivePermissions: ["sales.read.own_branch"], ...extra });
  const c = client(name); await signInWithEmailAndPassword(c.a, email, password); return { ...c, uid: record.uid };
}
const search = async (c: Client, data: Record<string, unknown> = { query: "aliyu" }, store = branch) => (await httpsCallable<object, PosCustomerSearchPage>(c.f, "getPosWorkspace")({ branchId: store, customerSearch: data })).data;
const id = (n: number) => `pos-search-customer-${String(n).padStart(4, "0")}`;
let cashier: Awaited<ReturnType<typeof actor>>, second: Awaited<ReturnType<typeof actor>>, denied: Awaited<ReturnType<typeof actor>>, foreign: Awaited<ReturnType<typeof actor>>, beforeHash: string;
async function customerHash() {
  const rows = await db.collection("customers").where("organizationId", "==", org).get();
  return createHash("sha256").update(JSON.stringify(rows.docs.map(row => [row.id, row.data()]).sort())).digest("hex");
}
beforeAll(async () => {
  for (const organizationId of [org, other]) await db.doc(`organizations/${organizationId}`).set({ status: "active" });
  for (const [branchId, organizationId] of [[branch, org], [foreignBranch, other]] as const) {
    await db.doc(`branches/${branchId}`).set({ organizationId, status: "active", name: branchId, code: branchId, branchType: "store" });
    await db.doc(`inventoryLocations/${branchId}-stock`).set({ organizationId, branchId, type: "branch", status: "active", name: "Sales stock" });
  }
  cashier = await actor("cashier"); second = await actor("second"); denied = await actor("denied", { effectivePermissions: [] });
  foreign = await actor("foreign", { organizationId: other, branchIds: [foreignBranch] });
  let batch = db.batch(), count = 0;
  for (let n = 0; n < 1106; n++) {
    batch.set(db.doc(`customers/${id(n)}`), { organizationId: org, active: n !== 20, name: n === 750 || n === 1005 ? "Alhaji Aliyu Ventures" : n === 1105 ? "Beyond limit buyer" : n === 40 || n === 1040 ? "Duplicate Buyer" : n === 20 ? "Inactive target" : "Other customer", customerNumber: `CUS-${n}`, creditStatus: "pending", outstandingBalanceMinor: 0, email: "private@example.invalid", password: "never-return-this" });
    if (++count === 400) { await batch.commit(); batch = db.batch(); count = 0; }
  }
  if (count) await batch.commit();
  await db.doc("customers/pos-search-foreign-customer").set({ organizationId: other, active: true, name: "Foreign target", customerNumber: "FOREIGN", outstandingBalanceMinor: 0 });
  beforeHash = await customerHash();
}, 120000);
afterAll(async () => { await Promise.all(apps.map(deleteApp)); });
describe("real SDK POS customer-name search", () => {
  it("finds a middle-name fragment past500 and continues deterministically beyond1000", async () => {
    const first = await search(cashier, { query: "  ALiYu  " });
    expect(first.customers.map(row => row.id)).toEqual([id(750)]);
    expect(first).toMatchObject({ scanned: 1000, scanLimited: true, complete: false });
    const next = await search(cashier, { query: "aliyu", cursor: first.nextCursor });
    expect(next.customers.map(row => row.id)).toEqual([id(1005)]); expect(next.complete).toBe(true);
    expect(Object.keys(first.customers[0]!).sort()).toEqual(["id", "customerNumber", "name", "pricingTier", "arrangements", "advanceBalances", "phone", "creditStatus", "creditLimitMinor", "outstandingBalanceMinor", "availableCreditMinor"].sort());
  });
  it("returns continuation after an empty scan and distinguishes duplicate customer IDs", async () => {
    const empty = await search(cashier, { query: "LIMIT" }); expect(empty.customers).toEqual([]); expect(empty.nextCursor).toBeTruthy(); expect(empty.complete).toBe(false);
    const later = await search(cashier, { query: "limit", cursor: empty.nextCursor }); expect(later.customers[0]?.id).toBe(id(1105));
    const first = await search(cashier, { query: "duplicate" }); const next = await search(cashier, { query: "duplicate", cursor: first.nextCursor });
    expect([...first.customers, ...next.customers].map(row => [row.id, row.customerNumber])).toEqual([[id(40), "CUS-40"], [id(1040), "CUS-1040"]]);
  });
  it("allows POS-authorized cashiers without granting direct customer-register access", async () => {
    expect((await search(cashier, { query: "aliyu" })).customers).toHaveLength(1);
    await expect(getDoc(doc(cashier.d, "customers", id(750)))).rejects.toMatchObject({ code: "permission-denied" });
    await expect(search(denied)).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(search(client("anonymous"))).rejects.toMatchObject({ code: "functions/unauthenticated" });
  });
  it("keeps tenant, branch, active-status and disabled-account boundaries", async () => {
    expect((await search(foreign, { query: "aliyu" }, foreignBranch)).customers).toEqual([]);
    expect((await search(cashier, { customerId: "pos-search-foreign-customer" })).customers).toEqual([]);
    expect((await search(cashier, { customerId: id(20) })).customers).toEqual([]);
    await expect(search(cashier, { query: "target" }, foreignBranch)).rejects.toMatchObject({ code: "functions/permission-denied" });
    await db.doc(`users/${second.uid}`).update({ authDisabled: true });
    await expect(search(second)).rejects.toMatchObject({ code: "functions/permission-denied" });
    await db.doc(`users/${second.uid}`).update({ authDisabled: false });
  });
  it("requires an active POS branch and an active sales location on the search path", async () => {
    await db.doc(`branches/${branch}`).update({ status: "inactive" });
    try { await expect(search(cashier)).rejects.toMatchObject({ code: "functions/failed-precondition" }); }
    finally { await db.doc(`branches/${branch}`).update({ status: "active" }); }
    await db.doc(`inventoryLocations/${branch}-stock`).update({ status: "inactive" });
    try { await expect(search(cashier)).rejects.toMatchObject({ code: "functions/failed-precondition" }); }
    finally { await db.doc(`inventoryLocations/${branch}-stock`).update({ status: "active" }); }
  });
  it("binds cursor context and preserves a selected active customer beyond the workspace cap", async () => {
    const page = await search(cashier, { query: "aliyu" });
    await expect(search(cashier, { query: "different", cursor: page.nextCursor })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    await expect(search(second, { query: "aliyu", cursor: page.nextCursor })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    const workspace = (await httpsCallable<object, { customers: PosCustomer[] }>(cashier.f, "getPosWorkspace")({ branchId: branch, customerId: id(1105) })).data;
    expect(workspace.customers.some(row => row.id === id(1105))).toBe(true);
    expect(workspace.customers.some(row => row.id === id(20))).toBe(false);
    expect(await customerHash()).toBe(beforeHash);
  });
});
