import { createHash } from "node:crypto";
import { initializeApp, deleteApp, type FirebaseApp } from "firebase/app";
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
import { getApps, initializeApp as adminApp } from "firebase-admin/app";
import { getAuth as adminAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
const projectId = process.env.TEST_FIREBASE_PROJECT_ID ?? "demo-ramadan-warehouse";
if (!projectId.startsWith("demo-") || !/^127\.0\.0\.1:/.test(process.env.FIRESTORE_EMULATOR_HOST ?? "") || !/^127\.0\.0\.1:/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "")) throw Error("User activity tests require owned local demo emulators.");
const admin = getApps().find(app => app.name === "activity-sdk-tests") ?? adminApp({ projectId }, "activity-sdk-tests"), db = getFirestore(admin), auth = adminAuth(admin);
const org = "activity-sdk-org", other = "activity-sdk-other", apps: FirebaseApp[] = [];
function client(name: string) {
  const app = initializeApp({ projectId, apiKey: "demo", appId: "demo-activity" }, `activity-${name}`); apps.push(app);
  const a = getAuth(app); connectAuthEmulator(a, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  const f = getFunctions(app, "us-central1"); connectFunctionsEmulator(f, "127.0.0.1", Number(process.env.TEST_FUNCTIONS_PORT ?? 5001)); return { a, f };
}
type Client = ReturnType<typeof client>;
async function actor(name: string, extra: Record<string, unknown> = {}) {
  const email = `${name}@activity.example.invalid`, password = "Synthetic-only-234567!", user = await auth.createUser({ email, password });
  await db.doc(`users/${user.uid}`).set({ organizationId: org, displayName: name, roleId: "auditor", roleIds: ["auditor"], branchIds: ["a"], warehouseIds: [], status: "active", authDisabled: false, authorizationVersion: 1, ...extra });
  const c = client(name); await signInWithEmailAndPassword(c.a, email, password); return { ...c, uid: user.uid };
}
const filters = { fromDate: "2026-10-01", toDate: "2026-10-02" };
const call = async (c: Client, data: Record<string, unknown> = {}, name = "getUserActivity") => (await httpsCallable<Record<string, unknown>, { rows: Array<Record<string, unknown>>; nextCursor: string | null; scanned: number }>(c.f, name)({ ...filters, ...data })).data;
let auditor: Awaited<ReturnType<typeof actor>>, legacy: Awaited<ReturnType<typeof actor>>, adminDenied: Awaited<ReturnType<typeof actor>>, operations: Awaited<ReturnType<typeof actor>>, malformed: Awaited<ReturnType<typeof actor>>, custom: Awaited<ReturnType<typeof actor>>, foreign: Awaited<ReturnType<typeof actor>>, cashier: Awaited<ReturnType<typeof actor>>, billReader: Awaited<ReturnType<typeof actor>>, beforeHash = "";
async function historyHash() { const data = await db.collection("auditLogs").where("organizationId", "==", org).get(); return createHash("sha256").update(JSON.stringify(data.docs.map(doc => [doc.id, doc.data()]).sort())).digest("hex"); }
beforeAll(async () => {
  await db.doc(`organizations/${org}`).set({ status: "active" }); await db.doc(`organizations/${other}`).set({ status: "active" });
  auditor = await actor("auditor"); legacy = await actor("legacy"); await db.doc(`users/${legacy.uid}`).update({ roleIds: (await import("firebase-admin/firestore")).FieldValue.delete() });
  adminDenied = await actor("admin-denied", { roleId: "system_administrator", roleIds: ["system_administrator"], effectivePermissions: [] });
  operations = await actor("operations", { roleId: "operations_administrator", roleIds: ["operations_administrator"], effectivePermissions: ["audit.read"] });
  malformed = await actor("malformed", { roleIds: null });
  custom = await actor("custom", { customRoleIds: ["custom-auditor"], directRoleIds: [], effectivePermissions: ["audit.read"] });
  foreign = await actor("foreign", { organizationId: other }); cashier = await actor("cashier", { roleId: "sales_cashier", roleIds: ["sales_cashier"], effectivePermissions: ["sales.read.own_branch"] });
  billReader = await actor("bill-reader", { roleId: "branch_manager", roleIds: ["branch_manager"], directRoleIds: ["branch_manager"], effectivePermissions: ["expenses.read"] });
  await db.doc("users/activity-sdk-record-creator").set({ organizationId: org, displayName: "Register creator", email: "secret-user-field@example.invalid", effectivePermissions: ["user.manage"] });
  for (const branchId of ["a", "b"]) await db.doc(`branches/${branchId}`).set({ organizationId: org, name: branchId, code: branchId, branchType: "store", status: "active" });
  for (const [id, branchId, organizationId] of [["own", "a", org], ["other-store", "b", org], ["foreign-store", "a", other]]) await db.doc(`expenses/activity-sdk-${id}`).set({ organizationId, branchId, createdBy: "activity-sdk-record-creator", approvedBy: foreign.uid, status: "draft", expenseDate: "2026-10-01", expenseNumber: id, netAmountMinor: 100, vatAmountMinor: 0, grossAmountMinor: 100, outstandingAmountMinor: 100 });
  await db.doc("users/connector:device-1").set({ organizationId: other, displayName: "Foreign connector name", email: "private" });
  const batch = db.batch();
  for (let n = 0; n < 31; n++) batch.set(db.doc(`auditLogs/activity-sdk-${String(n).padStart(3, "0")}`), { organizationId: org, actorUserId: auditor.uid, actorRoleId: "auditor", action: "sale.completed", entityType: "sale", entityId: `sale-${n}`, createdAt: Timestamp.fromMillis(Date.parse("2026-10-01T12:00:00Z")), after: { saleNumber: `INV-${n}`, token: "never-return-this" }, before: { password: "never-return-this" } });
  for (const [suffix, at] of [["start", "2026-09-30T23:00:00Z"], ["before", "2026-09-30T22:59:59Z"], ["until", "2026-10-02T23:00:00Z"]] as const) batch.set(db.doc(`auditLogs/activity-sdk-${suffix}`), { organizationId: org, actorUserId: "connector:device-1", actorRoleId: "attendance_connector", action: "attendance.imported", entityType: "attendanceEvent", entityId: suffix, createdAt: Timestamp.fromDate(new Date(at)) });
  batch.set(db.doc("auditLogs/activity-sdk-foreign"), { organizationId: other, actorUserId: foreign.uid, action: "user.created", entityType: "user", entityId: "foreign", createdAt: Timestamp.fromDate(new Date("2026-10-01T12:00:00Z")) });
  await batch.commit(); beforeHash = await historyHash();
});
afterAll(async () => { await Promise.all(apps.map(deleteApp)); });
describe.sequential("user activity callable SDK boundary", () => {
  it("denies anonymous, operations, malformed role lists and administrators missing explicit audit authority", async () => {
    await expect(call(client("anonymous"))).rejects.toMatchObject({ code: "functions/unauthenticated" });
    for (const c of [operations, malformed, adminDenied, cashier]) await expect(call(c)).rejects.toMatchObject({ code: "functions/permission-denied" });
  });
  it("retains legacy auditor and custom auditor-base access without broadening it", async () => {
    for (const c of [legacy, custom]) expect((await call(c)).rows).toHaveLength(25);
  });
  it("pages ties without duplicates, exposes minimal current labels and binds cursors to viewers and filters", async () => {
    const first = await call(auditor, { actorUserId: auditor.uid }); expect(first.rows).toHaveLength(25); expect(first.nextCursor).toBeTruthy();
    const second = await call(auditor, { actorUserId: auditor.uid, cursor: first.nextCursor }); expect(second.rows).toHaveLength(6); expect(second.nextCursor).toBeNull();
    expect(new Set([...first.rows, ...second.rows].map(row => row.id)).size).toBe(31); expect(first.rows[0]).toMatchObject({ actorName: "auditor", actorNameEvidence: "current_name" }); expect(JSON.stringify(first)).not.toContain("never-return-this");
    await expect(call(auditor, { actorUserId: auditor.uid, cursor: first.nextCursor, action: "other" })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    await expect(call(legacy, { actorUserId: auditor.uid, cursor: first.nextCursor })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    await expect(call(foreign, { actorUserId: auditor.uid, cursor: first.nextCursor })).rejects.toMatchObject({ code: "functions/invalid-argument" });
  });
  it("enforces tenant isolation, Lagos boundaries and recorded connector IDs without leaking foreign user names", async () => {
    const own = await call(auditor, { actorUserId: "connector:device-1" }); expect(own.rows).toHaveLength(1); expect(own.rows[0]).toMatchObject({ entityId: "start", actorName: null, actorNameEvidence: "uid_only" });
    expect(JSON.stringify(own)).not.toContain("Foreign connector name"); const theirs = await call(foreign); expect(theirs.rows).toHaveLength(1); expect(theirs.rows[0]?.entityId).toBe("foreign");
  });
  it("rechecks access loss and leaves immutable history unchanged across reads and denials", async () => {
    await db.doc(`users/${auditor.uid}`).update({ effectivePermissions: [] }); await expect(call(auditor)).rejects.toMatchObject({ code: "functions/permission-denied" });
    expect(await historyHash()).toBe(beforeHash);
  });
  it("projects distinct actors only after expense store/tenant authorization, with no foreign names or account fields", async () => {
    const result = await call(billReader, { branchId: "a", view: "workspace" }, "getExpenseWorkspace") as unknown as { expenses: Array<{ id: string; actorLabels: Record<string, { userId: string; currentName: string | null }> }> };
    expect(result.expenses).toHaveLength(1); expect(result.expenses[0]?.id).toBe("activity-sdk-own");
    expect(result.expenses[0]?.actorLabels).toEqual({ createdBy: { userId: "activity-sdk-record-creator", currentName: "Register creator" }, approvedBy: { userId: foreign.uid, currentName: null } });
    expect(JSON.stringify(result)).not.toContain("secret-user-field"); expect(JSON.stringify(result)).not.toContain("foreign-store");
    await expect(call(billReader, { branchId: "b", view: "workspace" }, "getExpenseWorkspace")).rejects.toMatchObject({ code: "functions/permission-denied" });
  });
  it("requires own-branch transfer read authority before returning record actor labels", async () => {
    await expect(call(cashier, {}, "listTransfers")).rejects.toMatchObject({ code: "functions/permission-denied" });
  });
});
