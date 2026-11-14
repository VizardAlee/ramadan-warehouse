import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uniquenessDocumentId } from "../functions/src/inventory/calculations";
const projectId = "demo-ramadan-warehouse", organizationId = "staff-advance-test-org", branchId = "advance-store";
const admin = initializeAdminApp({ projectId }, "staff-advance-tests"), db = getFirestore(admin), auth = getAdminAuth(admin), apps: FirebaseApp[] = [];
async function actor(email: string, roleId: string) {
  const user = await auth.createUser({ email, password: "Password!234567" });
  await db.doc(`users/${user.uid}`).set({ uid: user.uid, organizationId, roleId, email, displayName: roleId, branchIds: [branchId], warehouseIds: [], status: "active", authDisabled: false, authorizationVersion: 1 });
  const app = initializeApp({ projectId, apiKey: "demo", appId: email }, email); apps.push(app);
  const clientAuth = getAuth(app); connectAuthEmulator(clientAuth, "http://127.0.0.1:9099", { disableWarnings: true });
  const functions = getFunctions(app, "us-central1"); connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  await signInWithEmailAndPassword(clientAuth, email, "Password!234567");
  return { uid: user.uid, call: async (data: Record<string, unknown>) => (await httpsCallable(functions, "staffAdvances")(data)).data as Record<string, unknown> };
}
let finance: Awaited<ReturnType<typeof actor>>, officer: Awaited<ReturnType<typeof actor>>;
const movement = (action: string, data = {}) => ({ action, amountMinor: 100000, reason: "Actual advance for delivery", reference: crypto.randomUUID(), method: "cash", idempotencyKey: crypto.randomUUID(), ...data });
const issue = (data = {}) => finance.call(movement("issue", { branchId, recipientName: "Test driver", recipientType: "driver", purpose: "Delivery fuel advance", ...data }));
beforeAll(async () => {
  // A demo-project guard prevents accidental fixture writes to any live project.
  if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8180" && process.env.FIRESTORE_EMULATOR_HOST !== "localhost:8180") throw new Error("Run only with local Firebase emulators");
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${projectId}/accounts`, { method: "DELETE" });
  await fetch(`http://127.0.0.1:8180/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" });
  await db.doc(`organizations/${organizationId}`).set({ name: "Test", status: "active" });
  await db.doc(`branches/${branchId}`).set({ organizationId, name: "Test store", status: "active" });
  finance = await actor("advance-finance@example.test", "finance_officer");
  officer = await actor("advance-officer@example.test", "finance_officer");
  await db.doc("roles/advance-return-only").set({ organizationId, name: "Cash returns only", baseRoleId: "finance_officer", permissionIds: ["cash.advances.read", "cash.advances.return"], status: "active" });
  await db.doc(`users/${officer.uid}`).update({ directRoleIds: [], customRoleIds: ["advance-return-only"], effectivePermissions: ["cash.advances.read", "cash.advances.return"] });
});
afterAll(async () => Promise.all(apps.map(deleteApp)));
describe.sequential("staff advances callable", () => {
  it("posts balanced issue, evidence retirement and return, with immutable audit/history and exact retries", async () => {
    const input = movement("issue", { branchId, recipientName: "Driver one", recipientType: "driver", purpose: "Fuel for delivery" });
    const created = await finance.call(input);
    expect(await finance.call(input)).toEqual(created);
    await expect(finance.call({ ...input, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await expect(finance.call({ ...input, amountMinor: 90000 })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    const retire = { action: "retire", advanceId: created.advanceId, amountMinor: 65000, reason: "Fuel receipt checked", receiptReference: "FUEL-UNIQUE-001", idempotencyKey: crypto.randomUUID() };
    await finance.call(retire); await finance.call(retire);
    await expect(finance.call({ ...retire, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    const returned = movement("return", { advanceId: created.advanceId, amountMinor: 35000 });
    const result = await officer.call(returned); expect(await officer.call(returned)).toEqual(result);
    const detail = await officer.call({ action: "detail", advanceId: created.advanceId });
    expect(detail.advance).toMatchObject({ issuedMinor: 100000, retiredMinor: 65000, returnedMinor: 35000, outstandingMinor: 0, status: "closed" });
    expect(detail.events).toHaveLength(3);
    const lines = await db.collection("journalLines").where("journalEntryId", "==", result.journalEntryId).get();
    expect(lines.docs.map(d => [d.get("accountCode"), d.get("debitMinor"), d.get("creditMinor")]).sort()).toEqual([["1010", 35000, 0], ["1260", 0, 35000]]);
    expect((await db.collection("auditLogs").where("entityId", "==", created.advanceId).get()).size).toBe(3);
  });
  it("prevents permission escalation, foreign records and operating-context mismatch", async () => {
    await expect(officer.call(movement("issue", { branchId, recipientName: "Driver", recipientType: "driver", purpose: "Test delivery" }))).rejects.toMatchObject({ code: "functions/permission-denied" });
    const created = await issue();
    await expect(officer.call({ action: "retire", advanceId: created.advanceId, amountMinor: 1, reason: "Receipt checked", receiptReference: "X01", idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/permission-denied" });
    await db.doc("staffAdvances/foreign-advance").set({ organizationId: "other-org", branchId, issuedMinor: 100, retiredMinor: 0, returnedMinor: 0 });
    await expect(officer.call({ action: "detail", advanceId: "foreign-advance" })).rejects.toMatchObject({ code: "functions/not-found" });
    await db.doc("branches/other-store").set({ organizationId, status: "active" });
    await expect(finance.call(movement("return", { advanceId: created.advanceId, operatingContext: { type: "branch", id: "other-store" } }))).rejects.toMatchObject({ code: "functions/permission-denied" });
  });
  it("rejects a repeated normalized return receipt with a different retry key", async () => {
    const created = await issue();
    await officer.call(movement("return", { advanceId: created.advanceId, amountMinor: 10000, reference: "RETURN-001" }));
    await expect(officer.call(movement("return", { advanceId: created.advanceId, amountMinor: 10000, reference: "return-001" }))).rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect((await db.doc(`staffAdvances/${created.advanceId}`).get()).get("returnedMinor")).toBe(10000);
  });
  it("serializes concurrent competing returns without negative balance", async () => {
    const created = await issue();
    const results = await Promise.allSettled([officer.call(movement("return", { advanceId: created.advanceId, amountMinor: 70000 })), officer.call(movement("return", { advanceId: created.advanceId, amountMinor: 70000 }))]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect((await db.doc(`staffAdvances/${created.advanceId}`).get()).get("returnedMinor")).toBe(70000);
  });
  it("fails closed on a nonstandard duplicate advance control account", async () => {
    const collision = db.doc("chartOfAccounts/nonstandard-advance-asset");
    await collision.set({ organizationId, code: "1260", name: "Another asset", active: true });
    await expect(issue()).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await collision.delete();
    const canonical = db.doc(`chartOfAccounts/${uniquenessDocumentId(organizationId, "1260")}`);
    await canonical.update({ currency: "USD" });
    await expect(issue()).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await canonical.update({ currency: "NGN" });
  });
  it("rejects locked periods, foreign accounts, other-branch banks and self-offset ledger mappings", async () => {
    const created = await issue(), periodKey = new Date().toISOString().slice(0, 7), period = db.doc(`accountingPeriods/${uniquenessDocumentId(organizationId, periodKey)}`);
    await period.set({ organizationId, periodKey, status: "closed" });
    await expect(officer.call(movement("return", { advanceId: created.advanceId }))).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await period.delete();
    for (const change of [{ organizationId: "other" }, { branchId: "other-store" }, { ledgerAccountCode: "1260" }, { ledgerAccountCode: "6000" }]) {
      await db.doc("bankAccounts/advance-bank").set({ organizationId, branchId, active: true, ledgerAccountCode: "1035", ...change });
      await expect(officer.call(movement("return", { advanceId: created.advanceId, method: "bank_transfer", bankAccountId: "advance-bank" }))).rejects.toMatchObject({ code: "functions/failed-precondition" });
    }
    expect((await db.doc(`staffAdvances/${created.advanceId}`).get()).get("returnedMinor")).toBe(0);
  });
});
