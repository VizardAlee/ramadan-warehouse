import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { getApps as getAdminApps, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
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
  await db.doc(`organizations/${organizationId}`).set({ name: "HR test", status: "active" });
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

describe("paged HR history", () => {
  it("includes the last Nigeria-day nanosecond, excludes adjacent days and pages tied times once", async () => {
    const time = Timestamp.fromDate(new Date("2026-09-30T22:59:59Z"));
    const batch = db.batch();
    for (let index = 0; index < 26; index++) batch.set(db.doc(`attendanceEvents/history-${String(index).padStart(3, "0")}`), { organizationId, employeeId: "historical", staffId: "OLD", kind: "clock_in", source: "manual", occurredAt: time });
    batch.set(db.doc("attendanceEvents/history-last-nanosecond"), { organizationId, employeeId: "historical", kind: "clock_out", occurredAt: new Timestamp(time.seconds, 999999999) });
    batch.set(db.doc("attendanceEvents/history-next-day"), { organizationId, employeeId: "historical", kind: "clock_in", occurredAt: Timestamp.fromDate(new Date("2026-09-30T23:00:00Z")) });
    batch.set(db.doc("attendanceEvents/history-other-org"), { organizationId: "other-org", employeeId: "historical", kind: "clock_in", occurredAt: time });
    await batch.commit();
    const input = { kind: "attendance", fromDate: "2026-09-30", toDate: "2026-09-30", limit: 25 };
    type Page = { rows: Array<{ id: string; occurredAt: string; salary?: unknown }>; nextCursorId: string | null };
    const first = await call<Page>(operations, "getHrHistory", input);
    const second = await call<Page>(operations, "getHrHistory", { ...input, cursorId: first.nextCursorId });
    const all = [...first.rows, ...second.rows];
    expect(first.rows).toHaveLength(25); expect(second.rows).toHaveLength(2); expect(second.nextCursorId).toBeNull();
    expect(new Set(all.map(row => row.id)).size).toBe(27);
    expect(all.find(row => row.id === "history-last-nanosecond")?.occurredAt).toBe("2026-09-30T22:59:59.999Z");
    expect(all.some(row => row.id === "history-next-day" || row.id === "history-other-org")).toBe(false);
    expect(all.every(row => row.salary === undefined)).toBe(true);
    await expect(call(operations, "getHrHistory", { ...input, cursorId: "history-other-org" })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    await expect(call(operations, "getHrHistory", { ...input, cursorId: "history-next-day" })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    await expect(call(operations, "getHrHistory", { ...input, fromDate: "2026-10-01" })).rejects.toMatchObject({ code: "functions/invalid-argument" });
  });
  it("reports activity details beyond the recent preview with inclusive date boundaries", async () => {
    for (let index = 0; index < 27; index++) await db.doc(`employeeActivityEvents/history-${index}`).set({ organizationId, employeeId: "historical", kind: "note", occurredOn: "2026-08-01", summary: `Activity ${index}` });
    const input = { kind: "activity", fromDate: "2026-08-01", toDate: "2026-08-01", limit: 25 };
    type Page = { rows: Array<{ summary: string }>; nextCursorId: string | null };
    const first = await call<Page>(operations, "getHrHistory", input), second = await call<Page>(operations, "getHrHistory", { ...input, cursorId: first.nextCursorId });
    expect(first.rows.length + second.rows.length).toBe(27); expect(second.nextCursorId).toBeNull();
    expect(first.rows.every(row => row.summary.startsWith("Activity"))).toBe(true);
    const cashier = await actor("history-cashier@example.test", "sales_cashier");
    await expect(call(cashier, "getHrHistory", input)).rejects.toMatchObject({ code: "functions/permission-denied" });
  });
});
