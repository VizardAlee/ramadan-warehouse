import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { getApps, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uniquenessDocumentId } from "../functions/src/inventory/calculations";

const projectId = "demo-ramadan-warehouse", organizationId = "manual-journal-test-org", branchId = "journal-store";
const adminApp = getApps().find(app => app.name === "manual-journal-tests") ?? initializeAdminApp({ projectId }, "manual-journal-tests");
const db = getFirestore(adminApp), auth = getAdminAuth(adminApp), apps: FirebaseApp[] = [];
let accountant: ReturnType<typeof client>, restricted: ReturnType<typeof client>, originalId = "";
function client(name: string) {
  const app = initializeApp({ projectId, apiKey: "demo", appId: name }, name); apps.push(app);
  const auth = getAuth(app); connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const functions = getFunctions(app, "us-central1"); connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  return { auth, functions };
}
async function actor(email: string, roleId: string) {
  const user = await auth.createUser({ email, password: "Password!234567" });
  await db.doc(`users/${user.uid}`).set({ uid: user.uid, organizationId, roleId, branchIds: [branchId], warehouseIds: [], email, status: "active", authDisabled: false, authorizationVersion: 1, createdAt: FieldValue.serverTimestamp() });
  const result = client(email); await signInWithEmailAndPassword(result.auth, email, "Password!234567"); return result;
}
async function call<T = Record<string, unknown>>(data: Record<string, unknown>, target = accountant, name = "accountingJournals") { return (await httpsCallable(target.functions, name)(data)).data as T; }
const accountId = (code: string) => uniquenessDocumentId(organizationId, code);
const instructions = () => ({ action: "post", branchId, effectiveAt: "2025-03-15T12:00:00Z", reference: "DEP-MAR-001", reason: "Reviewed monthly depreciation", purpose: "depreciation", cashFlowActivity: "operating", idempotencyKey: crypto.randomUUID(), lines: [
  { accountId: accountId("6100"), debitMinor: 50000, creditMinor: 0 }, { accountId: accountId("1590"), debitMinor: 0, creditMinor: 50000 },
] });
beforeAll(async () => {
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${projectId}/accounts`, { method: "DELETE" });
  await fetch(`http://127.0.0.1:8180/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" });
  await db.doc(`organizations/${organizationId}`).set({ name: "Journal test", status: "active" });
  await db.doc(`branches/${branchId}`).set({ organizationId, status: "active", name: "Head Office" });
  accountant = await actor("journal-finance@example.test", "finance_officer"); restricted = await actor("journal-cashier@example.test", "sales_cashier");
  for (const [code, name] of [["6100", "Depreciation expense"], ["1590", "Accumulated depreciation"]]) await call({ action: "save_account", code, name, active: true, reason: "Create reviewed accountant ledger", idempotencyKey: crypto.randomUUID() });
});
afterAll(async () => Promise.all(apps.map(app => deleteApp(app))));
describe.sequential("trusted manual journal workflow", () => {
  it("posts exactly once under concurrency without changing configured account metadata", async () => {
    const input = instructions();
    const results = await Promise.all([call<{ journalEntryId: string }>(input), call<{ journalEntryId: string }>(input)]);
    originalId = results[0]!.journalEntryId; expect(results[1]!.journalEntryId).toBe(originalId);
    const entry = await db.doc(`journalEntries/${originalId}`).get();
    expect(entry.data()).toMatchObject({ journalType: "manual_adjustment", status: "posted", totalDebitMinor: 50000, totalCreditMinor: 50000, cashFlowActivity: "operating" });
    const lines = await db.collection("journalLines").where("journalEntryId", "==", originalId).get(); expect(lines.size).toBe(2);
    expect((await db.doc(`chartOfAccounts/${accountId("6100")}`).get()).data()).toMatchObject({ name: "Depreciation expense", systemManaged: false, active: true });
    expect((await db.collection("auditLogs").where("entityId", "==", originalId).get()).size).toBe(1);
    await expect(call({ ...input, reason: "Changed retry instructions" })).rejects.toMatchObject({ code: "functions/failed-precondition" });
  });
  it("uses one linked opposite journal and retains original posted history", async () => {
    await db.doc(`accountingPeriods/${uniquenessDocumentId(organizationId, "2025-03")}`).set({ organizationId, periodKey: "2025-03", status: "closed" });
    await db.doc(`chartOfAccounts/${accountId("6100")}`).update({ active: false });
    const input = { action: "reverse", branchId, journalEntryId: originalId, effectiveAt: "2025-04-01T12:00:00Z", reference: "CORRECTION-1", reason: "Reverse incorrect depreciation", idempotencyKey: crypto.randomUUID() };
    const [first, second] = await Promise.all([call<{ journalEntryId: string }>(input), call<{ journalEntryId: string }>(input)]); expect(first).toEqual(second);
    const original = await db.doc(`journalEntries/${originalId}`).get(), reversal = await db.doc(`journalEntries/${first.journalEntryId}`).get();
    expect(original.data()).toMatchObject({ status: "posted", totalDebitMinor: 50000, reversalJournalEntryId: first.journalEntryId });
    expect(reversal.data()).toMatchObject({ journalType: "manual_reversal", referenceId: originalId, cashFlowActivity: "operating" });
    const lines = await db.collection("journalLines").where("journalEntryId", "==", first.journalEntryId).get();
    expect(lines.docs.find(line => line.get("accountCode") === "6100")?.get("creditMinor")).toBe(50000);
    await expect(call({ ...input, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await expect(call({ ...input, journalEntryId: first.journalEntryId, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
  });
  it("denies restricted roles, control accounts, unsafe/closed periods and operational reversals", async () => {
    await expect(call(instructions(), restricted)).rejects.toMatchObject({ code: "functions/permission-denied" });
    for (const code of ["1100", "1200", "1250", "2100", "2000", "2210", "3999", "1031"]) await expect(call({ action: "save_account", code, name: "Forbidden control", active: true, reason: "Attempt unsafe account", idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await db.doc(`chartOfAccounts/${accountId("1200")}`).set({ organizationId, code: "1200", name: "Inventory", active: true });
    const value = { ...instructions(), effectiveAt: "2025-06-01T12:00:00Z" }; await expect(call({ ...value, lines: [{ ...value.lines[0], accountId: accountId("1200") }, value.lines[1]] })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await db.doc("chartOfAccounts/foreign-manual-account").set({ organizationId: "foreign", code: "6100", name: "Foreign expense", active: true });
    await expect(call({ ...value, lines: [{ ...value.lines[0], accountId: "foreign-manual-account" }, value.lines[1]] })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await db.doc("chartOfAccounts/usd-manual-account").set({ organizationId, code: "6101", name: "Foreign currency expense", active: true, currency: "USD" });
    await expect(call({ ...value, lines: [{ ...value.lines[0], accountId: "usd-manual-account" }, value.lines[1]] })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await db.doc(`accountingPeriods/${uniquenessDocumentId(organizationId, "2025-05")}`).set({ organizationId, periodKey: "2025-05", status: "prepared" });
    await expect(call({ ...instructions(), effectiveAt: "2025-05-01T12:00:00Z" })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await db.doc("journalEntries/automatic-journal").set({ organizationId, branchId, journalType: "branch_sale", status: "posted" });
    await expect(call({ action: "reverse", branchId, journalEntryId: "automatic-journal", effectiveAt: "2025-06-01T12:00:00Z", reference: "BAD-1", reason: "Cannot bypass sale reversal", idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
  });
  it("links money lines to company accounts and preserves explicit cash-flow classification", async () => {
    await db.doc(`chartOfAccounts/${accountId("1031")}`).set({ organizationId, code: "1031", name: "Company Bank", active: true });
    await db.doc("bankAccounts/journal-bank").set({ organizationId, active: true, accountName: "Company Bank", ledgerAccountCode: "1031" });
    await call({ action: "save_account", code: "3000", name: "Owner capital", active: true, reason: "Set up capital account", idempotencyKey: crypto.randomUUID() });
    const value = { ...instructions(), effectiveAt: "2025-06-01T12:00:00Z", purpose: "opening_balance", cashFlowActivity: "financing", lines: [
      { accountId: accountId("1031"), debitMinor: 100000, creditMinor: 0, bankAccountId: "journal-bank" }, { accountId: accountId("3000"), debitMinor: 0, creditMinor: 100000 },
    ] };
    await expect(call({ ...value, lines: [{ accountId: accountId("1031"), debitMinor: 100000, creditMinor: 0 }, value.lines[1]] })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await db.doc("bankAccounts/journal-shared-code").set({ organizationId, active: true, accountName: "Ambiguous bank", ledgerAccountCode: "1031" });
    await expect(call(value)).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await db.doc("bankAccounts/journal-shared-code").update({ active: false });
    const posted = await call<{ journalEntryId: string }>(value);
    const moneyLines = await db.collection("journalLines").where("journalEntryId", "==", posted.journalEntryId).get();
    expect(moneyLines.docs.find(line => line.get("accountCode") === "1031")?.get("bankAccountId")).toBe("journal-bank");
    const statement = await call<{ rows: Array<{ section: string; amountMinor: number }> }>({ reportType: "cash_flow", fromDate: "2025-06-01", toDate: "2025-06-30", branchId }, accountant, "generateFinancialStatement");
    expect(statement.rows.find(row => row.section === "Financing activities")?.amountMinor).toBe(100000);
    expect(statement.rows.find(row => row.section === "Operating activities")?.amountMinor).toBe(0);
  });
  it("pages journals, validates cursor scope and prevents foreign detail access", async () => {
    const batch = db.batch(); for (let index = 0; index < 27; index++) batch.set(db.doc(`journalEntries/paged-${index}`), { organizationId, branchId, journalNumber: `JRN-PAGE-${index}`, effectiveAt: Timestamp.fromDate(new Date("2025-07-01T12:00:00Z")) }); await batch.commit();
    const filter = { action: "workspace", branchId, fromDate: "2025-07-01", toDate: "2025-07-31", pageSize: 25 };
    const first = await call<{ entries: Array<{ id: string }>; nextCursorId: string }>(filter), second = await call<{ entries: Array<{ id: string }>; nextCursorId: string | null }>({ ...filter, cursorId: first.nextCursorId });
    expect(first.entries).toHaveLength(25); expect(second.entries).toHaveLength(2); expect(second.nextCursorId).toBeNull();
    expect(new Set([...first.entries, ...second.entries].map(entry => entry.id)).size).toBe(27);
    await expect(call({ ...filter, cursorId: originalId })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    await db.doc("journalEntries/foreign-journal").set({ organizationId: "foreign", branchId, effectiveAt: Timestamp.now() });
    await expect(call({ action: "detail", journalEntryId: "foreign-journal" })).rejects.toMatchObject({ code: "functions/not-found" });
    await expect(call({ action: "detail", journalEntryId: originalId })).resolves.toMatchObject({ entry: { id: originalId }, lines: expect.any(Array), truncated: false });
  });
});
