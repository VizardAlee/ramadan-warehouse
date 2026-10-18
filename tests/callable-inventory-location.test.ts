import { createHash } from "node:crypto";
import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { collection, connectFirestoreEmulator, getDocs, getFirestore as getClientFirestore, query, where } from "firebase/firestore";
import { getApps, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const projectId = process.env.TEST_FIREBASE_PROJECT_ID ?? "demo-ramadan-warehouse";
if (!projectId.startsWith("demo-") || !/^127\.0\.0\.1:/.test(process.env.FIRESTORE_EMULATOR_HOST ?? "") || !/^127\.0\.0\.1:/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "")) throw new Error("Location inventory tests require owned local demo emulators.");
const admin = getApps().find((app) => app.name === "location-inventory-tests") ?? initializeAdminApp({ projectId }, "location-inventory-tests");
const db = getFirestore(admin); const auth = getAdminAuth(admin); const apps: FirebaseApp[] = [];
const org = "location-inventory-test-org"; const foreignOrg = "location-inventory-foreign";
function client(name: string) {
  const app = initializeApp({ projectId, apiKey: "demo", appId: `location-${name}` }, `location-${name}`); apps.push(app);
  const auth = getAuth(app); connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  const functions = getFunctions(app, "us-central1"); connectFunctionsEmulator(functions, "127.0.0.1", Number(process.env.TEST_FUNCTIONS_PORT ?? 5001));
  const firestore = getClientFirestore(app); connectFirestoreEmulator(firestore, "127.0.0.1", Number(process.env.FIRESTORE_EMULATOR_HOST!.split(":")[1])); return { auth, functions, firestore };
}
type Client = ReturnType<typeof client>;
async function actor(name: string, roles: string[], branchIds: string[], warehouseIds: string[], organizationId = org) {
  const email = `${name}@location-tests.example`; const password = "Local-demo-only-234567!";
  const user = await auth.createUser({ email, password });
  await db.doc(`users/${user.uid}`).set({ uid: user.uid, email, organizationId, roleId: roles[0], roleIds: roles, branchIds, warehouseIds, status: "active", authDisabled: false, authorizationVersion: 1 });
  const c = client(name); await signInWithEmailAndPassword(c.auth, email, password); return c;
}
interface Page { rows: Record<string, unknown>[]; summary: Record<string, number> | null; nextCursor: string | null; includeCosts: boolean }
const call = async (c: Client, data: Record<string, unknown>, name = "generateStockPositionReport") => (await httpsCallable<Record<string, unknown>, Page>(c.functions, name)(data)).data;
let broad: Client; let mixed: Client; let quantityOnly: Client; let cashier: Client; let foreign: Client;
let beforeHash = "";
const areas = Array.from({ length: 35 }, (_, i) => `location-area-${String(i).padStart(2, "0")}`);
async function stockHash() {
  const collections = ["inventoryBalances", "inventoryEntries", "inventoryTransactions", "customerAccounts", "supplierAccounts", "bankAccounts"];
  const rows: unknown[] = [];
  for (const collection of collections) {
    const snapshot = await db.collection(collection).where("organizationId", "==", org).get();
    rows.push(...snapshot.docs.map((d) => [d.ref.path, Object.fromEntries(Object.entries(d.data()).sort(([a], [b]) => a.localeCompare(b)))]));
  }
  rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))); return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}
