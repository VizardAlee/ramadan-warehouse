import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { getApps, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const projectId = "demo-ramadan-warehouse";
const adminApp = getApps().find((app) => app.name === "reset-tests") ?? initializeAdminApp({ projectId }, "reset-tests");
const adminAuth = getAdminAuth(adminApp);
const db = getFirestore(adminApp);
const apps: FirebaseApp[] = [];
function client(name: string) {
  const app = initializeApp({ projectId, apiKey: "demo", appId: `demo-${name}` }, name);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const functions = getFunctions(app, "us-central1");
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  return { auth, functions };
}

beforeAll(async () => {
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${projectId}/accounts`, { method: "DELETE" });
  await fetch(`http://127.0.0.1:8180/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" });
});
afterAll(async () => Promise.all(apps.map((app) => deleteApp(app))));

describe("organization start-fresh reset", () => {
  it("archives operational data, deactivates users, and keeps the initiating administrator", async () => {
    const owner = client("reset-owner");
    await createUserWithEmailAndPassword(owner.auth, "reset-owner@example.test", "Password!234567");
    const bootstrap = await httpsCallable(owner.functions, "bootstrapOrganization")({ organization: {
      legalName: "Reset Test Ltd", code: "RST", phoneNumbers: [], defaultCurrency: "NGN", timezone: "Africa/Lagos",
    } });
    const oldId = (bootstrap.data as { organizationId: string }).organizationId;
    const staff = await adminAuth.createUser({ email: "reset-staff@example.test", password: "Password!234567" });
    await db.doc(`users/${staff.uid}`).set({ uid: staff.uid, organizationId: oldId, email: staff.email,
      displayName: "Staff", roleId: "sales_cashier", roleIds: ["sales_cashier"], branchIds: ["old-branch"], warehouseIds: [],
      status: "active", authDisabled: false, authorizationVersion: 1 });
    await db.doc("branches/old-branch").set({ organizationId: oldId, name: "Old Store", code: "OLD", status: "active" });
    await db.doc("products/old-product").set({ organizationId: oldId, name: "Old Product", sku: "OLD-1" });
    await db.doc("sales/old-sale").set({ organizationId: oldId, saleNumber: "OLD-SALE" });
    await db.doc("inventoryEntries/old-entry").set({ organizationId: oldId, quantityDelta: 1 });
    const staffClient = client("reset-staff");
    await createUserWithEmailAndPassword(staffClient.auth, "unauthorized-reset@example.test", "Password!234567");
    const unauthorizedProfile = db.doc(`users/${staffClient.auth.currentUser!.uid}`);
    await unauthorizedProfile.set({ uid: staffClient.auth.currentUser!.uid, organizationId: oldId,
      email: "unauthorized-reset@example.test", roleId: "sales_cashier", branchIds: [], warehouseIds: [],
      status: "active", authDisabled: false, authorizationVersion: 1 });
    await expect(httpsCallable(staffClient.functions, "previewOrganizationReset")({})).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(httpsCallable(staffClient.functions, "resetOrganizationData")({
      confirmation: "RESET RST", reason: "Unauthorized reset attempt", idempotencyKey: crypto.randomUUID(),
    })).rejects.toMatchObject({ code: "functions/permission-denied" });

    const preview = await httpsCallable(owner.functions, "previewOrganizationReset")({});
    expect(preview.data).toMatchObject({ organizationId: oldId, code: "RST", products: 1, sales: 1, usersToDeactivate: 2 });
    const reset = httpsCallable(owner.functions, "resetOrganizationData");
    const key = crypto.randomUUID();
    const payload = { confirmation: "RESET RST", reason: "Fresh business opening period", idempotencyKey: key };
    await expect(reset({ ...payload, confirmation: "RESET OTHER" })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    const response = await reset(payload);
    const newId = (response.data as { activeOrganizationId: string }).activeOrganizationId;
    expect(newId).not.toBe(oldId);
    expect(response.data).toMatchObject({ completed: true, archivedOrganizationId: oldId, deactivatedUsers: 2 });
    expect((await db.doc(`organizations/${oldId}`).get()).get("status")).toBe("archived");
    expect((await db.doc(`organizations/${newId}`).get()).get("status")).toBe("active");
    expect((await db.doc("sales/old-sale").get()).get("organizationId")).toBe(oldId);
    expect((await db.doc("inventoryEntries/old-entry").get()).get("organizationId")).toBe(oldId);
    expect((await db.collection("products").where("organizationId", "==", newId).count().get()).data().count).toBe(0);
    expect((await db.doc(`users/${staff.uid}`).get()).data()).toMatchObject({ organizationId: newId, status: "inactive", authDisabled: true, branchIds: [] });
    expect((await adminAuth.getUser(staff.uid)).disabled).toBe(true);
    expect((await db.doc(`users/${owner.auth.currentUser!.uid}`).get()).data()).toMatchObject({ organizationId: newId, status: "active" });
    expect((await db.doc(`organizationResets/${key}/deactivatedUsers/${staff.uid}`).get()).get("originalBranchIds")).toEqual(["old-branch"]);
    expect((await db.doc("system/bootstrap").get()).get("organizationId")).toBe(newId);
    await expect(reset(payload)).resolves.toMatchObject({ data: { completed: true, activeOrganizationId: newId } });
    await owner.auth.currentUser!.getIdToken(true);
    await httpsCallable(owner.functions, "updateOrganizationUser")({ userId: staff.uid, status: "active",
      branchIds: [], warehouseIds: [], reason: "Reactivated after fresh organization setup", idempotencyKey: crypto.randomUUID() });
    expect((await db.doc(`users/${staff.uid}`).get()).get("status")).toBe("active");
    expect((await adminAuth.getUser(staff.uid)).disabled).toBe(false);
  });
});
