import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { getApps as getAdminApps, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const projectId = "demo-ramadan-warehouse";
const adminApp = getAdminApps().find((app) => app.name === "expense-callable-tests") ?? initializeAdminApp({ projectId }, "expense-callable-tests");
const adminAuth = getAdminAuth(adminApp), adminDb = getFirestore(adminApp), apps: FirebaseApp[] = [];
const organizationId = "expense-test-org", branchId = "expense-branch";
let administrator: ReturnType<typeof client>, financeOfficer: ReturnType<typeof client>, branchManager: ReturnType<typeof client>;

function client(name: string) {
  const app = initializeApp({ projectId, apiKey: "demo", appId: `expense-${name}` }, `expense-${name}`); apps.push(app);
  const auth = getAuth(app); connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const functions = getFunctions(app, "us-central1"); connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  return { auth, functions };
}
async function call<T = Record<string, unknown>>(target: ReturnType<typeof client>, name: string, data: Record<string, unknown>) {
  return (await httpsCallable(target.functions, name)(data)).data as T;
}
async function createActor(email: string, roleId: string) {
  const record = await adminAuth.createUser({ email, password: "Password!234567", displayName: roleId });
  await adminDb.doc(`users/${record.uid}`).set({ uid: record.uid, organizationId, email, displayName: roleId, roleId, branchIds: roleId === "branch_manager" ? [branchId] : [], warehouseIds: [], status: "active", authDisabled: false, authorizationVersion: 1, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  const result = client(email.replaceAll(/[^a-z]/g, "-")); await signInWithEmailAndPassword(result.auth, email, "Password!234567"); return result;
}

beforeAll(async () => {
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${projectId}/accounts`, { method: "DELETE" });
  await fetch(`http://127.0.0.1:8180/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" });
  administrator = await createActor("expense-admin@example.test", "system_administrator");
  financeOfficer = await createActor("expense-finance@example.test", "finance_officer");
  branchManager = await createActor("expense-branch@example.test", "branch_manager");
  await adminDb.doc(`branches/${branchId}`).set({ organizationId, name: "Igbo Road Branch", code: "IRB", status: "active", createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
});
afterAll(async () => Promise.all(apps.map((app) => deleteApp(app))));

describe.sequential("expense callables", () => {
  it("creates categories inline, enforces independent approval, and controls partial disbursement", async () => {
    const context = { operatingContext: { type: "branch", id: branchId } };
    const scoped = await call<{ expenseId: string; expenseNumber: string }>(branchManager, "createExpense", { categoryName: "Electricity", payeeName: "Kano Electricity Distribution", branchId, expenseDate: new Date().toISOString().slice(0, 10), supplierDocumentNumber: "KEDCO-001", description: "Monthly branch electricity bill", netAmountMinor: 100_000, vatAmountMinor: 7_500, idempotencyKey: crypto.randomUUID(), ...context });
    expect(scoped.expenseNumber).toMatch(/^EXP-/);
    const workspace = await call<{ expenses: Array<{ id: string }>; categories: Array<{ name: string }> }>(branchManager, "getExpenseWorkspace", { branchId, ...context });
    expect(workspace.expenses.map((expense) => expense.id)).toContain(scoped.expenseId);
    expect(workspace.categories.map((category) => category.name)).toContain("Electricity");

    const expense = await call<{ expenseId: string; expenseNumber: string }>(financeOfficer, "createExpense", { categoryName: "Electricity", payeeName: "Corporate Affairs Commission", expenseDate: new Date().toISOString().slice(0, 10), supplierDocumentNumber: "CAC-2026-001", description: "Annual statutory filing fee", netAmountMinor: 50_000, vatAmountMinor: 3_750, idempotencyKey: crypto.randomUUID() });
    await call(financeOfficer, "submitExpense", { expenseId: expense.expenseId, idempotencyKey: crypto.randomUUID() });
    await expect(call(financeOfficer, "approveExpense", { expenseId: expense.expenseId, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(call(administrator, "approveExpense", { expenseId: expense.expenseId, idempotencyKey: crypto.randomUUID() })).resolves.toMatchObject({ status: "approved" });
    const approved = adminDb.doc(`expenses/${expense.expenseId}`), approvedSnapshot = await approved.get();
    expect(approvedSnapshot.data()).toMatchObject({ status: "approved", grossAmountMinor: 53_750, outstandingAmountMinor: 53_750 });
    const approvalJournal = await adminDb.collection("journalEntries").where("referenceId", "==", expense.expenseId).get();
    expect(approvalJournal.docs[0]!.get("totalDebitMinor")).toBe(approvalJournal.docs[0]!.get("totalCreditMinor"));
    const approvalLines = await adminDb.collection("journalLines").where("journalEntryId", "==", approvalJournal.docs[0]!.id).get();
    expect(approvalLines.docs.map((line) => line.get("accountCode"))).toEqual(expect.arrayContaining(["1300", "2300", "6000"]));
    expect(approvalLines.docs.map((line) => line.get("accountCode"))).not.toContain("2100");

    await expect(call(financeOfficer, "recordExpensePayment", { expenseId: expense.expenseId, method: "bank_transfer", reference: "BANK-TOO-MUCH", amountMinor: 60_000, paidAt: new Date().toISOString(), idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect((await approved.get()).get("outstandingAmountMinor")).toBe(53_750);
    const firstPayment = await call<{ paymentId: string }>(financeOfficer, "recordExpensePayment", { expenseId: expense.expenseId, method: "bank_transfer", reference: "BANK-EXP-001", amountMinor: 20_000, paidAt: new Date().toISOString(), idempotencyKey: crypto.randomUUID() });
    expect((await approved.get()).data()).toMatchObject({ status: "partially_paid", outstandingAmountMinor: 33_750 });
    await call(financeOfficer, "recordExpensePayment", { expenseId: expense.expenseId, method: "cash", amountMinor: 33_750, paidAt: new Date().toISOString(), idempotencyKey: crypto.randomUUID() });
    expect((await approved.get()).data()).toMatchObject({ status: "paid", outstandingAmountMinor: 0 });
    const paymentJournal = await adminDb.collection("journalEntries").where("referenceId", "==", firstPayment.paymentId).get();
    expect(paymentJournal.docs[0]!.get("totalDebitMinor")).toBe(paymentJournal.docs[0]!.get("totalCreditMinor"));
    const paymentLines = await adminDb.collection("journalLines").where("journalEntryId", "==", paymentJournal.docs[0]!.id).get();
    expect(paymentLines.docs.map((line) => line.get("accountCode"))).toContain("2300");
  });
});
