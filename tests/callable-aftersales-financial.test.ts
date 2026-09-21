import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { getApps as getAdminApps, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const projectId = "demo-ramadan-warehouse";
const adminApp = getAdminApps().find((app) => app.name === "aftersales-financial-tests") ?? initializeAdminApp({ projectId }, "aftersales-financial-tests");
const adminAuth = getAdminAuth(adminApp);
const adminDb = getFirestore(adminApp);
const apps: FirebaseApp[] = [];
const organizationId = "aftersales-financial-org";
const branchId = "aftersales-branch";
const customerId = "aftersales-customer";
const productId = "aftersales-product";
const bankAccountId = "aftersales-bank";
let administrator: ReturnType<typeof client>;

function client(name: string) {
  const app = initializeApp({ projectId, apiKey: "demo", appId: `aftersales-${name}` }, `aftersales-${name}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const functions = getFunctions(app, "us-central1");
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  return { auth, functions };
}
async function call<T = Record<string, unknown>>(name: string, data: Record<string, unknown>) {
  return (await httpsCallable(administrator.functions, name)(data)).data as T;
}

beforeAll(async () => {
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${projectId}/accounts`, { method: "DELETE" });
  await fetch(`http://127.0.0.1:8180/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" });
  const record = await adminAuth.createUser({ email: "aftersales-admin@example.test", password: "Password!234567" });
  await adminDb.doc(`users/${record.uid}`).set({ uid: record.uid, organizationId, roleId: "system_administrator", branchIds: [], warehouseIds: [], status: "active", authDisabled: false, authorizationVersion: 1 });
  administrator = client("administrator");
  await signInWithEmailAndPassword(administrator.auth, "aftersales-admin@example.test", "Password!234567");
  const now = FieldValue.serverTimestamp();
  await Promise.all([
    adminDb.doc(`branches/${branchId}`).set({ organizationId, name: "Head Office", code: "HO", status: "active", createdAt: now }),
    adminDb.doc(`customers/${customerId}`).set({ organizationId, name: "Test Customer", customerNumber: "CUST-001", active: true, createdAt: now }),
    adminDb.doc(`products/${productId}`).set({ organizationId, name: "Test Product", sku: "TEST-001", active: true, createdAt: now }),
    adminDb.doc(`bankAccounts/${bankAccountId}`).set({ organizationId, bankName: "Test Bank", accountName: "Services", accountNumberLast4: "4567", ledgerAccountCode: "1043", active: true, createdAt: now }),
  ]);
});
afterAll(async () => Promise.all(apps.map((app) => deleteApp(app))));

describe.sequential("aftersales and ledger-derived reports", () => {
  it("records a complimentary warranty case without stock or journal effects", async () => {
    const key = crypto.randomUUID();
    const input = { branchId, customerId, productId, serviceType: "warranty", requestType: "warranty", complaint: "Inverter is not starting", idempotencyKey: key };
    const first = await call<{ caseId: string; created: boolean }>("createAftersalesCase", input);
    const again = await call<{ caseId: string; created: boolean }>("createAftersalesCase", input);
    expect(first).toMatchObject({ created: true });
    expect(again).toMatchObject({ caseId: first.caseId, created: false });
    await call("setAftersalesCharge", { caseId: first.caseId, chargeAmountMinor: 0, reason: "Covered without charge", idempotencyKey: crypto.randomUUID() });
    await call("updateAftersalesCase", { caseId: first.caseId, status: "diagnosed", resolution: "Power board inspected", idempotencyKey: crypto.randomUUID() });
    await call("updateAftersalesCase", { caseId: first.caseId, status: "awaiting_collection", resolution: "Power board repaired", idempotencyKey: crypto.randomUUID() });
    await call("updateAftersalesCase", { caseId: first.caseId, status: "completed", resolution: "Customer collected repaired item", idempotencyKey: crypto.randomUUID() });
    expect((await adminDb.doc(`aftersalesCases/${first.caseId}`).get()).data()).toMatchObject({ status: "completed", chargeStatus: "complimentary" });
    expect((await adminDb.collection("journalEntries").get()).empty).toBe(true);
    expect((await adminDb.collection("inventoryEntries").get()).empty).toBe(true);
  });

  it("tracks paid non-warranty service and uses the selected bank ledger account exactly once", async () => {
    const created = await call<{ caseId: string }>("createAftersalesCase", { branchId, customerId, productId, serviceType: "non_warranty", requestType: "repair", complaint: "Damaged cable needs replacement", idempotencyKey: crypto.randomUUID() });
    await call("setAftersalesCharge", { caseId: created.caseId, chargeAmountMinor: 50_000, reason: "Out-of-warranty labour", idempotencyKey: crypto.randomUUID() });
    const key = crypto.randomUUID();
    const payment = { caseId: created.caseId, method: "bank_transfer", bankAccountId, amountMinor: 20_000, reference: "TRANSFER-001", idempotencyKey: key };
    const first = await call<{ paymentId: string; recorded: boolean }>("recordAftersalesPayment", payment);
    expect((await call<typeof first>("recordAftersalesPayment", payment))).toMatchObject({ paymentId: first.paymentId, recorded: false });
    expect((await adminDb.doc(`aftersalesCases/${created.caseId}`).get()).data()).toMatchObject({ chargeStatus: "partially_paid", outstandingAmountMinor: 30_000 });
    const posted = await adminDb.collection("journalEntries").where("referenceId", "==", first.paymentId).get();
    expect(posted.size).toBe(1);
    const lines = await adminDb.collection("journalLines").where("journalEntryId", "==", posted.docs[0]!.id).get();
    expect(lines.docs.map((line) => line.get("accountCode"))).toEqual(expect.arrayContaining(["1043", "4100"]));
    expect((await adminDb.doc(`aftersalesPayments/${first.paymentId}`).get()).get("bankAccountId")).toBe(bankAccountId);
    await expect(call("recordAftersalesPayment", { ...payment, idempotencyKey: crypto.randomUUID(), bankAccountId: "wrong-account" })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect((await adminDb.doc(`aftersalesCases/${created.caseId}`).get()).get("outstandingAmountMinor")).toBe(30_000);
  });

  it("provides four ledger-derived statements and tax evidence without a fabricated statutory rule", async () => {
    const period = { fromDate: "2026-09-01", toDate: "2026-09-30" };
    const trial = await call<{ totalDebitMinor: number; totalCreditMinor: number }>("generateFinancialStatement", { ...period, reportType: "trial_balance" });
    expect(trial.totalDebitMinor).toBe(trial.totalCreditMinor);
    const income = await call<{ profitMinor: number }>("generateFinancialStatement", { ...period, reportType: "income_statement" });
    expect(income.profitMinor).toBe(20_000);
    const balance = await call<{ balanced: boolean }>("generateFinancialStatement", { ...period, reportType: "balance_sheet" });
    expect(balance.balanced).toBe(true);
    const cashFlow = await call<{ netCashMovementMinor: number }>("generateFinancialStatement", { ...period, reportType: "cash_flow" });
    expect(cashFlow.netCashMovementMinor).toBe(20_000);
    const tax = await call<{ statutoryRuleReviewRequired: boolean; vat: { calculatedLiabilityMinor: number } }>("getTaxWorkspace", period);
    expect(tax).toMatchObject({ statutoryRuleReviewRequired: true, vat: { calculatedLiabilityMinor: 0 } });
  });
});
