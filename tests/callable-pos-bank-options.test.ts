import { initializeApp, deleteApp, type FirebaseApp } from "firebase/app";
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
import { getFirestore as clientDb, connectFirestoreEmulator, doc, getDoc } from "firebase/firestore";
import { getApps, initializeApp as adminApp } from "firebase-admin/app";
import { getAuth as adminAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uniquenessDocumentId } from "../functions/src/inventory/calculations";
const projectId = process.env.TEST_FIREBASE_PROJECT_ID ?? "demo-ramadan-warehouse";
if (!projectId.startsWith("demo-") || !/^127\.0\.0\.1:/.test(process.env.FIRESTORE_EMULATOR_HOST ?? "") || !/^127\.0\.0\.1:/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "")) throw Error("Fast-moving tests require owned local demo emulators.");
const admin = getApps().find(a => a.name === "bank-options-tests") ?? adminApp({ projectId }, "bank-options-tests");
const db = getFirestore(admin), auth = adminAuth(admin), org = "bank-options-org", branch = "bank-options-store", other = "bank-options-other", apps: FirebaseApp[] = [];
function client(name: string) {
  const app = initializeApp({ projectId, apiKey: "demo", appId: "demo-bank-options" }, `bank-options-${name}`); apps.push(app);
  const a = getAuth(app); connectAuthEmulator(a, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  const f = getFunctions(app, "us-central1"); connectFunctionsEmulator(f, "127.0.0.1", Number(process.env.TEST_FUNCTIONS_PORT ?? 5001));
  const d = clientDb(app), [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(":"); connectFirestoreEmulator(d, host!, Number(port)); return { a, f, d };
}
async function actor(name: string, permissions = ["sales.read.own_branch"]) {
  const email = `${name}@bank-options.example.invalid`, password = "Synthetic-only-234567!", record = await auth.createUser({ email, password });
  await db.doc(`users/${record.uid}`).set({ organizationId: org, displayName: name, roleId: "sales_cashier", roleIds: ["sales_cashier"], branchIds: [branch], warehouseIds: [], status: "active", authDisabled: false, authorizationVersion: 1, effectivePermissions: permissions });
  const c = client(name); await signInWithEmailAndPassword(c.a, email, password); return c;
}

let cashier: Awaited<ReturnType<typeof actor>>, denied: Awaited<ReturnType<typeof actor>>;
const options = async (c: ReturnType<typeof client>, store = branch) => (await httpsCallable<object, {bankAccounts: {id:string}[]}>(c.f, "getPosWorkspace")({ branchId: store, bankOptionsOnly: true })).data;
beforeAll(async () => {
  await db.doc(`organizations/${org}`).set({ status: "active" });
  for (const id of [branch, other]) {
    await db.doc(`branches/${id}`).set({ organizationId: org, status: "active", name: id, branchType: "store" });
    await db.doc(`inventoryLocations/${id}-stock`).set({ organizationId: org, branchId: id, type: "branch", status: "active", name: "Stock" });
  }
  cashier = await actor("cashier"); denied = await actor("denied", []);
  for (const [id, data] of Object.entries({
    local: {active:true, branchId:branch}, company: {active:true},
    archived: {active:false, branchId:branch, lifecycleStatus:"archived"},
    removed: {active:false, branchId:branch, lifecycleStatus:"removed"},
    other: {active:true, branchId:other}, foreign: {active:true, organizationId:"another-org"}
  })) await db.doc(`bankAccounts/bank-options-${id}`).set({organizationId:org, bankName:"Synthetic", accountName:id, accountNumberLast4:"0000", ledgerAccountCode:"1020", ...data});
});
afterAll(async () => { await Promise.all(apps.map(deleteApp)); });
it("returns active own-branch and company-wide accounts only", async () => {
  const result = await options(cashier);
  expect(Object.keys(result)).toEqual(["bankAccounts"]);
  expect(result.bankAccounts.map(a=>a.id).sort()).toEqual(["bank-options-company", "bank-options-local"]);
});
it("retains anonymous, role and branch restrictions", async () => {
  await expect(options(client("anonymous"))).rejects.toMatchObject({code:"functions/unauthenticated"});
  await expect(options(denied)).rejects.toMatchObject({code:"functions/permission-denied"});
  await expect(options(cashier,other)).rejects.toMatchObject({code:"functions/permission-denied"});
});
it("removes disabled synthetic accounts on refresh without deleting history", async () => {
  await db.doc("bankAccounts/bank-options-local").update({active:false,lifecycleStatus:"archived"});
  expect((await options(cashier)).bankAccounts.map(a=>a.id)).toEqual(["bank-options-company"]);
  expect((await db.doc("bankAccounts/bank-options-local").get()).exists).toBe(true);
});
