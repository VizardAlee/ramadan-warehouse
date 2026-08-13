import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { getApps as getAdminApps, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const projectId = "demo-ramadan-warehouse";
const adminApp = getAdminApps().find((app) => app.name === "callable-tests") ?? initializeAdminApp({ projectId }, "callable-tests");
const adminAuth = getAdminAuth(adminApp); const adminDb = getFirestore(adminApp); const apps: FirebaseApp[] = [];

function client(name: string) {
  const app = initializeApp({ projectId, apiKey: "demo", appId: `demo-${name}` }, name); apps.push(app);
  const auth = getAuth(app); connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const functions = getFunctions(app, "us-central1"); connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  return { auth, functions };
}
const organization = { legalName: "Callable Test Solar", code: "CTS", phoneNumbers: [], defaultCurrency: "NGN", timezone: "Africa/Lagos" };

beforeAll(async () => {
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${projectId}/accounts`, { method: "DELETE" });
  await fetch(`http://127.0.0.1:8180/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" });
});
afterAll(async () => Promise.all(apps.map((app) => deleteApp(app))));

describe("administration callables", () => {
  it("rejects unauthenticated bootstrap", async () => {
    const anonymous = client("anonymous");
    await expect(httpsCallable(anonymous.functions, "bootstrapOrganization")({ organization })).rejects.toMatchObject({ code: "functions/unauthenticated" });
  });

  it("allows exactly one concurrent bootstrap and rejects later attempts", async () => {
    const first = client("bootstrap-first"); const second = client("bootstrap-second");
    await createUserWithEmailAndPassword(first.auth, "first@example.test", "Password!234567");
    await createUserWithEmailAndPassword(second.auth, "second@example.test", "Password!234567");
    const attempts = await Promise.allSettled([httpsCallable(first.functions, "bootstrapOrganization")({ organization }), httpsCallable(second.functions, "bootstrapOrganization")({ organization: { ...organization, code: "OTHER" } })]);
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((result) => result.status === "rejected")).toHaveLength(1);
    await expect(httpsCallable(first.functions, "bootstrapOrganization")({ organization })).rejects.toMatchObject({ code: "functions/already-exists" });
    const state = await adminDb.doc("system/bootstrap").get(); expect(state.get("completed")).toBe(true);
  });

  it("provisions idempotently and enforces role and active-state controls", async () => {
    const bootstrap = await adminDb.doc("system/bootstrap").get(); const administratorUid = bootstrap.get("administratorUid") as string;
    const administratorEmail = (await adminAuth.getUser(administratorUid)).email!; const administrator = client("administrator"); await signInWithEmailAndPassword(administrator.auth, administratorEmail, "Password!234567");
    const key = crypto.randomUUID(); const create = httpsCallable(administrator.functions, "createOrganizationUser");
    const payload = { email: "requester@example.test", displayName: "Branch Requester", phoneNumber: "07032545288", roleId: "branch_requester", branchIds: [], warehouseIds: [], status: "active", idempotencyKey: key };
    const initial = await create(payload); const duplicate = await create(payload);
    expect(initial.data).toMatchObject({ created: true, invitationLink: expect.any(String) }); expect((duplicate.data as { created: boolean }).created).toBe(false);
    const invited = client("invited-before-acceptance");
    await expect(signInWithEmailAndPassword(invited.auth, payload.email, "Password!234567")).rejects.toBeDefined();
    const invitedAuthRecord = await adminAuth.getUserByEmail(payload.email);
    expect(invitedAuthRecord.phoneNumber).toBe("+2347032545288");
    expect((await adminDb.doc(`users/${invitedAuthRecord.uid}`).get()).get("phoneNumber")).toBe("07032545288");

    const organizationId = bootstrap.get("organizationId") as string;
    const opsRecord = await adminAuth.createUser({ email: "ops@example.test", password: "Password!234567", displayName: "Operations Admin" });
    await adminDb.doc(`users/${opsRecord.uid}`).set({ uid: opsRecord.uid, organizationId, email: "ops@example.test", displayName: "Operations Admin", roleId: "operations_administrator", branchIds: [], warehouseIds: [], status: "active", authDisabled: false, authorizationVersion: 1, createdAt: FieldValue.serverTimestamp(), createdBy: administratorUid, updatedAt: FieldValue.serverTimestamp(), updatedBy: administratorUid });
    const ops = client("operations"); await signInWithEmailAndPassword(ops.auth, "ops@example.test", "Password!234567");
    await expect(httpsCallable(ops.functions, "createOrganizationUser")({ ...payload, email: "escalation@example.test", roleId: "system_administrator", idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/permission-denied" });
    const requesterRecord = await adminAuth.createUser({ email: "ordinary@example.test", password: "Password!234567", displayName: "Ordinary User" });
    await adminDb.doc(`users/${requesterRecord.uid}`).set({ uid: requesterRecord.uid, organizationId, email: "ordinary@example.test", displayName: "Ordinary User", roleId: "branch_requester", branchIds: [], warehouseIds: [], status: "active", authDisabled: false, authorizationVersion: 1 });
    const requester = client("ordinary"); await signInWithEmailAndPassword(requester.auth, "ordinary@example.test", "Password!234567");
    await expect(httpsCallable(requester.functions, "createOrganizationUser")({ ...payload, email: "unauthorized@example.test", idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/permission-denied" });
    const outsideRecord = await adminAuth.createUser({ email: "outside-invite@example.test", password: "Password!234567" });
    const outside = client("outside-invite"); await signInWithEmailAndPassword(outside.auth, outsideRecord.email!, "Password!234567");
    await expect(httpsCallable(outside.functions, "getMyAccessContext")({})).rejects.toMatchObject({ code: "functions/permission-denied" });
    await adminDb.doc(`users/${opsRecord.uid}`).update({ status: "inactive", authDisabled: true });
    await expect(httpsCallable(ops.functions, "getMyAccessContext")({})).rejects.toMatchObject({ code: "functions/permission-denied" });
  });

  it("saves master data idempotently", async () => {
    const state = await adminDb.doc("system/bootstrap").get(); const administratorUid = state.get("administratorUid") as string;
    const administratorEmail = (await adminAuth.getUser(administratorUid)).email!; const administrator = client("master-administrator"); await signInWithEmailAndPassword(administrator.auth, administratorEmail, "Password!234567");
    const save = httpsCallable(administrator.functions, "saveBranch"); const idempotencyKey = crypto.randomUUID();
    const payload = { name: "Lagos Branch", code: "lag", contactEmail: "", managerUserId: "", status: "active", idempotencyKey };
    const first = await save(payload); const duplicate = await save(payload);
    expect(first.data).toMatchObject({ saved: true }); expect(duplicate.data).toMatchObject({ saved: false, id: (first.data as { id: string }).id });
    const saved = await adminDb.doc(`branches/${(first.data as { id: string }).id}`).get();
    expect(saved.data()).toMatchObject({ name: "Lagos Branch", code: "LAG" });
    expect(saved.data()).not.toHaveProperty("contactEmail");
    expect(saved.data()).not.toHaveProperty("managerUserId");

    const warehouse = httpsCallable(administrator.functions, "saveWarehouse");
    const warehouseResult = await warehouse({ name: "Central Warehouse", code: "central", managerIds: [], status: "active", idempotencyKey: crypto.randomUUID() });
    const savedWarehouse = await adminDb.doc(`warehouses/${(warehouseResult.data as { id: string }).id}`).get();
    expect(savedWarehouse.data()).toMatchObject({ name: "Central Warehouse", code: "CENTRAL", managerIds: [] });
  });

  it("protects organization scope and the final active administrator", async () => {
    const state = await adminDb.doc("system/bootstrap").get(); const organizationId = state.get("organizationId") as string; const originalUid = state.get("administratorUid") as string;
    const secondAdmin = await adminAuth.createUser({ email: "second-admin@example.test", password: "Password!234567", displayName: "Second Admin" });
    await adminDb.doc(`users/${secondAdmin.uid}`).set({ uid: secondAdmin.uid, organizationId, email: "second-admin@example.test", displayName: "Second Admin", roleId: "system_administrator", branchIds: [], warehouseIds: [], status: "active", authDisabled: false, authorizationVersion: 1, createdAt: FieldValue.serverTimestamp(), createdBy: originalUid, updatedAt: FieldValue.serverTimestamp(), updatedBy: originalUid });
    const actor = client("second-admin"); await signInWithEmailAndPassword(actor.auth, "second-admin@example.test", "Password!234567"); const update = httpsCallable(actor.functions, "updateOrganizationUser");
    await update({ userId: originalUid, status: "inactive", reason: "Administrator rotation test", idempotencyKey: crypto.randomUUID() });
    await expect(update({ userId: originalUid, roleId: "auditor", reason: "Attempt to remove final admin", idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    const foreign = await adminAuth.createUser({ email: "foreign@example.test", password: "Password!234567" }); await adminDb.doc(`users/${foreign.uid}`).set({ uid: foreign.uid, organizationId: "foreign-org", email: "foreign@example.test", displayName: "Foreign", roleId: "auditor", branchIds: [], warehouseIds: [], status: "active", authDisabled: false, authorizationVersion: 1 });
    await expect(update({ userId: foreign.uid, displayName: "Changed", reason: "Cross organization test", idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/permission-denied" });
  });
});
