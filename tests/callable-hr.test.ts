import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { getApps as getAdminApps, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ingestExternalAttendance } from "../functions/src/callable/hr";

const projectId = "demo-ramadan-warehouse";
const adminApp = getAdminApps().find((app) => app.name === "hr-test-admin") ?? initializeAdminApp({ projectId }, "hr-test-admin");
const auth = getAdminAuth(adminApp);
const db = getFirestore(adminApp);
const apps: FirebaseApp[] = [];
const organizationId = "hr-test-org";
let system: ReturnType<typeof client>;
let operations: ReturnType<typeof client>;

function client(name: string) {
  const app = initializeApp({ projectId, apiKey: "demo", appId: `hr-${name}` }, `hr-${name}`); apps.push(app);
  const userAuth = getAuth(app); connectAuthEmulator(userAuth, "http://127.0.0.1:9099", { disableWarnings: true });
  const functions = getFunctions(app, "us-central1"); connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  return { auth: userAuth, functions };
}
async function actor(email: string, roleId: string) {
  const user = await auth.createUser({ email, password: "Password!234567" });
  await db.doc(`users/${user.uid}`).set({ uid: user.uid, organizationId, email, status: "active", authDisabled: false, roleId, roleIds: [roleId], branchIds: [], warehouseIds: [], authorizationVersion: 1 });
  const result = client(roleId);
  await signInWithEmailAndPassword(result.auth, email, "Password!234567");
  return result;
}
async function call<T>(target: ReturnType<typeof client>, name: string, data: object) {
  return (await httpsCallable<object, T>(target.functions, name)(data)).data;
}

beforeAll(async () => {
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${projectId}/accounts`, { method: "DELETE" });
  await fetch(`http://127.0.0.1:8180/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" });
  system = await actor("hr-system@example.test", "system_administrator");
  operations = await actor("hr-operations@example.test", "operations_administrator");
  await db.doc("branches/hr-branch").set({ organizationId, name: "Head Office", status: "active" });
});
afterAll(async () => Promise.all(apps.map((app) => deleteApp(app))));

describe("HR foundation", () => {
  let employeeId = "";
  it("creates staff without an app account and preserves unique attendance IDs", async () => {
    const payload = { staffId: "HR-001", fullName: "Ada Worker", department: "Operations", jobTitle: "Installer", branchId: "hr-branch", employmentDate: "2025-01-01", status: "active", externalAttendanceId: "finger-42" };
    const saved = await call<{ employeeId: string }>(operations, "saveEmployee", payload);
    employeeId = saved.employeeId;
    const record = await db.doc(`employees/${employeeId}`).get();
    expect(record.get("userId")).toBeNull();
    expect(record.get("externalAttendanceId")).toBe("finger-42");
    await expect(call(operations, "saveEmployee", payload)).rejects.toMatchObject({ code: "functions/already-exists" });
  });
  it("restricts salary data and versions every salary change", async () => {
    await expect(call(operations, "saveEmployeeCompensation", { employeeId, monthlySalaryMinor: 12500000, effectiveFrom: "2026-09-01", reason: "Annual review" })).rejects.toMatchObject({ code: "functions/permission-denied" });
    await call(system, "saveEmployeeCompensation", { employeeId, monthlySalaryMinor: 12500000, effectiveFrom: "2026-09-01", reason: "Annual review" });
    const publicWorkspace = await call<{ employees: Array<{ salary?: unknown }> }>(operations, "getHrWorkspace", {});
    const privateWorkspace = await call<{ employees: Array<{ salary?: { monthlySalaryMinor: number } }> }>(system, "getHrWorkspace", {});
    expect(publicWorkspace.employees[0]?.salary).toBeNull();
    expect(privateWorkspace.employees[0]?.salary?.monthlySalaryMinor).toBe(12500000);
    expect((await db.collection("employeeCompensationVersions").where("employeeId", "==", employeeId).get()).size).toBe(1);
  });
  it("deduplicates manual and connector attendance while keeping an audit trail", async () => {
    const occurredAt = new Date(Date.now() - 60_000).toISOString();
    const manual = { employeeId, kind: "clock_in", occurredAt, reason: "Forgot to clock in", idempotencyKey: crypto.randomUUID() };
    const first = await call<{ eventId: string }>(operations, "recordAttendanceEvent", manual);
    expect((await call<{ eventId: string }>(operations, "recordAttendanceEvent", manual)).eventId).toBe(first.eventId);
    const external = { organizationId, deviceId: "front-desk", externalEventId: "scan-0001", externalAttendanceId: "finger-42", kind: "clock_out" as const, occurredAt };
    const imported = await ingestExternalAttendance(external);
    expect(imported.created).toBe(true);
    expect((await ingestExternalAttendance(external)).created).toBe(false);
    expect((await db.doc(`attendanceEvents/${imported.eventId}`).get()).get("source")).toBe("fingerprint_connector");
    expect((await db.collection("auditLogs").where("entityId", "==", imported.eventId).get()).size).toBe(1);
  });
  it("records staff activity without granting the employee an app login", async () => {
    const payload = { employeeId, kind: "training", occurredOn: "2026-09-20", summary: "Safety induction completed", idempotencyKey: crypto.randomUUID() };
    const first = await call<{ eventId: string }>(operations, "recordEmployeeActivity", payload);
    const second = await call<{ eventId: string }>(operations, "recordEmployeeActivity", payload);
    expect(first.eventId).toBe(second.eventId);
    const employee = await db.doc(`employees/${employeeId}`).get();
    expect(employee.get("userId")).toBeNull();
  });
  it("registers a browser endpoint only for the authenticated user", async () => {
    const endpoint = "https://fcm.googleapis.com/fcm/send/test-device-42";
    await call(system, "saveWebPushSubscription", { endpoint, keys: { p256dh: "p".repeat(80), auth: "a".repeat(24) } });
    const subscriptions = await db.collection(`users/${system.auth.currentUser?.uid}/pushSubscriptions`).get();
    expect(subscriptions.size).toBe(1);
    await db.doc(`users/${system.auth.currentUser?.uid}/notifications/push-test`).set({ organizationId, recipientId: system.auth.currentUser?.uid, eventId: "push-event-1", actionRequired: true, readAt: null, title: "Action required", body: "Open your task", href: "/notifications" });
    let deliveryCount = 0;
    for (let attempt = 0; attempt < 15; attempt++) {
      deliveryCount = (await db.collection("pushDeliveries").where("eventId", "==", "push-event-1").get()).size;
      if (deliveryCount) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(deliveryCount).toBe(1);
    await call(system, "removeWebPushSubscription", { endpoint });
    expect((await subscriptions.docs[0]!.ref.get()).exists).toBe(false);
  });
});
