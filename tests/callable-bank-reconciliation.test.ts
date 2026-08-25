import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { getApps as getAdminApps, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const projectId = "demo-ramadan-warehouse";
const adminApp = getAdminApps().find((app) => app.name === "bank-reconciliation-callable-tests") ?? initializeAdminApp({ projectId }, "bank-reconciliation-callable-tests");
const adminAuth = getAdminAuth(adminApp), adminDb = getFirestore(adminApp), apps: FirebaseApp[] = [];
const organizationId = "bank-reconciliation-test-org";
let administrator: ReturnType<typeof client>, financeOfficer: ReturnType<typeof client>;

function client(name: string) {
  const app = initializeApp({ projectId, apiKey: "demo", appId: `bank-${name}` }, `bank-${name}`); apps.push(app);
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
  administrator = await createActor("bank-admin@example.test", "system_administrator");
  financeOfficer = await createActor("bank-finance@example.test", "finance_officer");
  const effectiveAt = Timestamp.fromDate(new Date("2026-08-02T00:00:00.000Z"));
  await adminDb.doc("journalLines/bank-credit-line").set({ organizationId, journalEntryId: "journal-bank-credit", journalNumber: "JRN-2026-000001", accountCode: "1030", accountName: "Bank transfer clearing", debitMinor: 0, creditMinor: 20_000, currency: "NGN", effectiveAt, createdAt: effectiveAt });
  await adminDb.doc("journalLines/wrong-credit-line").set({ organizationId, journalEntryId: "journal-wrong-credit", journalNumber: "JRN-2026-000002", accountCode: "1030", accountName: "Bank transfer clearing", debitMinor: 0, creditMinor: 10_000, currency: "NGN", effectiveAt, createdAt: effectiveAt });
});
afterAll(async () => Promise.all(apps.map((app) => deleteApp(app))));

describe.sequential("bank reconciliation callables", () => {
  it("imports, matches, independently closes, and freezes reconciled evidence", async () => {
    const account = await call<{ bankAccountId: string }>(financeOfficer, "saveBankAccount", { bankName: "Access Bank", accountName: "ABR operating account", accountNumberLast4: "4321", ledgerAccountCode: "1030", openingBalanceMinor: 100_000, openingDate: "2026-08-01", active: true });
    const row = { transactionDate: "2026-08-02", description: "Supplier bank payment", reference: "PAY-001", externalId: "ACCESS-0001", amountMinor: -20_000 };
    await expect(call(financeOfficer, "importBankStatement", { bankAccountId: account.bankAccountId, rows: [row], idempotencyKey: crypto.randomUUID() })).resolves.toMatchObject({ importedCount: 1, duplicateCount: 0 });
    await expect(call(financeOfficer, "importBankStatement", { bankAccountId: account.bankAccountId, rows: [row], idempotencyKey: crypto.randomUUID() })).resolves.toMatchObject({ importedCount: 0, duplicateCount: 1 });
    const workspace = await call<{ statementTransactions: Array<{ id: string }>; journalLines: Array<{ id: string }> }>(financeOfficer, "getBankReconciliationWorkspace", { bankAccountId: account.bankAccountId });
    const statementId = workspace.statementTransactions[0]!.id;
    await expect(call(financeOfficer, "matchBankTransaction", { statementTransactionId: statementId, journalLineId: "wrong-credit-line", idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await call(financeOfficer, "matchBankTransaction", { statementTransactionId: statementId, journalLineId: "bank-credit-line", idempotencyKey: crypto.randomUUID() });
    await call(financeOfficer, "unmatchBankTransaction", { statementTransactionId: statementId, idempotencyKey: crypto.randomUUID() });
    await call(financeOfficer, "matchBankTransaction", { statementTransactionId: statementId, journalLineId: "bank-credit-line", idempotencyKey: crypto.randomUUID() });

    // The unrelated 10,000-credit line must prevent closure until it is outside this period.
    await expect(call(financeOfficer, "prepareBankReconciliation", { bankAccountId: account.bankAccountId, periodStart: "2026-08-01", periodEnd: "2026-08-31", openingBalanceMinor: 100_000, closingBalanceMinor: 80_000, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await adminDb.doc("journalLines/wrong-credit-line").update({ effectiveAt: Timestamp.fromDate(new Date("2026-07-01T00:00:00.000Z")) });
    const prepared = await call<{ reconciliationId: string; reconciliationNumber: string }>(financeOfficer, "prepareBankReconciliation", { bankAccountId: account.bankAccountId, periodStart: "2026-08-01", periodEnd: "2026-08-31", openingBalanceMinor: 100_000, closingBalanceMinor: 80_000, idempotencyKey: crypto.randomUUID() });
    expect(prepared.reconciliationNumber).toMatch(/^BRC-/);
    await expect(call(financeOfficer, "completeBankReconciliation", { reconciliationId: prepared.reconciliationId, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/permission-denied" });
    const completionKey = crypto.randomUUID();
    await expect(call(administrator, "completeBankReconciliation", { reconciliationId: prepared.reconciliationId, idempotencyKey: completionKey })).resolves.toMatchObject({ status: "closed" });
    await expect(call(administrator, "completeBankReconciliation", { reconciliationId: prepared.reconciliationId, idempotencyKey: completionKey })).resolves.toMatchObject({ status: "closed" });
    expect((await adminDb.doc(`bankReconciliations/${prepared.reconciliationId}`).get()).data()).toMatchObject({ status: "closed", differenceMinor: 0, statementMovementMinor: -20_000, ledgerMovementMinor: -20_000 });
    expect((await adminDb.doc(`bankStatementTransactions/${statementId}`).get()).data()).toMatchObject({ status: "reconciled", reconciliationId: prepared.reconciliationId });
    expect((await adminDb.doc("journalLines/bank-credit-line").get()).data()).toMatchObject({ bankReconciled: true, bankReconciliationId: prepared.reconciliationId });
    await expect(call(financeOfficer, "unmatchBankTransaction", { statementTransactionId: statementId, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
  });

  it("closes a genuine zero-activity bank month when balances agree", async () => {
    const account = await call<{ bankAccountId: string }>(financeOfficer, "saveBankAccount", { bankName: "Jaiz Bank", accountName: "ABR reserve account", accountNumberLast4: "5678", ledgerAccountCode: "1031", openingBalanceMinor: 250_000, openingDate: "2026-07-01", active: true });
    const prepared = await call<{ reconciliationId: string }>(financeOfficer, "prepareBankReconciliation", { bankAccountId: account.bankAccountId, periodStart: "2026-07-01", periodEnd: "2026-07-31", openingBalanceMinor: 250_000, closingBalanceMinor: 250_000, notes: "No activity confirmed from the statement", idempotencyKey: crypto.randomUUID() });
    await expect(call(administrator, "completeBankReconciliation", { reconciliationId: prepared.reconciliationId, idempotencyKey: crypto.randomUUID() })).resolves.toMatchObject({ status: "closed" });
    expect((await adminDb.doc(`bankReconciliations/${prepared.reconciliationId}`).get()).data()).toMatchObject({ status: "closed", statementTransactionCount: 0, journalLineCount: 0, statementMovementMinor: 0, ledgerMovementMinor: 0, differenceMinor: 0 });
  });
});
