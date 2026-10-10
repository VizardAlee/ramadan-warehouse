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
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AccessProfile } from "../functions/src/auth/authorize";
import type { InventoryPostingExtension, PostingRequest } from "../functions/src/inventory/post-inventory-transaction";
import { balanceDocumentId, uniquenessDocumentId } from "../functions/src/inventory/calculations";

const projectId = process.env.TEST_FIREBASE_PROJECT_ID ?? "demo-ramadan-warehouse";
if (!projectId.startsWith("demo-")) throw new Error("Inventory acceptance requires an isolated demo project.");
const adminApp =
  getAdminApps().find((app) => app.name === "inventory-callable-tests") ??
  initializeAdminApp({ projectId }, "inventory-callable-tests");
const adminAuth = getAdminAuth(adminApp);
const adminDb = getFirestore(adminApp);
const apps: FirebaseApp[] = [];
const organizationId = "inventory-test-org";
let administrator: ReturnType<typeof client>;
let branchActor: ReturnType<typeof client>;
let productId = "";
let openingTransactionId = "";

function client(name: string) {
  const app = initializeApp(
    { projectId, apiKey: "demo", appId: `inventory-${name}` },
    `inventory-${name}`,
  );
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099"}`, {
    disableWarnings: true,
  });
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

async function createActor(
  email: string,
  roleId: string,
  actorOrganizationId = organizationId,
) {
  const record = await adminAuth.createUser({
    email,
    password: "Password!234567",
    displayName: roleId,
  });
  await adminDb.doc(`users/${record.uid}`).set({
    uid: record.uid,
    organizationId: actorOrganizationId,
    email,
    displayName: roleId,
    roleId,
    branchIds: roleId === "branch_manager" ? ["branch-a"] : [],
    warehouseIds: ["warehouse-a"],
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

function product(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name: "580W Monocrystalline Panel",
    sku: "PANEL-580",
    unitOfMeasure: "unit",
    trackingType: "quantity",
    defaultUnitCostMinor: 10_000,
    active: true,
    idempotencyKey: crypto.randomUUID(),
    ...overrides,
  };
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
  await adminDb.doc(`organizations/${organizationId}`).set({ name: "Inventory test organization", status: "active" });
  administrator = await createActor(
    "inventory-admin@example.test",
    "system_administrator",
  );
  const now = FieldValue.serverTimestamp();
  await Promise.all(
    ["location-a", "location-b", "location-c", "location-d"].map((id) =>
      adminDb.doc(`inventoryLocations/${id}`).set({
        organizationId,
        warehouseId: "warehouse-a",
        name: id,
        code: id.toUpperCase(),
        type: "warehouse",
        status: "active",
        systemManaged: false,
        createdAt: now,
        updatedAt: now,
      }),
    ),
  );
});

afterAll(async () => Promise.all(apps.map((app) => deleteApp(app))));

describe.sequential("inventory callables", () => {
  it("assigns unbound multi-role administrators safely and protects count creation retries", async () => {
    const global = await createActor("global-count-admin@example.test", "sales_cashier");
    const globalId = global.auth.currentUser!.uid;
    await adminDb.doc(`users/${globalId}`).update({ roleIds: ["sales_cashier", "system_administrator"], warehouseIds: [], branchIds: [] });
    await adminDb.doc("inventoryLocations/hq-count-location").set({ organizationId, branchId: "branch-a", name: "HQ store", type: "branch", status: "active" });
    const instruction = { locationId: "hq-count-location", assignedUserIds: [globalId], blindCount: true, countDate: "2026-10-10", notes: "Global admin physical count", idempotencyKey: crypto.randomUUID() };
    const [first, retry] = await Promise.all([
      call<{ stockCountId: string; created: boolean }>(administrator, "createStockCount", instruction),
      call<{ stockCountId: string; created: boolean }>(administrator, "createStockCount", instruction),
    ]);
    expect(first.stockCountId).toBe(retry.stockCountId);
    expect([first.created, retry.created].sort()).toEqual([false, true]);
    await expect(call(administrator, "createStockCount", { ...instruction, notes: "Different details" })).rejects.toMatchObject({ code: "functions/already-exists" });
    const cashier = await createActor("count-no-permission@example.test", "sales_cashier");
    const cashierId = cashier.auth.currentUser!.uid;
    await adminDb.doc(`users/${cashierId}`).update({ branchIds: ["branch-a"], effectivePermissions: [] });
    await expect(call(administrator, "createStockCount", { ...instruction, assignedUserIds: [cashierId], idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/permission-denied" });
    await adminDb.doc(`users/${cashierId}`).update({ customRoleIds: ["count-only"], effectivePermissions: ["inventory.count"] });
    expect(await call(administrator, "createStockCount", { ...instruction, assignedUserIds: [cashierId], idempotencyKey: crypto.randomUUID() })).toMatchObject({ created: true });
    await adminDb.doc(`users/${cashierId}`).update({ branchIds: ["other-store"] });
    await expect(call(administrator, "createStockCount", { ...instruction, assignedUserIds: [cashierId], idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/permission-denied" });
    await adminDb.doc(`users/${globalId}`).update({ authDisabled: true });
    await expect(call(administrator, "createStockCount", instruction)).rejects.toMatchObject({ code: "functions/permission-denied" });
    await adminDb.doc(`users/${globalId}`).update({ authDisabled: false });
    await expect(call(global, "createStockCount", instruction)).rejects.toMatchObject({ code: "functions/already-exists" });
    const scopedManager = await createActor("count-scoped-manager@example.test", "branch_manager");
    const scopedInstruction = { ...instruction, idempotencyKey: crypto.randomUUID() };
    await call(scopedManager, "createStockCount", scopedInstruction);
    await adminDb.doc(`users/${scopedManager.auth.currentUser!.uid}`).update({ branchIds: ["other-store"] });
    await expect(call(scopedManager, "createStockCount", scopedInstruction)).rejects.toMatchObject({ code: "functions/permission-denied" });
    const operation = adminDb.doc(`idempotencyKeys/${organizationId}_createStockCount_${instruction.idempotencyKey}`);
    await operation.update({ payloadFingerprint: FieldValue.delete() });
    expect(await call(administrator, "createStockCount", instruction)).toMatchObject({ stockCountId: first.stockCountId, created: false });
    await expect(call(administrator, "createStockCount", { ...instruction, blindCount: false })).rejects.toMatchObject({ code: "functions/already-exists" });
    await expect(call(administrator, "createStockCount", { ...instruction, assignedUserIds: [globalId, globalId], idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/invalid-argument" });
  });
  it("pages blind counts, saves progress without posting and blocks incomplete or duplicate submissions", async () => {
    const counter = await createActor("paged-count-officer@example.test", "warehouse_officer");
    const countId = "paged-blind-count", uid = counter.auth.currentUser!.uid;
    const batch = adminDb.batch();
    batch.set(adminDb.doc(`stockCounts/${countId}`), { organizationId, locationId: "location-a", warehouseId: "warehouse-a", countNumber: "COUNT-PAGES", status: "in_progress", blindCount: true, assignedUserIds: [uid] });
    for (let i = 0; i < 26; i++) batch.set(adminDb.doc(`stockCountItems/${countId}-${String(i).padStart(3, "0")}`), { organizationId, stockCountId: countId, sku: `SKU-${i}`, trackingType: "quantity", expectedQuantity: 3, expectedSerialNumbers: [], countedQuantity: null, variance: null });
    await batch.commit();
    const action = { stockCountId: countId, reason: "Physical count page test", idempotencyKey: crypto.randomUUID() };
    type Page = { items: { id: string; expectedQuantity?: number; variance?: number }[]; nextCursor: string | null };
    const first = await call<Page>(counter, "getStockCountWorkspace", { ...action, limit: 25 });
    expect(first.items).toHaveLength(25); expect(first.nextCursor).toBeTruthy();
    expect(first.items.every(item => item.expectedQuantity === undefined && item.variance === undefined)).toBe(true);
    const lines = first.items.map(item => ({ itemId: item.id, countedQuantity: 2, serialNumbers: [] }));
    await expect(call(counter, "submitStockCount", { ...action, items: lines })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect((await adminDb.doc(`stockCountItems/${lines[0]!.itemId}`).get()).get("countedQuantity")).toBeNull();
    await expect(call(counter, "submitStockCount", { ...action, saveOnly: true, items: [lines[0], lines[0]] })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    await expect(call(counter, "submitStockCount", { ...action, saveOnly: true, items: lines })).resolves.toMatchObject({ saved: true, submitted: false });
    expect((await adminDb.doc(`stockCounts/${countId}`).get()).get("status")).toBe("in_progress");
    const second = await call<Page>(counter, "getStockCountWorkspace", { ...action, limit: 25, cursor: first.nextCursor });
    expect(second.items).toHaveLength(1); expect(second.nextCursor).toBeNull();
    await expect(call(counter, "getStockCountWorkspace", { ...action, cursor: "not-this-count" })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    await expect(call(counter, "submitStockCount", { ...action, items: [{ itemId: second.items[0]!.id, countedQuantity: 0, serialNumbers: [] }] })).resolves.toMatchObject({ submitted: true });
    expect((await adminDb.doc(`stockCounts/${countId}`).get()).get("status")).toBe("submitted");
    expect((await adminDb.collection("inventoryEntries").where("referenceId", "==", countId).get()).empty).toBe(true);
    await adminDb.doc("stockCountItems/zz-foreign-count-line").set({ organizationId: "foreign-org", stockCountId: countId, sku: "DO-NOT-EXPOSE", countedQuantity: 0 });
    await expect(call(counter, "getStockCountWorkspace", { ...action, cursor: first.nextCursor, limit: 25 })).rejects.toMatchObject({ code: "functions/failed-precondition" });
  });

  it("snapshots more than 500 positions atomically, safely retries and rejects oversized snapshots without omission", async () => {
    const locationId = "oversized-count-location", countId = "oversized-draft-count";
    const batch = adminDb.batch();
    batch.set(adminDb.doc(`stockCounts/${countId}`), { organizationId, locationId, warehouseId: "warehouse-a", status: "draft", assignedUserIds: [administrator.auth.currentUser!.uid] });
    await batch.commit();
    for (let start = 0; start < 501; start += 400) {
      const positions = adminDb.batch();
      for (let i = start; i < Math.min(start + 400, 501); i++) positions.set(adminDb.doc(`inventoryBalances/${locationId}-${i}`), { organizationId, locationId, warehouseId: "warehouse-a", productId: `oversized-${i}`, sku: `BIG-${i}`, onHandQuantity: 1, availableQuantity: 1, reservedQuantity: 0, totalValueMinor: 0, version: 1 });
      await positions.commit();
    }
    const input = { stockCountId: countId, reason: "Do not truncate the snapshot", idempotencyKey: crypto.randomUUID() };
    await expect(call(administrator, "startStockCount", input)).resolves.toMatchObject({ started: true, itemCount: 501 });
    await expect(call(administrator, "startStockCount", input)).resolves.toMatchObject({ started: false, itemCount: 501 });
    expect((await adminDb.collection("stockCountItems").where("stockCountId", "==", countId).get()).size).toBe(501);
    const oversizeId = `${countId}-rejected`;
    await adminDb.doc(`stockCounts/${oversizeId}`).set({ organizationId, locationId, warehouseId: "warehouse-a", status: "draft", assignedUserIds: [administrator.auth.currentUser!.uid] });
    for (let start = 501; start < 2001; start += 400) {
      const positions = adminDb.batch();
      for (let i = start; i < Math.min(start + 400, 2001); i++) positions.set(adminDb.doc(`inventoryBalances/${locationId}-${i}`), { organizationId, locationId, warehouseId: "warehouse-a", productId: `oversized-${i}`, sku: `BIG-${i}`, onHandQuantity: 1, availableQuantity: 1, reservedQuantity: 0, totalValueMinor: 0, version: 1 });
      await positions.commit();
    }
    await expect(call(administrator, "startStockCount", { ...input, stockCountId: oversizeId, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/resource-exhausted" });
    expect((await adminDb.doc(`stockCounts/${oversizeId}`).get()).get("status")).toBe("draft");
    expect((await adminDb.collection("stockCountItems").where("stockCountId", "==", oversizeId).get()).empty).toBe(true);
  });

  it("blocks review and posting of historical incomplete counts", async () => {
    const countId = "historical-incomplete-count";
    const reference = adminDb.doc(`stockCounts/${countId}`);
    await reference.set({ organizationId, locationId: "location-a", warehouseId: "warehouse-a", status: "submitted", assignedUserIds: [administrator.auth.currentUser!.uid] });
    await adminDb.doc(`stockCountItems/${countId}-line`).set({ organizationId, stockCountId: countId, expectedQuantity: 2, countedQuantity: null, variance: null });
    const input = { stockCountId: countId, reason: "Do not post an unfinished count", idempotencyKey: crypto.randomUUID() };
    await expect(call(administrator, "reviewStockCount", input)).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await reference.update({ status: "reviewed" });
    await expect(call(administrator, "postStockCount", input)).rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect((await reference.get()).get("postingEffectiveAt")).toBeUndefined();
  });

  it("links stock valuation to balanced non-cash journals and reverses both exactly once", async () => {
    const created = await call<{ productId: string }>(administrator, "saveProduct", product({ sku: "JOURNAL-STOCK" }));
    const payload = { productId: created.productId, destinationLocationId: "location-a", quantity: 3, unitCostMinor: 1000, serialNumbers: [], effectiveAt: "2026-08-02T10:00:00.000Z", reason: "Verified opening stock valuation", externalAccount: "migration", idempotencyKey: crypto.randomUUID() };
    const attempts = await Promise.all([0, 1].map(() => call<{ transactionId: string; posted: boolean }>(administrator, "postOpeningStock", payload)));
    const opening = attempts[0]!;
    expect(attempts.map(attempt => attempt.transactionId)).toEqual([opening.transactionId, opening.transactionId]);
    expect(attempts.filter(attempt => attempt.posted)).toHaveLength(1);
    const openingDoc = await adminDb.doc(`inventoryTransactions/${opening.transactionId}`).get();
    const journal = await adminDb.doc(`journalEntries/${openingDoc.get("journalEntryId")}`).get();
    expect(journal.data()).toMatchObject({ referenceId: opening.transactionId, totalDebitMinor: 3000, totalCreditMinor: 3000, journalType: "inventory_opening_balance" });
    expect((await adminDb.collection("journalEntries").where("referenceId", "==", opening.transactionId).get()).size).toBe(1);
    expect(await call(administrator, "postOpeningStock", payload)).toMatchObject({ transactionId: opening.transactionId, posted: false });
    await expect(call(administrator, "postOpeningStock", { ...payload, quantity: 4 })).rejects.toMatchObject({ code: "functions/already-exists" });
    const manager = await createActor("stock-journal-retry-manager@example.test", "warehouse_manager");
    expect(await call(manager, "postOpeningStock", payload)).toMatchObject({ posted: false });
    await adminDb.doc(`users/${manager.auth.currentUser!.uid}`).update({ warehouseIds: [] });
    await expect(call(manager, "postOpeningStock", payload)).rejects.toMatchObject({ code: "functions/permission-denied" });
    const issue = await call<{ transactionId: string }>(administrator, "postStockAdjustment", { productId: created.productId, locationId: "location-a", direction: "decrease", adjustmentType: "damage", quantity: 1, unitCostMinor: 9999, serialNumbers: [], effectiveAt: payload.effectiveAt, reason: "Counted damaged product removed", idempotencyKey: crypto.randomUUID() });
    const issueDoc = await adminDb.doc(`inventoryTransactions/${issue.transactionId}`).get();
    expect(issueDoc.get("accountingValueMinor")).toBe(1000);
    const request = { transactionId: issue.transactionId, reason: "Damage evidence corrected by manager", idempotencyKey: crypto.randomUUID() };
    const issueJournal = adminDb.doc(`journalEntries/${issueDoc.get("journalEntryId")}`);
    await issueJournal.update({ totalDebitMinor: 999 });
    await expect(call(administrator, "reverseInventoryTransaction", request)).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await issueJournal.update({ totalDebitMinor: 1000 });
    const currentPeriod = adminDb.doc(`accountingPeriods/${uniquenessDocumentId(organizationId, new Date().toISOString().slice(0, 7))}`);
    await currentPeriod.set({ organizationId, status: "closed", periodKey: new Date().toISOString().slice(0, 7) });
    await expect(call(administrator, "reverseInventoryTransaction", request)).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await currentPeriod.delete();
    const reversed = await call<{ transactionId: string }>(administrator, "reverseInventoryTransaction", request);
    expect(await call(administrator, "reverseInventoryTransaction", request)).toMatchObject({ transactionId: reversed.transactionId, reversed: false });
    const originalJournal = await adminDb.doc(`journalEntries/${issueDoc.get("journalEntryId")}`).get();
    const reversedDoc = await adminDb.doc(`inventoryTransactions/${reversed.transactionId}`).get();
    expect(originalJournal.get("reversalJournalEntryId")).toBe(reversedDoc.get("journalEntryId"));
    const lines = await adminDb.collection("journalLines").where("journalEntryId", "==", reversedDoc.get("journalEntryId")).get();
    expect(lines.docs.map(line => line.data())).toEqual(expect.arrayContaining([expect.objectContaining({ accountCode: "1200", debitMinor: 1000, creditMinor: 0 }), expect.objectContaining({ accountCode: "5200", debitMinor: 0, creditMinor: 1000 })]));
  });

  it("rolls back stock in a closed accounting period and records zero-valued stock without invented journals", async () => {
    const created = await call<{ productId: string }>(administrator, "saveProduct", product({ sku: "PERIOD-STOCK" }));
    const period = adminDb.doc(`accountingPeriods/${uniquenessDocumentId(organizationId, "2025-01")}`);
    await period.set({ organizationId, periodKey: "2025-01", status: "closed" });
    const payload = { productId: created.productId, destinationLocationId: "location-a", quantity: 1, unitCostMinor: 0, serialNumbers: [], effectiveAt: "2025-01-02T10:00:00.000Z", reason: "Verified zero value opening stock", externalAccount: "migration", idempotencyKey: crypto.randomUUID() };
    await expect(call(administrator, "postOpeningStock", payload)).rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect((await adminDb.collection("inventoryEntries").where("productId", "==", created.productId).get()).empty).toBe(true);
    const posted = await call<{ transactionId: string }>(administrator, "postOpeningStock", { ...payload, effectiveAt: "2026-08-02T10:00:00.000Z" });
    expect((await adminDb.doc(`inventoryTransactions/${posted.transactionId}`).get()).data()).toMatchObject({ accountingVersion: 2, accountingValueMinor: 0, journalEntryId: null });
  });

  it("posts every variance beyond 100 lines and permits auditable manager self-authorization", async () => {
    const countManager = await createActor("large-count-manager@example.test", "warehouse_manager");
    const countId = "large-reviewed-count", manager = countManager.auth.currentUser!.uid;
    const batch = adminDb.batch();
    const fixtureLines: { itemId: string; productId: string }[] = [];
    batch.set(adminDb.doc(`stockCounts/${countId}`), { organizationId, locationId: "location-a", warehouseId: "warehouse-a", countNumber: "COUNT-LARGE", status: "reviewed", reviewedBy: manager, assignedUserIds: [manager] });
    for (let index = 0; index < 101; index++) {
      const id = `large-count-product-${index}`, balanceId = balanceDocumentId(organizationId, id, "location-a");
      fixtureLines.push({ itemId: `${countId}__${balanceId}`, productId: id });
      batch.set(adminDb.doc(`products/${id}`), { organizationId, name: id, sku: id, trackingType: "quantity", unitOfMeasure: "unit", active: true, defaultUnitCostMinor: 100 });
      batch.set(adminDb.doc(`inventoryBalances/${balanceId}`), { organizationId, productId: id, locationId: "location-a", warehouseId: "warehouse-a", onHandQuantity: 1, reservedQuantity: 0, availableQuantity: 1, totalValueMinor: 100, averageUnitCostMinor: 100 });
      batch.set(adminDb.doc(`stockCountItems/${countId}__${balanceId}`), { organizationId, stockCountId: countId, productId: id, trackingType: "quantity", expectedQuantity: 1, countedQuantity: 2, variance: 1 });
    }
    await batch.commit();
    const payload = { stockCountId: countId, reason: "Manager verified complete physical count", idempotencyKey: crypto.randomUUID() };
    const lastProduct = fixtureLines.sort((left, right) => left.itemId.localeCompare(right.itemId)).at(-1)!.productId;
    await adminDb.doc(`products/${lastProduct}`).update({ active: false });
    await expect(call(countManager, "postStockCount", payload)).rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect((await adminDb.doc(`stockCounts/${countId}`).get()).get("status")).toBe("reviewed");
    await expect(call(countManager, "postStockCount", { ...payload, reason: "Changed partial posting must not resume" })).rejects.toMatchObject({ code: "functions/already-exists" });
    await adminDb.doc(`products/${lastProduct}`).update({ active: true });
    const result = await call<{ transactionIds: string[] }>(countManager, "postStockCount", payload);
    expect(result.transactionIds).toHaveLength(101);
    expect((await adminDb.collection("journalEntries").where("referenceType", "==", "inventoryTransaction").where("journalType", "==", "inventory_stock_count_correction").get()).size).toBe(101);
    expect(await call(countManager, "postStockCount", payload)).toMatchObject({ posted: false, transactionIds: result.transactionIds });
    await expect(call(countManager, "postStockCount", { ...payload, reason: "Changed posting request must not replay" })).rejects.toMatchObject({ code: "functions/already-exists" });
  }, 120000);

  it("keeps non-stock services out of inventory and preserves legacy goods classification", async () => {
    const payload = product({ name: "Installation service", sku: "SERVICE-INSTALL", itemKind: "service", defaultUnitCostMinor: 0 });
    const service = await call<{ productId: string }>(administrator, "saveProduct", payload);
    const ref = adminDb.doc(`products/${service.productId}`);
    expect((await ref.get()).get("itemKind")).toBe("service");
    const legacyClientEdit = product({ ...payload, id: service.productId, idempotencyKey: crypto.randomUUID() });
    delete legacyClientEdit.itemKind;
    await call(administrator, "saveProduct", legacyClientEdit);
    expect((await ref.get()).get("itemKind")).toBe("service");
    await expect(call(administrator, "saveProduct", { ...payload, id: service.productId, itemKind: "stock", idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    for (const invalid of [{ trackingType: "serial" }, { defaultUnitCostMinor: 100 }, { reorderLevel: 1 }])
      await expect(call(administrator, "saveProduct", { ...payload, ...invalid, sku: crypto.randomUUID().slice(0, 8), idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    const count = (await adminDb.collection("inventoryEntries").count().get()).data().count;
    await expect(call(administrator, "postOpeningStock", { productId: service.productId, destinationLocationId: "location-a", quantity: 1, unitCostMinor: 0, effectiveAt: new Date().toISOString(), reason: "A service has no physical stock", externalAccount: "migration", idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect((await adminDb.collection("inventoryEntries").count().get()).data().count).toBe(count);
  });
  it("enforces case-insensitive organization SKU uniqueness and role authorization", async () => {
    const created = await call<{ productId: string }>(
      administrator,
      "saveProduct",
      product(),
    );
    productId = created.productId;
    const updateWithoutSku = product({
      id: productId,
      name: "Updated 580W Monocrystalline Panel",
    });
    delete updateWithoutSku.sku;
    await expect(
      call(administrator, "saveProduct", updateWithoutSku),
    ).resolves.toMatchObject({ saved: true });
    const updatedWithoutSku = await adminDb.doc(`products/${productId}`).get();
    expect(updatedWithoutSku.get("sku")).toBe("PANEL-580");
    await expect(
      call(administrator, "saveProduct", product({ sku: " panel-580 " })),
    ).rejects.toMatchObject({ code: "functions/already-exists" });

    branchActor = await createActor(
      "inventory-branch@example.test",
      "branch_manager",
    );
    await expect(
      call(branchActor, "saveProduct", product({ sku: "UNAUTH-1" })),
    ).rejects.toMatchObject({ code: "functions/permission-denied" });

    await adminDb.doc("organizations/foreign-org").set({ name: "Foreign test organization", status: "active" });
    const foreign = await createActor(
      "inventory-foreign@example.test",
      "system_administrator",
      "foreign-org",
    );
    await expect(
      call(foreign, "saveProduct", product({ sku: "panel-580" })),
    ).resolves.toMatchObject({ saved: true });
  });

  it("generates a unique SKU when the product creator leaves it blank", async () => {
    const payload = product({ name: "Automatically coded product" });
    delete payload.sku;
    const created = await call<{ productId: string }>(
      administrator,
      "saveProduct",
      payload,
    );
    const saved = await adminDb.doc(`products/${created.productId}`).get();
    const generatedSku = String(saved.get("sku"));

    expect(generatedSku).toBe(`SKU-${created.productId.toUpperCase()}`);
    expect(saved.get("normalizedSku")).toBe(generatedSku);
    const lock = await adminDb
      .doc(`organizationSkus/${organizationId.toUpperCase()}__${generatedSku}`)
      .get();
    expect(lock.exists).toBe(true);
    expect(lock.get("productId")).toBe(created.productId);
  });

  it("previews and imports a mapped product catalogue idempotently", async () => {
    const csv = [
      "name,sku,categoryName,brand,model,description,unitOfMeasure,trackingType,defaultUnitCostNaira,baseSellingPriceNaira,vatPercent,minimumStockLevel,reorderLevel,active",
      '"Imported Inverter","","Imported Power","SVolt","INV-5K","Catalogue import","unit","serial","120000.50","150000.00","7.50","2","4","true"',
    ].join("\n");
    const preview = await call<{
      valid: boolean;
      totalRows: number;
      errors: unknown[];
    }>(administrator, "previewCsvImport", { kind: "products", csv });
    expect(preview).toMatchObject({ valid: true, totalRows: 1, errors: [] });

    const idempotencyKey = crypto.randomUUID();
    const first = await call<{
      imported: boolean;
      summary: { imported: number };
    }>(administrator, "confirmCsvImport", {
      kind: "products",
      csv,
      idempotencyKey,
    });
    const duplicate = await call<{
      imported: boolean;
      summary: { imported: number };
    }>(administrator, "confirmCsvImport", {
      kind: "products",
      csv,
      idempotencyKey,
    });
    expect(first).toMatchObject({ imported: true, summary: { imported: 1 } });
    expect(duplicate).toMatchObject({
      imported: false,
      summary: { imported: 1 },
    });

    const imported = await adminDb
      .collection("products")
      .where("organizationId", "==", organizationId)
      .where("name", "==", "Imported Inverter")
      .limit(1)
      .get();
    expect(imported.size).toBe(1);
    const product = imported.docs[0]!;
    expect(product.data()).toMatchObject({
      sku: `SKU-${product.id.toUpperCase()}`,
      categoryName: "Imported Power",
      brand: "SVolt",
      model: "INV-5K",
      trackingType: "serial",
      minimumStockLevel: 2,
      reorderLevel: 4,
    });
    expect(
      (await adminDb.doc(`productCosts/${product.id}`).get()).data(),
    ).toMatchObject({ defaultUnitCostMinor: 12_000_050 });
    expect(
      (await adminDb.doc(`productSalesPrices/${product.id}`).get()).data(),
    ).toMatchObject({
      basePriceMinor: 15_000_000,
      vatRateBasisPoints: 750,
      active: true,
    });
  });

  it("imports opening quantities with products through the audited stock ledger", async () => {
    const importOrganizationId = `${organizationId}-opening-import`;
    await adminDb.doc(`organizations/${importOrganizationId}`).set({ name: "Opening import test organization", status: "active" });
    await adminDb.doc("branches/catalogue-migration-branch").set({ organizationId: importOrganizationId, name: "Migration store", code: "MIG", status: "active" });
    const importer = await createActor("inventory-import@example.test", "system_administrator", importOrganizationId);
    await adminDb.doc("inventoryLocations/catalogue-migration-store").set({
      organizationId: importOrganizationId,
      branchId: "catalogue-migration-branch",
      name: "Catalogue migration store",
      type: "branch",
      status: "active",
    });
    const csv = [
      "name,sku,unitOfMeasure,trackingType,defaultUnitCostNaira,openingQuantity,openingLocationId",
      "Imported Stock Panel,IMPORTED-STOCK-PANEL,unit,quantity,125000.50,6,catalogue-migration-store",
    ].join("\n");
    await expect(call(importer, "previewCsvImport", { kind: "products", csv }))
      .resolves.toMatchObject({ valid: true, totalRows: 1 });
    const idempotencyKey = crypto.randomUUID();
    const first = await call<{ importId: string; summary: { imported: number; stockedRows: number } }>(importer, "confirmCsvImport", {
      kind: "products", csv, idempotencyKey,
    });
    expect(first.summary).toMatchObject({ imported: 1, stockedRows: 1 });
    await expect(call(importer, "confirmCsvImport", { kind: "products", csv, idempotencyKey }))
      .resolves.toMatchObject({ imported: false, summary: { stockedRows: 1 } });
    const products = await adminDb.collection("products").where("normalizedSku", "==", "IMPORTED-STOCK-PANEL").get();
    expect(products.size).toBe(1);
    const entries = await adminDb.collection("inventoryEntries")
      .where("productId", "==", products.docs[0]!.id).get();
    expect(entries.size).toBe(2);
    expect(entries.docs.reduce((sum, entry) => sum + Number(entry.get("quantityDelta")), 0)).toBe(0);
    const balances = await adminDb.collection("inventoryBalances")
      .where("productId", "==", products.docs[0]!.id).get();
    expect(balances.docs.some((balance) => balance.get("onHandQuantity") === 6)).toBe(true);
    const stockTransaction = await adminDb.doc(`inventoryTransactions/${entries.docs[0]!.get("transactionId")}`).get();
    const linkedJournal = await adminDb.doc(`journalEntries/${stockTransaction.get("journalEntryId")}`).get();
    expect(linkedJournal.data()).toMatchObject({ organizationId: importOrganizationId, totalDebitMinor: 75_000_300, totalCreditMinor: 75_000_300, journalType: "inventory_opening_balance" });
  });

  it("creates and concurrently reuses categories entered in the product form", async () => {
    const standalone = await call<{ categoryId: string }>(
      administrator,
      "saveProductCategory",
      {
        name: "Standalone Category",
        active: true,
        idempotencyKey: crypto.randomUUID(),
      },
    );
    const standaloneCategory = await adminDb
      .doc(`productCategories/${standalone.categoryId}`)
      .get();
    expect(standaloneCategory.get("code")).toBe("STANDALONE-CATEGORY");

    const [first, second] = await Promise.all([
      call<{ productId: string }>(
        administrator,
        "saveProduct",
        product({
          name: "Power Cable",
          sku: "POWER-CABLE",
          categoryName: "Power Accessories",
        }),
      ),
      call<{ productId: string }>(
        administrator,
        "saveProduct",
        product({
          name: "Power Connector",
          sku: "POWER-CONNECTOR",
          categoryName: "power accessories",
        }),
      ),
    ]);
    const [firstProduct, secondProduct, categories] = await Promise.all([
      adminDb.doc(`products/${first.productId}`).get(),
      adminDb.doc(`products/${second.productId}`).get(),
      adminDb
        .collection("productCategories")
        .where("organizationId", "==", organizationId)
        .where("code", "==", "POWER-ACCESSORIES")
        .get(),
    ]);

    expect(categories.size).toBe(1);
    expect(firstProduct.get("categoryId")).toBe(categories.docs[0]!.id);
    expect(secondProduct.get("categoryId")).toBe(categories.docs[0]!.id);
    expect(String(categories.docs[0]!.get("name")).toLowerCase()).toBe("power accessories");
    expect(firstProduct.get("categoryName")).toBe(categories.docs[0]!.get("name"));
    expect(secondProduct.get("categoryName")).toBe(categories.docs[0]!.get("name"));
  });

  it("posts opening stock once with balanced immutable entries", async () => {
    const key = crypto.randomUUID();
    const payload = {
      productId,
      destinationLocationId: "location-a",
      quantity: 10,
      unitCostMinor: 10_000,
      serialNumbers: [],
      effectiveAt: "2026-08-01T10:00:00.000Z",
      reason: "Initial verified warehouse balance",
      externalAccount: "migration",
      idempotencyKey: key,
    };
    const first = await call<{
      transactionId: string;
      posted: boolean;
    }>(administrator, "postOpeningStock", payload);
    openingTransactionId = first.transactionId;
    const duplicate = await call<{ posted: boolean }>(
      administrator,
      "postOpeningStock",
      payload,
    );
    expect(first.posted).toBe(true);
    expect(duplicate.posted).toBe(false);
    const entries = await adminDb
      .collection("inventoryEntries")
      .where("transactionId", "==", first.transactionId)
      .get();
    expect(entries.size).toBe(2);
    expect(
      entries.docs.reduce(
        (sum, entry) => sum + Number(entry.get("quantityDelta")),
        0,
      ),
    ).toBe(0);
    expect(
      entries.docs.reduce(
        (sum, entry) => sum + Number(entry.get("valueDeltaMinor")),
        0,
      ),
    ).toBe(0);
    const balances = await adminDb
      .collection("inventoryBalances")
      .where("organizationId", "==", organizationId)
      .where("productId", "==", productId)
      .get();
    expect(balances.docs[0]?.data()).toMatchObject({
      onHandQuantity: 10,
      totalValueMinor: 100_000,
      averageUnitCostMinor: 10_000,
    });
  });

  it("concurrent duplicate stock receipts return one committed ledger reference", async () => {
    const created = await call<{ productId: string }>(administrator, "saveProduct", product({ sku: `REPLAY-${crypto.randomUUID().slice(0, 8)}` }));
    const payload = {
      productId: created.productId, destinationLocationId: "location-a", quantity: 1,
      unitCostMinor: 10_000, serialNumbers: [], effectiveAt: "2026-08-01T10:00:00.000Z",
      reason: "Concurrent receipt replay regression", externalAccount: "supplier",
      idempotencyKey: crypto.randomUUID(),
    };
    const results = await Promise.all([
      call<{ transactionId: string; transactionNumber: string; posted: boolean }>(administrator, "postInventoryReceipt", payload),
      call<{ transactionId: string; transactionNumber: string; posted: boolean }>(administrator, "postInventoryReceipt", payload),
    ]);
    expect(new Set(results.map((result) => result.transactionId)).size).toBe(1);
    expect(new Set(results.map((result) => result.transactionNumber)).size).toBe(1);
    expect(results.filter((result) => result.posted)).toHaveLength(1);
    const movement = await adminDb.doc(`inventoryTransactions/${results[0]!.transactionId}`).get();
    expect(movement.get("status")).toBe("posted");
    const entries = await adminDb.collection("inventoryEntries").where("transactionId", "==", movement.id).get();
    expect(entries.size).toBe(2);
    expect(entries.docs.reduce((sum, entry) => sum + Number(entry.get("quantityDelta")), 0)).toBe(0);
    const balances = await adminDb.collection("inventoryBalances").where("organizationId", "==", organizationId).where("productId", "==", created.productId).get();
    expect(balances.docs[0]?.get("onHandQuantity")).toBe(1);
  });

  it("calculates weighted average and prevents tracking migration after posting", async () => {
    await call(administrator, "postInventoryReceipt", {
      productId,
      destinationLocationId: "location-a",
      quantity: 10,
      unitCostMinor: 20_000,
      serialNumbers: [],
      effectiveAt: "2026-08-02T10:00:00.000Z",
      reason: "Authorized supplier receipt",
      externalAccount: "supplier",
      idempotencyKey: crypto.randomUUID(),
    });
    const balance = (
      await adminDb
        .collection("inventoryBalances")
        .where("organizationId", "==", organizationId)
        .where("productId", "==", productId)
        .where("locationId", "==", "location-a")
        .get()
    ).docs[0]!;
    expect(balance.data()).toMatchObject({
      onHandQuantity: 20,
      totalValueMinor: 300_000,
      averageUnitCostMinor: 15_000,
    });
    await expect(
      call(
        administrator,
        "saveProduct",
        product({ id: productId, trackingType: "serial" }),
      ),
    ).rejects.toMatchObject({ code: "functions/failed-precondition" });
  });

  it("moves quantity and value atomically and concurrent depletion cannot overdraw", async () => {
    const move = (destinationLocationId: string, quantity: number) =>
      call(administrator, "moveInventoryBetweenLocations", {
        productId,
        sourceLocationId: "location-a",
        destinationLocationId,
        quantity,
        serialNumbers: [],
        effectiveAt: new Date().toISOString(),
        reason: "Controlled internal warehouse relocation",
        idempotencyKey: crypto.randomUUID(),
      });
    await move("location-b", 5);
    const before = await adminDb
      .collection("inventoryBalances")
      .where("organizationId", "==", organizationId)
      .where("productId", "==", productId)
      .get();
    expect(
      before.docs.reduce((sum, doc) => sum + doc.get("onHandQuantity"), 0),
    ).toBe(20);
    expect(
      before.docs.reduce((sum, doc) => sum + doc.get("totalValueMinor"), 0),
    ).toBe(300_000);

    const attempts = await Promise.allSettled([
      move("location-b", 10),
      move("location-c", 10),
    ]);
    expect(
      attempts.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      attempts.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const after = await adminDb
      .collection("inventoryBalances")
      .where("organizationId", "==", organizationId)
      .where("productId", "==", productId)
      .get();
    expect(after.docs.every((doc) => doc.get("onHandQuantity") >= 0)).toBe(
      true,
    );
    expect(
      after.docs.reduce((sum, doc) => sum + doc.get("onHandQuantity"), 0),
    ).toBe(20);
    expect(
      after.docs.reduce((sum, doc) => sum + doc.get("totalValueMinor"), 0),
    ).toBe(300_000);
    await expect(move("location-c", 6)).rejects.toMatchObject({
      code: "functions/failed-precondition",
    });
  });

  it("enforces serial uniqueness and exact serialized quantities", async () => {
    const serialProduct = await call<{ productId: string }>(
      administrator,
      "saveProduct",
      product({
        name: "6.2kVA Hybrid Inverter",
        sku: "INV-6200",
        trackingType: "serial",
      }),
    );
    const payload = {
      productId: serialProduct.productId,
      destinationLocationId: "location-a",
      quantity: 2,
      unitCostMinor: 500_000,
      effectiveAt: new Date().toISOString(),
      reason: "Serialized opening stock verification",
      externalAccount: "migration",
      idempotencyKey: crypto.randomUUID(),
    };
    await expect(
      call(administrator, "postOpeningStock", {
        ...payload,
        serialNumbers: ["INV-SN-1"],
      }),
    ).rejects.toMatchObject({ code: "functions/invalid-argument" });
    await call(administrator, "postOpeningStock", {
      ...payload,
      serialNumbers: ["INV-SN-1", "INV-SN-2"],
    });
    await expect(
      call(administrator, "postInventoryReceipt", {
        ...payload,
        externalAccount: "supplier",
        serialNumbers: [" inv-sn-1 ", "INV-SN-3"],
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "functions/already-exists" });
  });

  it("keeps cost data sanitized and paginates movement history without duplicates", async () => {
    const sanitized = await call<{
      includeCosts: boolean;
      product: Record<string, unknown>;
      balances: Record<string, unknown>[];
    }>(branchActor, "getProductStockSummary", {
      productId,
      includeCosts: true,
      limit: 20,
    });
    expect(sanitized.includeCosts).toBe(false);
    expect(sanitized.product.defaultUnitCostMinor).toBeUndefined();
    expect(sanitized.balances).toEqual([]);

    const first = await call<{
      rows: { id: string }[];
      nextCursor: string | null;
    }>(administrator, "getSkuMovementHistory", {
      productId,
      limit: 2,
      includeCosts: true,
    });
    expect(first.rows).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    const second = await call<{ rows: { id: string }[] }>(
      administrator,
      "getSkuMovementHistory",
      {
        productId,
        limit: 2,
        includeCosts: true,
        cursor: first.nextCursor,
      },
    );
    expect(second.rows.map((row) => row.id)).not.toContain(first.rows[0]!.id);
    expect(second.rows.map((row) => row.id)).not.toContain(first.rows[1]!.id);
  });

  it("reconciles only the branch manager's assigned branch and keeps costs hidden", async () => {
    await Promise.all([
      adminDb.doc("inventoryBalances/branch-a-balance").set({
        organizationId,
        productId,
        locationId: "branch-a-location",
        branchId: "branch-a",
        onHandQuantity: 3,
        totalValueMinor: 30_000,
      }),
      adminDb.doc("inventoryBalances/branch-b-balance").set({
        organizationId,
        productId,
        locationId: "branch-b-location",
        branchId: "branch-b",
        onHandQuantity: 9,
        totalValueMinor: 90_000,
      }),
    ]);
    const result = await call<{
      checkedBalances: number;
      discrepancies: Record<string, unknown>[];
    }>(branchActor, "reconcileInventoryBalances", { limit: 20 });
    expect(result.checkedBalances).toBe(1);
    expect(result.discrepancies).toHaveLength(1);
    expect(result.discrepancies[0]).toMatchObject({
      balanceId: "branch-a-balance",
      storedQuantity: 3,
    });
    expect(result.discrepancies[0]).not.toHaveProperty("storedValueMinor");
    expect(result.discrepancies[0]).not.toHaveProperty("ledgerValueMinor");
    await Promise.all([
      adminDb.doc("inventoryBalances/branch-a-balance").delete(),
      adminDb.doc("inventoryBalances/branch-b-balance").delete(),
    ]);
  });

  it("uses blind maker-checker stock counts and posts variance only after review", async () => {
    const countProduct = await call<{ productId: string }>(
      administrator,
      "saveProduct",
      product({ name: "Count Test Breaker", sku: "COUNT-63A" }),
    );
    await call(administrator, "postOpeningStock", {
      productId: countProduct.productId,
      destinationLocationId: "location-d",
      quantity: 5,
      unitCostMinor: 1_000,
      serialNumbers: [],
      effectiveAt: new Date().toISOString(),
      reason: "Count workflow opening balance",
      externalAccount: "migration",
      idempotencyKey: crypto.randomUUID(),
    });
    const officer = await createActor(
      "inventory-counter@example.test",
      "warehouse_officer",
    );
    const poster = await createActor(
      "inventory-poster@example.test",
      "warehouse_manager",
    );
    const created = await call<{ stockCountId: string }>(
      administrator,
      "createStockCount",
      {
        locationId: "location-d",
        assignedUserIds: [officer.auth.currentUser!.uid],
        blindCount: true,
        countDate: "2026-08-06",
        idempotencyKey: crypto.randomUUID(),
      },
    );
    await call(officer, "startStockCount", {
      stockCountId: created.stockCountId,
      reason: "Begin independent blind physical count",
      idempotencyKey: crypto.randomUUID(),
    });
    const blind = await call<{
      items: { id: string; expectedQuantity?: number }[];
    }>(officer, "getStockCountWorkspace", {
      stockCountId: created.stockCountId,
      reason: "Open blind count workspace",
      idempotencyKey: crypto.randomUUID(),
    });
    expect(blind.items).toHaveLength(1);
    expect(blind.items[0]?.expectedQuantity).toBeUndefined();
    await call(officer, "submitStockCount", {
      stockCountId: created.stockCountId,
      reason: "Submit verified physical count",
      idempotencyKey: crypto.randomUUID(),
      items: [
        {
          itemId: blind.items[0]!.id,
          countedQuantity: 4,
          serialNumbers: [],
        },
      ],
    });
    const balanceQuery = () =>
      adminDb
        .collection("inventoryBalances")
        .where("organizationId", "==", organizationId)
        .where("productId", "==", countProduct.productId)
        .where("locationId", "==", "location-d")
        .limit(1)
        .get();
    expect((await balanceQuery()).docs[0]?.get("onHandQuantity")).toBe(5);
    await expect(
      call(administrator, "reviewStockCount", {
        stockCountId: created.stockCountId,
        reason: "Manager-authorized auditable count review",
        idempotencyKey: crypto.randomUUID(),
      }),
    ).resolves.toMatchObject({ reviewed: true });
    expect(
      (await adminDb.doc(`stockCounts/${created.stockCountId}`).get()).get(
        "status",
      ),
    ).toBe("reviewed");
    await call(poster, "postStockCount", {
      stockCountId: created.stockCountId,
      reason: "Independent approved count posting",
      idempotencyKey: crypto.randomUUID(),
    });
    expect((await balanceQuery()).docs[0]?.get("onHandQuantity")).toBe(4);
  });

  it("reverses safely with opposite immutable entries and rejects a second reversal", async () => {
    const original = await adminDb
      .doc(`inventoryTransactions/${openingTransactionId}`)
      .get();
    expect(original.get("status")).toBe("posted");
    await expect(
      call(administrator, "reverseInventoryTransaction", {
        transactionId: openingTransactionId,
        reason: "Attempt unsafe reversal after dependent receipts",
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "functions/failed-precondition" });

    const adjustment = await call<{ transactionId: string }>(
      administrator,
      "postStockAdjustment",
      {
        productId,
        locationId: "location-a",
        direction: "increase",
        adjustmentType: "found_stock",
        quantity: 1,
        unitCostMinor: 15_000,
        serialNumbers: [],
        effectiveAt: new Date().toISOString(),
        reason: "Verified count correction evidence",
        idempotencyKey: crypto.randomUUID(),
      },
    );
    const reversalKey = crypto.randomUUID();
    const reversed = await call<{ transactionId: string }>(
      administrator,
      "reverseInventoryTransaction",
      {
        transactionId: adjustment.transactionId,
        reason: "Correction evidence was invalidated",
        idempotencyKey: reversalKey,
      },
    );
    expect(await call(administrator, "reverseInventoryTransaction", { transactionId: adjustment.transactionId, reason: "Correction evidence was invalidated", idempotencyKey: reversalKey })).toMatchObject({ transactionId: reversed.transactionId, reversed: false });
    await expect(call(administrator, "reverseInventoryTransaction", { transactionId: adjustment.transactionId, reason: "Different reason must not silently replay", idempotencyKey: reversalKey })).rejects.toMatchObject({ code: "functions/already-exists" });
    const reversalEntries = await adminDb
      .collection("inventoryEntries")
      .where("transactionId", "==", reversed.transactionId)
      .get();
    const adjustmentEntries = await adminDb
      .collection("inventoryEntries")
      .where("transactionId", "==", adjustment.transactionId)
      .get();
    expect(reversalEntries.size).toBe(adjustmentEntries.size);
    expect(
      reversalEntries.docs.reduce(
        (sum, doc) => sum + doc.get("quantityDelta"),
        0,
      ),
    ).toBe(0);
    expect(
      (
        await adminDb
          .doc(`inventoryTransactions/${adjustment.transactionId}`)
          .get()
      ).get("status"),
    ).toBe("posted");
    await expect(
      call(administrator, "reverseInventoryTransaction", {
        transactionId: adjustment.transactionId,
        reason: "Second reversal must be rejected",
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "functions/already-exists" });
  });

  it("summarizes all matching stock positions, not only a report page", async () => {
    const balances = await adminDb.collection("inventoryBalances")
      .where("organizationId", "==", organizationId).get();
    const expected = balances.docs.reduce((totals, balance) => ({
      count: totals.count + 1,
      onHandQuantity: totals.onHandQuantity + Number(balance.get("onHandQuantity") ?? 0),
      reservedQuantity: totals.reservedQuantity + Number(balance.get("reservedQuantity") ?? 0),
      availableQuantity: totals.availableQuantity + Number(balance.get("availableQuantity") ?? 0),
      valueMinor: totals.valueMinor + Number(balance.get("totalValueMinor") ?? 0),
    }), { count: 0, onHandQuantity: 0, reservedQuantity: 0, availableQuantity: 0, valueMinor: 0 });
    const report = await call<{
      rows: unknown[];
      summary: typeof expected;
    }>(administrator, "generateInventoryValuationReport", { limit: 1, includeCosts: true });
    expect(report.rows).toHaveLength(1);
    expect(report.summary).toMatchObject(expected);
  });

  it("reconciliation reports a deliberately introduced discrepancy", async () => {
    const healthy = await call<{ discrepancyCount: number }>(
      administrator,
      "reconcileInventoryBalances",
      { productId, limit: 100 },
    );
    expect(healthy.discrepancyCount).toBe(0);
    const balance = (
      await adminDb
        .collection("inventoryBalances")
        .where("organizationId", "==", organizationId)
        .where("productId", "==", productId)
        .limit(1)
        .get()
    ).docs[0]!;
    await balance.ref.update({ onHandQuantity: 999, availableQuantity: 999 });
    const broken = await call<{ discrepancyCount: number }>(
      administrator,
      "reconcileInventoryBalances",
      { productId, limit: 100 },
    );
    expect(broken.discrepancyCount).toBeGreaterThan(0);
  });

  it("posts multi-product documents atomically, with rollback, exact replay and unique sequences", async () => {
    if (!getAdminApps().some((app) => app.name === "[DEFAULT]")) initializeAdminApp({ projectId });
    const { postInventoryTransactionGroup } = await import("../functions/src/inventory/post-inventory-transaction");
    const { db: postingDb } = await import("../functions/src/admin");
    const actor: AccessProfile = { userId: administrator.auth.currentUser!.uid, organizationId,
      roleId: "system_administrator", branchIds: [], warehouseIds: [], authorizationVersion: 1 };
    const ids: string[] = [];
    for (const index of [1, 2]) {
      const created = await call<{ productId: string }>(administrator, "saveProduct", product({ sku: `GROUP-${index}`, name: `Grouped stock ${index}` }));
      ids.push(created.productId);
      await call(administrator, "postOpeningStock", { productId: created.productId, destinationLocationId: "location-b",
        quantity: 8, unitCostMinor: 100, externalAccount: "migration", serialNumbers: [], effectiveAt: new Date().toISOString(),
        reason: "Grouped opening fixture", idempotencyKey: crypto.randomUUID() });
    }
    const inputs: PostingRequest[] = ids.map(id => ({ transactionType: "supplier_return", productId: id, quantity: 2,
      sourceLocationId: "location-b", externalAccount: "supplier:group-fixture", serialNumbers: [], effectiveAt: new Date().toISOString(),
      reason: "Grouped supplier credit regression", idempotencyKey: crypto.randomUUID(), correlationId: "group-regression", sourceFunction: "group-test" }));
    const balances = ids.map(id => postingDb.doc(`inventoryBalances/${balanceDocumentId(organizationId, id, "location-b")}`));
    const originals = await postingDb.getAll(...balances);
    const counter = postingDb.doc(`inventoryCounters/${organizationId}_transactions`);
    const originalCounter = (await counter.get()).data();
    const financial = postingDb.doc("supplierReturnTestControls/group-integration");
    await financial.set({ remainingMinor: 1600 });
    let prepared = 0;
    const extension = (failure?: "prepare" | "apply") => ({
      async prepare(reader: Pick<FirebaseFirestore.Transaction, "get" | "getAll">, movements: readonly { movementValueMinor: number }[]) {
        prepared++;
        expect("create" in reader).toBe(false);
        const current = await reader.get(financial);
        if (failure === "prepare") throw new Error("Grouped financial validation failed");
        return { remainingMinor: Number(current.get("remainingMinor")) - movements.reduce((sum, movement) => sum + movement.movementValueMinor, 0) };
      },
      apply(writer: Pick<FirebaseFirestore.Transaction, "create" | "set" | "update">, state: { remainingMinor: number }, movements: readonly { transactionId: string; movementValueMinor: number }[]) {
        expect("get" in writer).toBe(false);
        writer.update(financial, state);
        writer.create(postingDb.doc(`supplierGroupTestJournals/${movements[0]!.transactionId}`), {
          movements: movements.map(movement => movement.transactionId), totalDebitMinor: 400, totalCreditMinor: 400 });
        if (failure === "apply") throw new Error("Grouped financial posting failed");
        return undefined;
      },
    });
    const document = () => ({ idempotencyKey: crypto.randomUUID(), requestFingerprint: "a".repeat(64) });
    for (const failure of ["prepare", "apply"] as const) {
      const request = document();
      await expect(postInventoryTransactionGroup(actor, request, inputs, extension(failure))).rejects.toThrow("Grouped financial");
      expect((await postingDb.getAll(...balances)).map(snapshot => snapshot.data())).toEqual(originals.map(snapshot => snapshot.data()));
      expect((await counter.get()).data()).toEqual(originalCounter);
      expect((await financial.get()).get("remainingMinor")).toBe(1600);
      expect((await postingDb.doc(`idempotencyKeys/${organizationId}_inventoryPostGroup_${request.idempotencyKey}`).get()).exists).toBe(false);
    }
    const beforeStockFailure = prepared;
    await expect(postInventoryTransactionGroup(actor, document(), [inputs[0]!, { ...inputs[1]!, quantity: 99 }], extension())).rejects.toMatchObject({ code: "failed-precondition" });
    expect(prepared).toBe(beforeStockFailure);
    expect((await postingDb.getAll(...balances)).map(snapshot => snapshot.data())).toEqual(originals.map(snapshot => snapshot.data()));
    const request = document();
    const results = await Promise.all([postInventoryTransactionGroup(actor, request, inputs, extension()), postInventoryTransactionGroup(actor, request, inputs, extension())]);
    expect(results.filter(result => result.posted)).toHaveLength(1);
    expect(results[0]!.movements).toEqual(results[1]!.movements);
    expect(new Set(results[0]!.movements.map(movement => movement.transactionNumber)).size).toBe(2);
    expect((await counter.get()).get("value")).toBe(Number(originalCounter!.value) + 2);
    expect((await postingDb.getAll(...balances)).map(snapshot => snapshot.get("onHandQuantity"))).toEqual([6, 6]);
    expect((await financial.get()).get("remainingMinor")).toBe(1200);
    const beforeReplay = prepared;
    expect((await postInventoryTransactionGroup(actor, request, inputs, extension())).posted).toBe(false);
    expect(prepared).toBe(beforeReplay);
    await expect(postInventoryTransactionGroup(actor, request, [inputs[0]!, { ...inputs[1]!, quantity: 1 }], extension())).rejects.toMatchObject({ code: "already-exists" });
    await expect(postInventoryTransactionGroup(actor, { ...request, requestFingerprint: "b".repeat(64) }, inputs, extension())).rejects.toMatchObject({ code: "already-exists" });
    const mixed = [{ ...inputs[0]!, idempotencyKey: crypto.randomUUID() }, inputs[1]!];
    await expect(postInventoryTransactionGroup(actor, document(), mixed, extension())).rejects.toMatchObject({ code: "failed-precondition" });
    expect((await postingDb.getAll(...balances)).map(snapshot => snapshot.get("onHandQuantity"))).toEqual([6, 6]);
    const journal = await postingDb.doc(`supplierGroupTestJournals/${results[0]!.movements[0]!.transactionId}`).get();
    expect(journal.get("totalDebitMinor")).toBe(journal.get("totalCreditMinor"));
    for (const movement of results[0]!.movements) {
      const entries = await postingDb.collection("inventoryEntries").where("transactionId", "==", movement.transactionId).get();
      expect(entries.size).toBe(2);
      expect(entries.docs.reduce((sum, entry) => sum + Number(entry.get("quantityDelta")), 0)).toBe(0);
    }
  });

  it("commits linked stock and financial writes atomically, including failure and concurrent retries", async () => {
    if (!getAdminApps().some((app) => app.name === "[DEFAULT]")) initializeAdminApp({ projectId });
    const { postInventoryTransaction } = await import("../functions/src/inventory/post-inventory-transaction");
    const { db: postingDb } = await import("../functions/src/admin");
    const actor: AccessProfile = {
      userId: administrator.auth.currentUser!.uid, organizationId,
      roleId: "system_administrator", branchIds: [], warehouseIds: [], authorizationVersion: 1,
    };
    const created = await call<{ productId: string }>(administrator, "saveProduct", product({ sku: "ATOMIC-LINK", name: "Atomic integration fixture" }));
    await call(administrator, "postOpeningStock", {
      productId: created.productId, destinationLocationId: "location-b", quantity: 8,
      unitCostMinor: 100, externalAccount: "migration", serialNumbers: [], effectiveAt: new Date().toISOString(),
      reason: "Atomic test opening", idempotencyKey: crypto.randomUUID(),
    });
    const balance = adminDb.doc(`inventoryBalances/${balanceDocumentId(organizationId, created.productId, "location-b")}`);
    const financial = postingDb.doc("supplierReturnTestControls/atomic-integration");
    await financial.set({ remainingMinor: 800 });
    const request = (key: string): PostingRequest => ({
      transactionType: "stock_adjustment", productId: created.productId, quantity: 2,
      sourceLocationId: "location-b", externalAccount: "adjustment", serialNumbers: [],
      effectiveAt: new Date().toISOString(), reason: "Atomic integration regression",
      idempotencyKey: key, correlationId: key, sourceFunction: "atomic-integration-test",
    });
    let prepared = 0;
    let applied = 0;
    const extension = (failure?: "prepare" | "apply"): InventoryPostingExtension<number> => ({
      async prepare(reader, context) {
        prepared++;
        expect("create" in reader).toBe(false);
        expect(context).toMatchObject({ productId: created.productId, quantity: 2, movementValueMinor: 200, movementUnitCostMinor: 100, sourceLocationId: "location-b", sourceWarehouseId: "warehouse-a" });
        const current = await reader.get(financial);
        if (failure === "prepare") throw new Error("Financial validation rejected");
        return Number(current.get("remainingMinor")) - context.movementValueMinor;
      },
      apply(writer, remainingMinor, context) {
        applied++;
        expect("get" in writer).toBe(false);
        writer.update(financial, { remainingMinor });
        writer.create(postingDb.doc(`supplierReturnTestJournals/${context.transactionId}`), {
          inventoryTransactionId: context.transactionId, transactionNumber: context.transactionNumber,
          totalDebitMinor: context.movementValueMinor, totalCreditMinor: context.movementValueMinor,
        });
        if (failure === "apply") throw new Error("Financial write rejected");
        return undefined;
      },
    });
    const original = await balance.get();
    for (const failure of ["prepare", "apply"] as const) {
      const input = request(crypto.randomUUID());
      await expect(postInventoryTransaction(actor, input, extension(failure))).rejects.toThrow("Financial");
      expect((await balance.get()).data()).toEqual(original.data());
      expect((await financial.get()).get("remainingMinor")).toBe(800);
      expect((await adminDb.doc(`idempotencyKeys/${organizationId}_inventoryPost_${input.idempotencyKey}`).get()).exists).toBe(false);
      expect((await adminDb.collection("supplierReturnTestJournals").get()).empty).toBe(true);
    }
    const input = request(crypto.randomUUID());
    const results = await Promise.all([postInventoryTransaction(actor, input, extension()), postInventoryTransaction(actor, input, extension())]);
    expect(results[0]!.transactionId).toBe(results[1]!.transactionId);
    expect(results.filter((result) => result.posted)).toHaveLength(1);
    expect((await balance.get()).get("onHandQuantity")).toBe(6);
    expect((await financial.get()).get("remainingMinor")).toBe(600);
    const beforeReplay = { prepared, applied };
    await expect(postInventoryTransaction(actor, input, extension())).resolves.toMatchObject({ posted: false, transactionId: results[0]!.transactionId });
    expect({ prepared, applied }).toEqual(beforeReplay);
    const journals = await adminDb.collection("supplierReturnTestJournals").get();
    expect(journals.size).toBe(1);
    expect(journals.docs[0]!.get("totalDebitMinor")).toBe(journals.docs[0]!.get("totalCreditMinor"));
    const entries = await adminDb.collection("inventoryEntries").where("transactionId", "==", results[0]!.transactionId).get();
    expect(entries.size).toBe(2);
    expect(entries.docs.reduce((sum, entry) => sum + Number(entry.get("quantityDelta")), 0)).toBe(0);
    // Stock validation runs before linked business reads/writes.
    const tooMuch = { ...request(crypto.randomUUID()), quantity: 99 };
    await expect(postInventoryTransaction(actor, tooMuch, extension())).rejects.toMatchObject({ code: "failed-precondition" });
    expect({ prepared, applied }).toEqual(beforeReplay);
  });
});
