import { randomUUID } from "node:crypto";
import { getApps, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { initializeApp, deleteApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import type { SupportRequest } from "../functions/src/support/gateway";

const projectId = process.env.TEST_FIREBASE_PROJECT_ID ?? "demo-ramadan-warehouse";
if (!projectId.startsWith("demo-") || !/^127\.0\.0\.1:/.test(process.env.FIRESTORE_EMULATOR_HOST ?? "") || !/^127\.0\.0\.1:/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "")) throw Error("Support SDK tests require owned local demo Auth/Firestore emulators.");
const adminApp = getApps().find(a => a.name === "support-sdk-tests") ?? initializeAdminApp({ projectId }, "support-sdk-tests");
const db = getFirestore(adminApp), auth = getAdminAuth(adminApp), org = "support-sdk-org", apps: FirebaseApp[] = [];
let execute: typeof import("../functions/src/support/api")["executeSupport"];
let deliver: typeof import("../functions/src/support/store")["deliverSupportNotification"];
type Client = { uid: string; request(data: Record<string, unknown>): Promise<unknown> };
let owner: Client, other: Client, administrator: Client, custom: Client, foreign: Client, savedId: string;
async function user(name: string, options: { role?: string; direct?: string[]; organization?: string } = {}): Promise<Client> {
  const role = options.role ?? "sales_cashier", email = `${name}@support-sdk.example.invalid`, password = "Synthetic-only-234567!";
  const record = await auth.createUser({ email, password });
  await db.doc("users/" + record.uid).set({ organizationId: options.organization ?? org, displayName: name, status: "active", roleId: role, roleIds: [role], directRoleIds: options.direct ?? [role], branchIds: ["support-sdk-one", "support-sdk-two"], warehouseIds: [], authorizationVersion: 1 });
  const app = initializeApp({ projectId, apiKey: "demo", appId: "demo-support-sdk" }, "support-sdk-" + name); apps.push(app);
  const clientAuth = getAuth(app); connectAuthEmulator(clientAuth, "http://" + process.env.FIREBASE_AUTH_EMULATOR_HOST, { disableWarnings: true });
  await signInWithEmailAndPassword(clientAuth, email, password);
  return { uid: record.uid, async request(data) {
    const jwt = await clientAuth.currentUser!.getIdToken(), token = await auth.verifyIdToken(jwt);
    return execute({ auth: { uid: record.uid, token }, data: { operatingContext: { type: "branch", id: "support-sdk-one" }, ...data } });
  } };
}
const report = () => ({ requestId: randomUUID(), kind: "help", description: "Synthetic SDK support report", privacyConfirmed: true, context: { screen: "/pos", build: "emulator-sdk" } });
beforeAll(async () => {
  // Only after the demo-only guard: backend Admin SDK modules connect to these emulators.
  process.env.GCLOUD_PROJECT = projectId;
  execute = (await import("../functions/src/support/api")).executeSupport;
  deliver = (await import("../functions/src/support/store")).deliverSupportNotification;
  await db.doc("organizations/" + org).set({ status: "active" });
  await db.doc("organizations/support-sdk-foreign").set({ status: "active" });
  for (const id of ["support-sdk-one", "support-sdk-two"]) await db.doc("branches/" + id).set({ organizationId: org, status: "active", name: id });
  await db.doc("sales/support-sdk-business-sentinel").set({ organizationId: org, status: "completed", totalMinor: 12500 });
  owner = await user("owner"); other = await user("other"); administrator = await user("admin", { role: "system_administrator" }); custom = await user("custom", { role: "system_administrator", direct: [] }); foreign = await user("foreign", { organization: "support-sdk-foreign" });
}, 120000);
afterAll(async () => { await Promise.all(apps.map(deleteApp)); });

describe("real Auth/Firestore SDK private support (Gateway verification tested separately)", () => {
  it("deduplicates concurrent transactions and returns private saved receipt/history", async () => {
    const input = report(), [a,b] = await Promise.all([owner.request({ action: "create", report: input }), owner.request({ action: "create", report: input })]) as { id: string; notification: string }[];
    expect(a!.id).toBe(b!.id); expect(a!.notification).toBe("pending"); savedId = a!.id;
    expect((await db.collection(`supportOrganizations/${org}/tickets`).get()).size).toBe(1);
    expect(await owner.request({ action: "list" })).toMatchObject({ canAdmin: false, tickets: [{ id: savedId }] });
    await expect(owner.request({ action: "create", report: { ...input, description: "Changed content on same request" } })).rejects.toMatchObject({ code: "already-exists" });
  });
  it("enforces owner, organization, direct administrator and selected-branch boundaries", async () => {
    await expect(other.request({ action: "get", id: savedId })).rejects.toMatchObject({ code: "not-found" });
    await expect(foreign.request({ action: "get", id: savedId })).rejects.toMatchObject({ code: "permission-denied" });
    await expect(custom.request({ action: "list", all: true })).rejects.toMatchObject({ code: "permission-denied" });
    await expect(administrator.request({ action: "get", id: savedId, operatingContext: { type: "branch", id: "support-sdk-two" } })).rejects.toMatchObject({ code: "not-found" });
    expect(await administrator.request({ action: "get", id: savedId, operatingContext: null })).toMatchObject({ id: savedId, submittedByUid: owner.uid });
    await expect(execute({ auth: undefined, data: { action: "list" } } as unknown as SupportRequest)).rejects.toMatchObject({ code: "unauthenticated" });
  });
  it("performs one conflicting status transition and preserves business data", async () => {
    await expect(owner.request({ action: "status", id: savedId, status: "resolved", revision: 1 })).rejects.toMatchObject({ code: "permission-denied" });
    const results = await Promise.allSettled([administrator.request({ action: "status", id: savedId, status: "in_progress", revision: 1 }), administrator.request({ action: "status", id: savedId, status: "resolved", revision: 1 })]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect((await db.doc(`supportOrganizations/${org}/tickets/${savedId}`).get()).get("revision")).toBe(2);
    expect((await db.doc("sales/support-sdk-business-sentinel").get()).data()).toEqual({ organizationId: org, status: "completed", totalMinor: 12500 });
  });
  it("claims only once across real transaction retries with an injected SMTP mock", async () => {
    const send = vi.fn(async () => ({ accepted: true as const, providerReference: "synthetic-sdk-only" }));
    await Promise.all([deliver(db, savedId, { send }), deliver(db, savedId, { send })]); expect(send).toHaveBeenCalledOnce();
    expect((await db.doc("supportMailOutbox/" + savedId).get()).get("state")).toBe("sent");
  });
  it("revalidates disabled profiles before further access", async () => {
    await db.doc("users/" + owner.uid).update({ authDisabled: true });
    await expect(owner.request({ action: "get", id: savedId })).rejects.toMatchObject({ code: "permission-denied" });
  });
});
