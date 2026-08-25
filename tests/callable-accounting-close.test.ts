import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { getApps as getAdminApps, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const projectId = "demo-ramadan-warehouse";
const adminApp = getAdminApps().find((app) => app.name === "accounting-close-callable-tests") ?? initializeAdminApp({ projectId }, "accounting-close-callable-tests");
const adminAuth = getAdminAuth(adminApp), adminDb = getFirestore(adminApp), apps: FirebaseApp[] = [];
const organizationId = "accounting-close-test-org", periodKey = "2025-01";
let administrator: ReturnType<typeof client>, financeOfficer: ReturnType<typeof client>;

function client(name: string) {
  const app = initializeApp({ projectId, apiKey: "demo", appId: `accounting-${name}` }, `accounting-${name}`); apps.push(app);
  const auth = getAuth(app); connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const functions = getFunctions(app, "us-central1"); connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  return { auth, functions };
}
async function call<T = Record<string, unknown>>(target: ReturnType<typeof client>, name: string, data: Record<string, unknown>) {
  return (await httpsCallable(target.functions, name)(data)).data as T;
}
async function createActor(email: string, roleId: string) {
  const record = await adminAuth.createUser({ email, password: "Password!234567", displayName: roleId });
  await adminDb.doc(`users/${record.uid}`).set({ uid: record.uid, organizationId, email, displayName: roleId, roleId, branchIds: [], warehouseIds: [], status: "active", authDisabled: false, authorizationVersion: 1, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  const result = client(email.replaceAll(/[^a-z]/g, "-")); await signInWithEmailAndPassword(result.auth, email, "Password!234567"); return result;
}

beforeAll(async () => {
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${projectId}/accounts`, { method: "DELETE" });
  await fetch(`http://127.0.0.1:8180/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" });
  administrator = await createActor("accounting-admin@example.test", "system_administrator");
  financeOfficer = await createActor("accounting-finance@example.test", "finance_officer");
  const effectiveAt = Timestamp.fromDate(new Date("2025-01-15T12:00:00.000Z"));
  await adminDb.doc("journalEntries/close-journal-1").set({ organizationId, journalNumber: "JRN-2025-000001", status: "posted", totalDebitMinor: 150_000, totalCreditMinor: 150_000, effectiveAt });
  await adminDb.doc("journalLines/close-journal-debit").set({ organizationId, journalEntryId: "close-journal-1", journalNumber: "JRN-2025-000001", accountCode: "6000", accountName: "Operating expenses", debitMinor: 150_000, creditMinor: 0, effectiveAt });
  await adminDb.doc("journalLines/close-journal-credit").set({ organizationId, journalEntryId: "close-journal-1", journalNumber: "JRN-2025-000001", accountCode: "2300", accountName: "Accrued operating expenses", debitMinor: 0, creditMinor: 150_000, effectiveAt });
});
afterAll(async () => Promise.all(apps.map((app) => deleteApp(app))));

describe.sequential("accounting close callables", () => {
  it("prepares balanced evidence, requires an independent closer, and locks later journal posting", async () => {
    const workspace = await call<{ evidence: { blockers: unknown[]; totalDebitMinor: number; totalCreditMinor: number; trialBalance: Array<{ accountCode: string }> } }>(financeOfficer, "getAccountingCloseWorkspace", { periodKey });
    expect(workspace.evidence.blockers).toEqual([]);
    expect(workspace.evidence.totalDebitMinor).toBe(150_000);
    expect(workspace.evidence.totalCreditMinor).toBe(150_000);
    expect(workspace.evidence.trialBalance.map((line) => line.accountCode)).toEqual(["2300", "6000"]);

    const preparationKey = crypto.randomUUID();
    const prepared = await call<{ accountingPeriodId: string; status: string; prepared: boolean }>(financeOfficer, "prepareAccountingPeriodClose", { periodKey, notes: "Reviewed January trial balance", idempotencyKey: preparationKey });
    expect(prepared).toMatchObject({ status: "prepared", prepared: true });
    await expect(call(financeOfficer, "completeAccountingPeriodClose", { accountingPeriodId: prepared.accountingPeriodId, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/permission-denied" });

    const completionKey = crypto.randomUUID();
    await expect(call(administrator, "completeAccountingPeriodClose", { accountingPeriodId: prepared.accountingPeriodId, notes: "Independent completion", idempotencyKey: completionKey })).resolves.toMatchObject({ status: "closed" });
    await expect(call(administrator, "completeAccountingPeriodClose", { accountingPeriodId: prepared.accountingPeriodId, idempotencyKey: completionKey })).resolves.toMatchObject({ status: "closed" });
    expect((await adminDb.doc(`accountingPeriods/${prepared.accountingPeriodId}`).get()).data()).toMatchObject({ organizationId, periodKey, status: "closed" });

    const expense = await call<{ expenseId: string }>(financeOfficer, "createExpense", { categoryName: "Historical rent", payeeName: "Test Landlord", expenseDate: "2025-01-31", supplierDocumentNumber: "CLOSED-JAN-001", description: "Historical rent correction", netAmountMinor: 50_000, vatAmountMinor: 0, idempotencyKey: crypto.randomUUID() });
    await call(financeOfficer, "submitExpense", { expenseId: expense.expenseId, idempotencyKey: crypto.randomUUID() });
    await expect(call(administrator, "approveExpense", { expenseId: expense.expenseId, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect((await adminDb.doc(`expenses/${expense.expenseId}`).get()).get("status")).toBe("submitted");
    expect((await adminDb.collection("journalEntries").where("referenceId", "==", expense.expenseId).get()).empty).toBe(true);
  });
});