beforeAll(async () => {
  await Promise.all([db.doc(`organizations/${org}`).set({ name: "Local inventory scope fixtures", status: "active" }), db.doc(`organizations/${foreignOrg}`).set({ name: "Other local organization", status: "active" })]);
  broad = await actor("broad", ["system_administrator"], [], []);
  mixed = await actor("mixed", ["warehouse_manager", "branch_manager"], ["a"], ["a"]);
  quantityOnly = await actor("quantity", ["warehouse_officer"], [], ["a"]);
  cashier = await actor("cashier", ["sales_cashier"], ["a"], []);
  foreign = await actor("foreign", ["system_administrator"], [], [], foreignOrg);
  const locations = [{ id: "location-stock-a", branchId: "a" }, { id: "location-damage-a", branchId: "a" }, { id: "location-stock-b", branchId: "b" }, { id: "location-legacy-a", warehouseId: "a" }, ...areas.map((id) => ({ id, branchId: "a" }))];
  await Promise.all(locations.map(({ id, ...scope }) => db.doc(`inventoryLocations/${id}`).set({ organizationId: org, name: id, type: "branchId" in scope ? "branch" : "warehouse", status: "active", ...scope })));
  const balances: [string, Record<string, unknown>][] = Array.from({ length: 1101 }, (_, i) => [`location-b-${String(i).padStart(4, "0")}`, { organizationId: org, productId: `location-product-${i}`, sku: `LOCAL-${i}`, branchId: "a", locationId: "location-stock-a", onHandQuantity: i ? 1 : 0, reservedQuantity: 0, availableQuantity: i ? 1 : 0, totalValueMinor: i ? 100 : 0, averageUnitCostMinor: 100 }]);
  balances.push(["location-damaged-zero", { organizationId: org, productId: "damaged-zero", branchId: "a", locationId: "location-damage-a", onHandQuantity: 0, reservedQuantity: 0, availableQuantity: 0, totalValueMinor: 0 }], ["location-other-branch", { organizationId: org, productId: "other-branch", branchId: "b", locationId: "location-stock-b", onHandQuantity: 7, reservedQuantity: 0, availableQuantity: 7, totalValueMinor: 700 }], ["location-legacy", { organizationId: org, productId: "legacy", warehouseId: "a", locationId: "location-legacy-a", onHandQuantity: 9, reservedQuantity: 0, availableQuantity: 9, totalValueMinor: 900, averageUnitCostMinor: 100 }], ["location-foreign", { organizationId: foreignOrg, productId: "foreign", branchId: "a", locationId: "location-stock-a", onHandQuantity: 99, reservedQuantity: 0, availableQuantity: 99, totalValueMinor: 9900 }]);
  balances.push(...areas.map((locationId, i): [string, Record<string, unknown>] => [`location-area-b-${String(i).padStart(2, "0")}`, { organizationId: org, productId: `area-product-${i}`, branchId: "a", locationId, onHandQuantity: 0, reservedQuantity: 0, availableQuantity: 0, totalValueMinor: 0 }]));
  for (let i = 0; i < balances.length; i += 400) { const batch = db.batch(); for (const [id, row] of balances.slice(i, i + 400)) batch.set(db.doc(`inventoryBalances/${id}`), row); await batch.commit(); }
  await Promise.all([
    db.doc("inventoryEntries/location-entry-branch").set({ organizationId: org, productId: "history-product", branchId: "a", locationId: "location-stock-a", effectiveAt: new Date("2026-10-17T10:00:00Z"), quantityDelta: 1, valueDeltaMinor: 100 }),
    db.doc("inventoryEntries/location-entry-warehouse").set({ organizationId: org, productId: "history-product", warehouseId: "a", locationId: "location-legacy-a", effectiveAt: new Date("2026-10-17T10:00:00Z"), quantityDelta: 9, valueDeltaMinor: 900 }),
    db.doc("customerAccounts/location-control").set({ organizationId: org, outstandingMinor: 900, creditLimitMinor: 1000, availableCreditMinor: 100 }),
    db.doc("supplierAccounts/location-control").set({ organizationId: org, advanceMinor: 101, payableMinor: 0 }),
    db.doc("bankAccounts/location-control").set({ organizationId: org, balanceMinor: 1000 }),
  ]);
  beforeHash = await stockHash();
});
afterAll(async () => { await Promise.all(apps.map(deleteApp)); });

