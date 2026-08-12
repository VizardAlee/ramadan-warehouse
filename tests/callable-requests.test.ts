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

const projectId = "demo-ramadan-warehouse";
const adminApp =
  getAdminApps().find((app) => app.name === "request-callable-tests") ??
  initializeAdminApp({ projectId }, "request-callable-tests");
const adminAuth = getAdminAuth(adminApp);
const adminDb = getFirestore(adminApp);
const apps: FirebaseApp[] = [];
const organizationId = "request-test-org";
function client(name: string) {
  const app = initializeApp(
    { projectId, apiKey: "demo", appId: `requests-${name}` },
    `requests-${name}`,
  );
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const functions = getFunctions(app, "us-central1");
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  return { auth, functions };
}
async function call<T = Record<string, unknown>>(
  target: ReturnType<typeof client>,
  name: string,
  data: Record<string, unknown>,
) {
  return (await httpsCallable(target.functions, name)(data)).data as T;
}
async function actor(
  email: string,
  roleId: string,
  branchIds: string[] = [],
  actorOrganizationId = organizationId,
  status = "active",
) {
  const user = await adminAuth.createUser({
    email,
    password: "Password!234567",
    displayName: roleId,
  });
  await adminDb
    .doc(`users/${user.uid}`)
    .set({
      uid: user.uid,
      organizationId: actorOrganizationId,
      email,
      displayName: roleId,
      roleId,
      branchIds,
      warehouseIds: roleId === "warehouse_manager" ? ["warehouse-a"] : [],
      status,
      authDisabled: false,
      authorizationVersion: 1,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  const result = client(email.replaceAll(/[^a-z]/g, "-"));
  await signInWithEmailAndPassword(result.auth, email, "Password!234567");
  return { ...result, uid: user.uid };
}
const payload = (
  branchId = "branch-a",
  items: Record<string, unknown>[] = [
    { productId: "product-a", requestedQuantity: 10 },
  ],
) => ({
  branchId,
  requestType: "stock_replenishment",
  priority: "normal",
  purpose: "Restock branch installation inventory",
  attachmentMetadata: [],
  items,
  idempotencyKey: crypto.randomUUID(),
});
let requester: Awaited<ReturnType<typeof actor>>;
let otherBranch: Awaited<ReturnType<typeof actor>>;
let operations: Awaited<ReturnType<typeof actor>>;
let warehouse: Awaited<ReturnType<typeof actor>>;
let requestId = "";

beforeAll(async () => {
  await fetch(
    `http://127.0.0.1:9099/emulator/v1/projects/${projectId}/accounts`,
    { method: "DELETE" },
  );
  await fetch(
    `http://127.0.0.1:8180/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  await Promise.all([
    adminDb
      .doc("branches/branch-a")
      .set({ organizationId, name: "Kaduna", code: "KD", status: "active" }),
    adminDb
      .doc("branches/branch-b")
      .set({ organizationId, name: "Kano", code: "KN", status: "active" }),
    adminDb
      .doc("products/product-a")
      .set({
        organizationId,
        name: "Solar Panel",
        sku: "PV-580",
        unitOfMeasure: "unit",
        trackingType: "quantity",
        categoryId: "solar",
        active: true,
      }),
    adminDb
      .doc("products/product-b")
      .set({
        organizationId,
        name: "Inverter",
        sku: "INV-62",
        unitOfMeasure: "unit",
        trackingType: "serial",
        active: true,
      }),
    adminDb
      .doc("products/inactive")
      .set({
        organizationId,
        name: "Inactive",
        sku: "OFF",
        unitOfMeasure: "unit",
        trackingType: "quantity",
        active: false,
      }),
    adminDb
      .doc("inventoryBalances/balance-a")
      .set({
        organizationId,
        productId: "product-a",
        sku: "PV-580",
        locationId: "location-a",
        warehouseId: "warehouse-a",
        locationType: "warehouse",
        onHandQuantity: 50,
        reservedQuantity: 0,
        availableQuantity: 50,
        totalValueMinor: 500_000,
        lastMovementAt: FieldValue.serverTimestamp(),
      }),
  ]);
  requester = await actor("requester-a@example.test", "branch_requester", [
    "branch-a",
  ]);
  otherBranch = await actor("requester-b@example.test", "branch_requester", [
    "branch-b",
  ]);
  operations = await actor(
    "operations-requests@example.test",
    "operations_administrator",
  );
  warehouse = await actor(
    "warehouse-requests@example.test",
    "warehouse_manager",
  );
});
afterAll(async () => Promise.all(apps.map((app) => deleteApp(app))));

describe.sequential("branch request callables", () => {
  it("enforces authentication, branch assignment, active products, quantities, and duplicate lines", async () => {
    const anonymous = client("requests-anonymous");
    await expect(
      call(anonymous, "createBranchRequest", payload()),
    ).rejects.toMatchObject({ code: "functions/unauthenticated" });
    await expect(
      call(requester, "createBranchRequest", payload("branch-b")),
    ).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(
      call(
        requester,
        "createBranchRequest",
        payload("branch-a", [{ productId: "inactive", requestedQuantity: 1 }]),
      ),
    ).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await expect(
      call(
        requester,
        "createBranchRequest",
        payload("branch-a", [{ productId: "product-a", requestedQuantity: 0 }]),
      ),
    ).rejects.toMatchObject({ code: "functions/invalid-argument" });
    await expect(
      call(
        requester,
        "createBranchRequest",
        payload("branch-a", [
          { productId: "product-a", requestedQuantity: 1 },
          { productId: "product-a", requestedQuantity: 2 },
        ]),
      ),
    ).rejects.toMatchObject({ code: "functions/invalid-argument" });
  });
  it("generates unique request numbers under concurrent creation", async () => {
    const [first, second] = await Promise.all([
      call<{ requestId: string }>(requester, "createBranchRequest", payload()),
      call<{ requestId: string }>(requester, "createBranchRequest", payload()),
    ]);
    const records = await adminDb.getAll(
      adminDb.doc(`branchRequests/${first.requestId}`),
      adminDb.doc(`branchRequests/${second.requestId}`),
    );
    expect(records[0]!.get("requestNumber")).not.toBe(
      records[1]!.get("requestNumber"),
    );
    requestId = first.requestId;
  });
  it("edits drafts, rejects empty submission, submits idempotently, and snapshots an immutable version", async () => {
    await call(requester, "updateBranchRequestDraft", {
      ...payload("branch-a", [
        { productId: "product-a", requestedQuantity: 12 },
        { productId: "product-b", requestedQuantity: 2 },
      ]),
      requestId,
      expectedVersion: 0,
    });
    const empty = await call<{ requestId: string }>(
      requester,
      "createBranchRequest",
      payload("branch-a", []),
    );
    await expect(
      call(requester, "submitBranchRequest", {
        requestId: empty.requestId,
        expectedVersion: 0,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "functions/failed-precondition" });
    const key = crypto.randomUUID();
    const submit = { requestId, expectedVersion: 0, idempotencyKey: key };
    await call(requester, "submitBranchRequest", submit);
    await call(requester, "submitBranchRequest", submit);
    const [versions, submittedEvents] = await Promise.all([
      adminDb
        .collection("branchRequestVersions")
        .where("requestId", "==", requestId)
        .get(),
      adminDb
        .collection("branchRequestEvents")
        .where("requestId", "==", requestId)
        .where("eventType", "==", "submitted")
        .get(),
    ]);
    expect(versions.size).toBe(1);
    expect(submittedEvents.size).toBe(1);
    await expect(
      call(requester, "updateBranchRequestDraft", {
        ...payload(),
        requestId,
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "functions/failed-precondition" });
  });
  it("isolates branch and organization reads and prevents self approval", async () => {
    await expect(
      call(otherBranch, "getBranchRequest", { requestId, limit: 20 }),
    ).rejects.toMatchObject({ code: "functions/permission-denied" });
    const foreign = await actor(
      "foreign-reviewer@example.test",
      "operations_administrator",
      [],
      "foreign-org",
    );
    await expect(
      call(foreign, "getBranchRequest", { requestId, limit: 20 }),
    ).rejects.toMatchObject({ code: "functions/not-found" });
    const own = await call<{ requestId: string }>(
      operations,
      "createBranchRequest",
      payload(),
    );
    await call(operations, "submitBranchRequest", {
      requestId: own.requestId,
      expectedVersion: 0,
      idempotencyKey: crypto.randomUUID(),
    });
    const ownDetails = await call<{
      items: { id: string; requestedQuantity: number }[];
    }>(operations, "getBranchRequest", { requestId: own.requestId, limit: 20 });
    await expect(
      call(operations, "decideBranchRequest", {
        requestId: own.requestId,
        expectedVersion: 1,
        decisions: ownDetails.items.map((item) => ({
          requestItemId: item.id,
          approvedQuantity: item.requestedQuantity,
          rejectedQuantity: 0,
        })),
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "functions/permission-denied" });
  });
  it("supports changes, resubmission, and rejects approval of an old version", async () => {
    await call(operations, "startBranchRequestReview", {
      requestId,
      expectedVersion: 1,
      idempotencyKey: crypto.randomUUID(),
    });
    await call(operations, "requestBranchRequestChanges", {
      requestId,
      expectedVersion: 1,
      reason: "Clarify the installation requirement",
      idempotencyKey: crypto.randomUUID(),
    });
    await call(requester, "updateBranchRequestDraft", {
      ...payload("branch-a", [
        { productId: "product-a", requestedQuantity: 8 },
        { productId: "product-b", requestedQuantity: 2 },
      ]),
      requestId,
      expectedVersion: 1,
    });
    await call(requester, "submitBranchRequest", {
      requestId,
      expectedVersion: 1,
      idempotencyKey: crypto.randomUUID(),
    });
    const details = await call<{
      items: { id: string; requestedQuantity: number }[];
    }>(operations, "getBranchRequest", { requestId, limit: 20 });
    await expect(
      call(operations, "decideBranchRequest", {
        requestId,
        expectedVersion: 1,
        decisions: details.items.map((item) => ({
          requestItemId: item.id,
          approvedQuantity: item.requestedQuantity,
          rejectedQuantity: 0,
        })),
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect(
      (
        await adminDb
          .collection("branchRequestVersions")
          .where("requestId", "==", requestId)
          .get()
      ).size,
    ).toBe(2);
  });
  it("partially approves complete item decisions without changing inventory", async () => {
    const beforeBalances = await adminDb.collection("inventoryBalances").get();
    const beforeEntries = await adminDb.collection("inventoryEntries").get();
    const details = await call<{
      items: { id: string; productId: string; requestedQuantity: number }[];
    }>(operations, "getBranchRequest", { requestId, limit: 20 });
    const decisions = details.items.map((item) => ({
      requestItemId: item.id,
      approvedQuantity:
        item.productId === "product-a" ? 5 : item.requestedQuantity,
      rejectedQuantity:
        item.productId === "product-a" ? item.requestedQuantity - 5 : 0,
    }));
    await call(operations, "decideBranchRequest", {
      requestId,
      expectedVersion: 2,
      decisions,
      reason: "Partial allocation against current demand",
      idempotencyKey: crypto.randomUUID(),
    });
    const record = await adminDb.doc(`branchRequests/${requestId}`).get();
    expect(record.data()).toMatchObject({
      status: "partially_approved",
      totalRequestedQuantity: 10,
      totalApprovedQuantity: 7,
      totalRejectedQuantity: 3,
      totalFulfilledQuantity: 0,
      totalOutstandingQuantity: 7,
    });
    expect((await adminDb.collection("inventoryBalances").get()).size).toBe(
      beforeBalances.size,
    );
    expect((await adminDb.collection("inventoryEntries").get()).size).toBe(
      beforeEntries.size,
    );
    await expect(
      call(operations, "decideBranchRequest", {
        requestId,
        expectedVersion: 2,
        decisions,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "functions/failed-precondition" });
  });
  it("returns informational availability without reservations and filters costs", async () => {
    const before = (
      await adminDb.doc("inventoryBalances/balance-a").get()
    ).data();
    const hidden = await call<{
      includeCosts: boolean;
      rows: Record<string, unknown>[];
    }>(operations, "getBranchRequestAvailability", {
      requestId,
      includeCosts: true,
      limit: 20,
    });
    const visible = await call<{
      includeCosts: boolean;
      rows: Record<string, unknown>[];
    }>(warehouse, "getBranchRequestAvailability", {
      requestId,
      includeCosts: true,
      limit: 20,
    });
    expect(hidden.includeCosts).toBe(false);
    expect(hidden.rows[0]).not.toHaveProperty("estimatedValueMinor");
    expect(visible.includeCosts).toBe(true);
    expect(
      (await adminDb.doc("inventoryBalances/balance-a").get()).data(),
    ).toEqual(before);
  });
  it("cancels while preserving versions, events, approvals, and zero fulfilment", async () => {
    await call(operations, "cancelBranchRequest", {
      requestId,
      expectedVersion: 2,
      reason: "Project demand was withdrawn",
      idempotencyKey: crypto.randomUUID(),
    });
    const record = await adminDb.doc(`branchRequests/${requestId}`).get();
    expect(record.data()).toMatchObject({
      status: "cancelled",
      totalFulfilledQuantity: 0,
      totalOutstandingQuantity: 0,
    });
    expect(
      (
        await adminDb
          .collection("branchRequestVersions")
          .where("requestId", "==", requestId)
          .get()
      ).size,
    ).toBe(2);
    expect(
      (
        await adminDb
          .collection("branchRequestApprovals")
          .where("requestId", "==", requestId)
          .get()
      ).size,
    ).toBeGreaterThan(0);
    expect(
      (
        await adminDb
          .collection("branchRequestEvents")
          .where("requestId", "==", requestId)
          .get()
      ).size,
    ).toBeGreaterThan(4);
  });
});
