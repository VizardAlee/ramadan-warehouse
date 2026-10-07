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
  await adminDb.doc(`organizations/${organizationId}`).set({ name: "Accounting test organization", status: "active" });
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

describe.sequential("store daily close", () => {
  const branchId = "daily-close-store", date = "2025-02-05";
  let manager: ReturnType<typeof client>, cashier: ReturnType<typeof client>;
  let evidenceHash = "", version = 0, dailyCloseId = "";
  it("uses Nigerian dates, pages cash postings and includes non-POS movements without leaking other stores", async () => {
    await adminDb.doc(`branches/${branchId}`).set({ organizationId, name: "Head Office", status: "active" });
    await adminDb.doc("branches/daily-other-store").set({ organizationId, name: "Other store", status: "active" });
    await adminDb.doc("branches/daily-foreign-store").set({ organizationId: "another-org", name: "Foreign store", status: "active" });
    manager = await createActor("daily-manager@example.test", "branch_manager");
    cashier = await createActor("daily-cashier@example.test", "sales_cashier");
    await adminDb.doc(`users/${manager.auth.currentUser!.uid}`).update({ branchIds: [branchId], roleIds: ["branch_manager", "sales_cashier"], directRoleIds: ["branch_manager", "sales_cashier"], effectivePermissions: ["sales.shift.manage"] });
    const batch = adminDb.batch();
    const line = (id: string, at: string, debit: number, credit: number, branch = branchId, org = organizationId) => batch.set(adminDb.doc(`journalLines/daily-${id}`), { organizationId: org, branchId: branch, accountCode: "1010", debitMinor: debit, creditMinor: credit, journalEntryId: `daily-journal-${id}`, effectiveAt: Timestamp.fromDate(new Date(at)) });
    line("opening", "2025-02-04T22:30:00Z", 10_000, 0);
    line("customer-receipt", "2025-02-04T23:30:00Z", 5_000, 0);
    line("expense", "2025-02-05T08:00:00Z", 0, 2_000);
    line("next-day", "2025-02-05T23:10:00Z", 999_999, 0);
    line("other-store", "2025-02-05T08:00:00Z", 999_999, 0, "daily-other-store");
    line("foreign-org", "2025-02-05T08:00:00Z", 999_999, 0, branchId, "another-org");
    for (let index = 0; index < 430; index++) line(`zero-${index}`, "2025-02-05T09:00:00Z", 0, 0);
    batch.set(adminDb.doc("stockCounts/daily-count"), { organizationId, branchId, countDate: date, countNumber: "CNT-DAILY-1", status: "posted" });
    await batch.commit();
    const result = await call<{ evidence: { hash: string; cash: Record<string, number>; exceptions: string[] } }>(manager, "getDailyCloseWorkspace", { branchId, date });
    expect(result.evidence.cash).toEqual({ openingMinor: 10_000, receiptsMinor: 5_000, paymentsMinor: 2_000, closingMinor: 13_000, lineCount: 433 });
    expect(result.evidence.exceptions).toEqual([]);
    evidenceHash = result.evidence.hash;
    const stores = await call<{ rows: Array<{ id: string }> }>(manager, "getDailyCloseWorkspace", { action: "locations" });
    expect(stores.rows.map((store) => store.id)).toEqual([branchId]);
    const financeStores = await call<{ rows: Array<{ id: string }> }>(financeOfficer, "getDailyCloseWorkspace", { action: "locations" });
    expect(financeStores.rows.map((store) => store.id)).toContain(branchId);
    expect(financeStores.rows.map((store) => store.id)).not.toContain("daily-foreign-store");
    await expect(call(manager, "getDailyCloseWorkspace", { branchId: "daily-other-store", date })).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(call(administrator, "getDailyCloseWorkspace", { branchId: "daily-foreign-store", date })).rejects.toMatchObject({ code: "functions/not-found" });
    await expect(call(cashier, "getDailyCloseWorkspace", { branchId, date })).rejects.toMatchObject({ code: "functions/permission-denied" });
  });
  it("requires explanation of cash differences and preserves retry idempotency", async () => {
    const input = { branchId, date, countedCashMinor: 12_500, evidenceHash, idempotencyKey: crypto.randomUUID() };
    await expect(call(manager, "prepareDailyClose", input)).rejects.toMatchObject({ code: "functions/invalid-argument" });
    const prepared = await call<{ dailyCloseId: string; version: number }>(manager, "prepareDailyClose", { ...input, countedCashMinor: 13_000 });
    dailyCloseId = prepared.dailyCloseId; version = prepared.version;
    await expect(call(manager, "prepareDailyClose", { ...input, countedCashMinor: 13_000 })).resolves.toMatchObject({ version: 1 });
    await expect(call(manager, "prepareDailyClose", { ...input, explanation: "A changed request using an old key." })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect((await adminDb.doc(`dailyCloses/${dailyCloseId}`).get()).get("varianceMinor")).toBe(0);
    expect((await adminDb.collection(`dailyCloses/${dailyCloseId}/revisions`).get()).size).toBe(1);
  });
  it("prevents stale sign-off and lets the same multi-role manager prepare/sign a revised snapshot", async () => {
    await adminDb.doc("journalLines/daily-late-receipt").set({ organizationId, branchId, accountCode: "1010", debitMinor: 100, creditMinor: 0, journalEntryId: "late", effectiveAt: Timestamp.fromDate(new Date("2025-02-05T10:00:00Z")) });
    await expect(call(manager, "signDailyClose", { branchId, date, version, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    const refreshed = await call<{ evidence: { hash: string } }>(manager, "getDailyCloseWorkspace", { branchId, date });
    await expect(call(manager, "prepareDailyClose", { branchId, date, countedCashMinor: 13_100, evidenceHash, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    const prepared = await call<{ version: number }>(manager, "prepareDailyClose", { branchId, date, countedCashMinor: 13_100, evidenceHash: refreshed.evidence.hash, idempotencyKey: crypto.randomUUID() });
    const input = { branchId, date, version: prepared.version, idempotencyKey: crypto.randomUUID() };
    await expect(call(manager, "signDailyClose", input)).resolves.toMatchObject({ signed: true });
    await expect(call(manager, "signDailyClose", input)).resolves.toMatchObject({ signed: true });
    expect((await adminDb.doc(`dailyCloses/${dailyCloseId}/revisions/1`).get()).get("evidence.cash.closingMinor")).toBe(13_000);
    expect((await adminDb.doc(`dailyCloses/${dailyCloseId}/signOffs/2`).get()).exists).toBe(true);
    await expect(call(manager, "prepareDailyClose", { branchId, date, countedCashMinor: 13_100, evidenceHash: refreshed.evidence.hash, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await adminDb.doc("journalLines/daily-after-signoff").set({ organizationId, branchId, accountCode: "1010", debitMinor: 50, creditMinor: 0, journalEntryId: "after-signoff", effectiveAt: Timestamp.fromDate(new Date("2025-02-05T11:00:00Z")) });
    const afterSignOff = await call<{ evidence: { hash: string } }>(manager, "getDailyCloseWorkspace", { branchId, date });
    const revisionInput = { branchId, date, countedCashMinor: 13_150, evidenceHash: afterSignOff.evidence.hash, idempotencyKey: crypto.randomUUID() };
    await expect(call(manager, "prepareDailyClose", revisionInput)).rejects.toMatchObject({ code: "functions/invalid-argument" });
    await expect(call(manager, "prepareDailyClose", { ...revisionInput, explanation: "Late customer receipt was posted after sign-off." })).resolves.toMatchObject({ version: 3 });
    expect((await adminDb.doc(`dailyCloses/${dailyCloseId}/signOffs/2`).get()).get("evidenceHash")).toBe(refreshed.evidence.hash);
    expect((await adminDb.doc(`dailyCloses/${dailyCloseId}/revisions/2`).get()).get("countedCashMinor")).toBe(13_100);
    await adminDb.doc(`users/${manager.auth.currentUser!.uid}`).update({ status: "inactive" });
    await expect(call(manager, "getDailyCloseWorkspace", { branchId, date })).rejects.toMatchObject({ code: "functions/permission-denied" });
  });
});

describe.sequential("bounded dashboard aggregates", () => {
  it("aggregates more than a register page while respecting store, role and organization scope", async () => {
    const branchId = "dashboard-store";
    await adminDb.doc(`branches/${branchId}`).set({ organizationId, name: "Dashboard store", status: "active" });
    const actor = await createActor("dashboard-manager@example.test", "branch_manager");
    await adminDb.doc(`users/${actor.auth.currentUser!.uid}`).update({ branchIds: [branchId] });
    const now = Timestamp.now();
    for (let offset = 0; offset < 1200; offset += 400) {
      const batch = adminDb.batch();
      for (let index = offset; index < offset + 400; index++) batch.set(adminDb.doc(`sales/dashboard-${index}`), { organizationId, branchId, status: "completed", recordedAt: now, grossAmountMinor: 1000, amountPaidMinor: 700, creditAmountMinor: 300, paymentStatus: "partially_paid" });
      await batch.commit();
    }
    await adminDb.doc("sales/dashboard-foreign").set({ organizationId: "other-org", branchId, recordedAt: now, grossAmountMinor: 999999, amountPaidMinor: 999999, creditAmountMinor: 0, paymentStatus: "recorded" });
    await adminDb.doc("sales/dashboard-other").set({ organizationId, branchId: "daily-other-store", recordedAt: now, grossAmountMinor: 500, amountPaidMinor: 500, creditAmountMinor: 0, paymentStatus: "recorded" });
    await adminDb.doc("products/dashboard-product").set({ organizationId, active: true });
    await adminDb.doc("products/dashboard-inactive").set({ organizationId, active: false });
    await adminDb.doc("branchRequests/dashboard-request").set({ organizationId, branchId, status: "submitted" });
    await adminDb.doc("branchRequests/dashboard-complete").set({ organizationId, branchId, status: "closed" });
    await adminDb.doc("stockTransfers/dashboard-transfer").set({ organizationId, sourceBranchId: branchId, destinationBranchId: branchId, status: "problem" });
    await adminDb.doc("transfers/dashboard-old-transfer").set({ organizationId, sourceBranchId: "daily-other-store", destinationBranchId: branchId, status: "dispatched" });
    type Dashboard = { sales: { saleCount: number; grossAmountMinor: number; creditAmountMinor: number } | null; summary: { requests: number | null; transfers: number | null; products: number | null; discrepancies: number | null }; trend: unknown[]; paymentMix: Array<{ label: string; value: number }> };
    const result = await call<Dashboard>(actor, "getDashboardWorkspace", { branchId });
    expect(result.sales).toMatchObject({ saleCount: 1200, grossAmountMinor: 1_200_000, creditAmountMinor: 360_000 });
    expect(result.summary).toMatchObject({ requests: 1, transfers: 2, products: 1, discrepancies: 1 });
    expect(result.paymentMix.find((item) => item.label === "Part-paid")?.value).toBe(1200);
    expect(result.trend).toHaveLength(7);
    expect(JSON.stringify(result).length).toBeLessThan(5000);
    expect(result).not.toHaveProperty("rows");
    await expect(call(actor, "getDashboardWorkspace", { branchId: "daily-other-store" })).rejects.toMatchObject({ code: "functions/permission-denied" });
    const full = await call<Dashboard>(administrator, "getDashboardWorkspace", {});
    expect(full.sales?.saleCount).toBe(1201);
    const custom = await createActor("dashboard-custom@example.test", "branch_manager");
    await adminDb.doc(`users/${custom.auth.currentUser!.uid}`).update({ branchIds: [branchId], directRoleIds: [], customRoleIds: ["limited-role"], effectivePermissions: ["products.read"] });
    const limited = await call<Dashboard>(custom, "getDashboardWorkspace", { branchId });
    expect(limited.sales).toBeNull();
    expect(limited.summary).toEqual({ requests: null, transfers: null, discrepancies: null, products: 1 });
    await expect(call(custom, "getDailyCloseWorkspace", { branchId, date: "2025-02-05" })).rejects.toMatchObject({ code: "functions/permission-denied" });
  });
});