describe.sequential("actual location inventory callable boundary", () => {
  it("loads only assigned location metadata under the unchanged Firestore rules", async () => {
    const locations = collection(mixed.firestore, "inventoryLocations");
    const scoped = (field: string, id: string) => query(locations, where("organizationId", "==", org), where(field, "==", id));
    const branch = await getDocs(scoped("branchId", "a"));
    expect(branch.docs).toHaveLength(37); expect(branch.docs.every((d) => d.get("branchId") === "a" && !d.get("warehouseId"))).toBe(true);
    const warehouse = await getDocs(scoped("warehouseId", "a")); expect(warehouse.docs).toHaveLength(1); expect(warehouse.docs[0]!.id).toBe("location-legacy-a");
    await expect(getDocs(query(locations, where("organizationId", "==", org)))).rejects.toMatchObject({ code: "permission-denied" });
    await expect(getDocs(scoped("branchId", "b"))).rejects.toMatchObject({ code: "permission-denied" });
  });
  it("returns one position page with whole-scope totals and retains zero-stock rows", async () => {
    const result = await call(broad, { locationIds: ["location-stock-a"], limit: 25, includeCosts: true });
    expect(result.rows).toHaveLength(25); expect(result.rows[0]!.onHandQuantity).toBe(0);
    expect(result.summary).toMatchObject({ count: 1101, onHandQuantity: 1100, availableQuantity: 1100, valueMinor: 110000 });
    const next = await call(broad, { locationIds: ["location-stock-a"], limit: 25, cursor: result.nextCursor, withSummary: false });
    expect(next.rows).toHaveLength(25); expect(next.summary).toBeNull(); expect(next.rows[0]!.id).not.toBe(result.rows[0]!.id);
  });
  it("pages projected membership without costs/aggregates or an exact-multiple empty request", async () => {
    const first = await call(broad, { locationIds: ["location-stock-a"], cursor: "location-b-0100", view: "membership", limit: 500, includeCosts: true });
    const last = await call(broad, { locationIds: ["location-stock-a"], cursor: first.nextCursor, view: "membership", limit: 500 });
    expect(first.rows).toHaveLength(500); expect(last.rows).toHaveLength(500); expect(last.nextCursor).toBeNull();
    expect(first.includeCosts).toBe(false); expect(first.summary).toBeNull(); expect(Object.keys(first.rows[0]!).sort()).toEqual(["id", "productId"]);
  });
  it("merges more than30 inventory areas in stable cursor order with no duplicates", async () => {
    const first = await call(broad, { locationIds: [...areas, areas[0]], limit: 25 });
    const last = await call(broad, { locationIds: areas, limit: 25, cursor: first.nextCursor, withSummary: false });
    expect(first.summary?.count).toBe(35); expect(first.rows).toHaveLength(25); expect(last.rows).toHaveLength(10); expect(last.nextCursor).toBeNull();
    expect(new Set([...first.rows, ...last.rows].map((r) => r.id)).size).toBe(35);
  });
  it("honors an already authorized branch for mixed roles and never merges its same-ID warehouse", async () => {
    const branch = await call(mixed, { operatingContext: { type: "branch", id: "a" }, locationIds: ["location-stock-a", "location-legacy-a"], limit: 25 });
    expect(branch.summary?.count).toBe(1101); expect(branch.rows.every((r) => r.branchId === "a" && r.locationId === "location-stock-a")).toBe(true);
    const warehouse = await call(mixed, { operatingContext: { type: "warehouse", id: "a" }, locationIds: ["location-stock-a", "location-legacy-a"] });
    expect(warehouse.rows).toHaveLength(1); expect(warehouse.rows[0]!.productId).toBe("legacy");
  });
  it("keeps movement preview branch-scoped for the same mixed-role account", async () => {
    const result = await call(mixed, { operatingContext: { type: "branch", id: "a" }, productId: "history-product", locationId: "location-stock-a" }, "getSkuMovementHistory");
    expect(result.rows).toHaveLength(1); expect(result.rows[0]!.id).toBe("location-entry-branch");
  });
  it("does not broaden assignment, role or All-locations authority", async () => {
    await expect(call(mixed, { operatingContext: { type: "branch", id: "b" }, locationIds: ["location-stock-b"] })).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(call(mixed, {})).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await expect(call(quantityOnly, { operatingContext: { type: "branch", id: "a" }, locationIds: ["location-stock-a"] })).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(call(cashier, { locationIds: ["location-stock-a"] })).rejects.toMatchObject({ code: "functions/permission-denied" });
  });
  it("preserves server cost redaction for quantity-only roles", async () => {
    const result = await call(quantityOnly, { operatingContext: { type: "warehouse", id: "a" }, locationIds: ["location-legacy-a"], includeCosts: true });
    expect(result.rows).toHaveLength(1); expect(result.includeCosts).toBe(false); expect(result.summary).not.toHaveProperty("valueMinor");
    expect(result.rows[0]).not.toHaveProperty("totalValueMinor"); expect(result.rows[0]).not.toHaveProperty("averageUnitCostMinor");
  });
  it("keeps authorized All locations and foreign-organization data isolated", async () => {
    const all = await call(broad, { limit: 100 }); expect(all.summary?.count).toBe(1139); expect(all.rows.every((r) => r.organizationId === org)).toBe(true);
    const other = await call(foreign, { locationIds: ["location-stock-a"] }); expect(other.rows).toHaveLength(1); expect(other.rows[0]!.productId).toBe("foreign");
  });
  it("rejects invalid bounds and leaves stock and financial controls unchanged", async () => {
    await expect(call(broad, { locationIds: [] })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    await expect(call(broad, { locationIds: ["location-stock-a"], locationId: "location-legacy-a" })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    expect(await stockHash()).toBe(beforeHash);
  });
});
