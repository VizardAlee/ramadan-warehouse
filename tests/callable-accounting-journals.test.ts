import { createHash } from "node:crypto";
import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore as getClientFirestore, collection, getDocs, query, where, doc, getDoc } from "firebase/firestore";
import { loadFinancialBranches } from "@/features/accounting/financial-branches";
import type { UserProfile } from "@/types/domain";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { getApps, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildRoleAssignment, type StoredRole } from "../functions/src/auth/custom-roles";
import { uniquenessDocumentId } from "../functions/src/inventory/calculations";

const projectId = "demo-ramadan-warehouse", organizationId = "manual-journal-test-org", branchId = "journal-store";
const adminApp = getApps().find(app => app.name === "manual-journal-tests") ?? initializeAdminApp({ projectId }, "manual-journal-tests");
const db = getFirestore(adminApp), auth = getAdminAuth(adminApp), apps: FirebaseApp[] = [];
let accountant: ReturnType<typeof client>, restricted: ReturnType<typeof client>, originalId = "";
function client(name: string) {
  const app = initializeApp({ projectId, apiKey: "demo", appId: name }, name); apps.push(app);
  const auth = getAuth(app); connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const functions = getFunctions(app, "us-central1"); connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  const store = getClientFirestore(app); connectFirestoreEmulator(store, "127.0.0.1", 8180);
  return { auth, functions, store };
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
    await db.doc("bankAccounts/journal-bank").update({ branchId: "another-store" });
    await expect(call(value)).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await db.doc("bankAccounts/journal-bank").update({ branchId });
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
  it.each(["operations_administrator", "finance_officer", "auditor"] as const)("keeps a local journal reader scoped with a custom %s base and unrelated sales authority", async base => {
    const target = await actor(`journal-mixed-${base}@example.test`, "branch_manager");
    const role: StoredRole = { id: `journal-mixed-${base}`, organizationId, name: "Procurement and sales reader", baseRoleId: base, permissionIds: ["procurement.read", "sales.read.all"], status: "active" };
    await db.doc(`roles/${role.id}`).set(role);
    await db.doc(`users/${target.auth.currentUser!.uid}`).update(buildRoleAssignment(["branch_manager"], [role]));
    const remote = "journal-remote-store", fromDate = "2025-08-01", toDate = "2025-08-31";
    await db.doc(`branches/${remote}`).set({ organizationId, status: "active", name: "Remote store" });
    for (const [store, amount] of [[branchId, 12345], [remote, 99999]] as const) {
      const entryId = `scope-${base}-${store}`;
      // Reuse one pair across the parameterized actors: no repeated totals.
      if (base === "operations_administrator") {
        await db.doc(`journalEntries/${entryId}`).set({ organizationId, branchId: store, totalDebitMinor: amount, totalCreditMinor: amount, effectiveAt: Timestamp.fromDate(new Date("2025-08-12T12:00:00Z")) });
        for (const [code, debit, credit] of [["6100", amount, 0], ["3000", 0, amount]] as const)
          await db.doc(`journalLines/${entryId}-${code}`).set({ organizationId, branchId: store, journalEntryId: entryId, accountCode: code, accountName: code, debitMinor: debit, creditMinor: credit, effectiveAt: Timestamp.fromDate(new Date("2025-08-12T12:00:00Z")) });
        await db.doc(`budgets/scope-${store}`).set({ organizationId, branchId: store, scopeKey: `store:${store}`, month: "2025-08", accountCode: "6100", amountMinor: 200000 });
        await db.doc(`expenses/scope-${store}`).set({ organizationId, branchId: store, grossAmountMinor: amount });
      }
    }
    await db.doc("bankAccounts/journal-scope-private-bank").set({ organizationId, active: true, bankName: "Scoped bank", accountName: "Company", ledgerAccountCode: "1032", openingBalanceMinor: 987654321 });
    const selector = await call<{ bankAccounts: Array<Record<string, unknown>> }>({ action: "workspace", branchId, fromDate, toDate }, target);
    expect(selector.bankAccounts.find(row => row.id === "journal-scope-private-bank")).not.toHaveProperty("openingBalanceMinor");
    await db.doc("sales/provider-remote-scope").set({ organizationId, branchId: remote, recordedAt: Timestamp.fromDate(new Date("2025-08-12T12:00:00Z")) });
    const filter = { action: "workspace", fromDate, toDate };
    await expect(call({ ...filter, branchId }, target)).resolves.toMatchObject({ entries: [expect.objectContaining({ branchId })] });
    await expect(call({ ...filter, branchId: remote }, target)).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(call(filter, target)).resolves.toMatchObject({ branchId, entries: [expect.objectContaining({ branchId })] });
    await expect(call({ action: "detail", journalEntryId: `scope-operations_administrator-${remote}` }, target)).rejects.toMatchObject({ code: "functions/permission-denied" });
    const statement = { reportType: "income_statement", fromDate, toDate };
    await expect(call({ ...statement, branchId }, target, "generateFinancialStatement")).resolves.toMatchObject({ expenseMinor: 12345, incomeMinor: 0, profitMinor: -12345 });
    await expect(call({ ...statement, branchId: remote }, target, "generateFinancialStatement")).rejects.toMatchObject({ code: "functions/permission-denied" });
    // Omitted branch defaults to the only assigned branch, despite global sales access.
    await expect(call(statement, target, "generateFinancialStatement")).resolves.toMatchObject({ branchId, expenseMinor: 12345 });
    for (const action of ["workspace", "comparison"] as const) {
      const period = action === "workspace" ? { month: "2025-08" } : { fromMonth: "2025-08", toMonth: "2025-08" };
      await expect(call({ action, ...period, branchId }, target, "budgetWorkspace")).resolves.toMatchObject({ rows: [expect.objectContaining({ actualMinor: 12345 })] });
      for (const scope of [{}, { branchId: remote }]) await expect(call({ action, ...period, ...scope }, target, "budgetWorkspace")).rejects.toMatchObject({ code: "functions/permission-denied" });
    }
    await expect(call({ action: "history", budgetId: `scope-${remote}` }, target, "budgetWorkspace")).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(call({ fromDate, toDate }, target, "getTaxWorkspace")).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(call({ branchId }, target, "getExpenseWorkspace")).resolves.toMatchObject({ expenses: [expect.objectContaining({ branchId, grossAmountMinor: 12345 })] });
    await expect(call({ branchId: remote }, target, "getExpenseWorkspace")).rejects.toMatchObject({ code: "functions/permission-denied" });
    const expenseAccess = await call({ view: "access" }, target, "getExpenseWorkspace");
    expect(expenseAccess).toMatchObject({ branchIds: [branchId], warehouseIds: [], organizationPermissions: expect.not.arrayContaining(["expenses.read"]) });
    expect(expenseAccess).not.toHaveProperty("expenses");
    // Exercise real branch rules and the same metadata loader used by the financial screens.
    const metadataAccess = await call<{ branchIds: string[]; permissions: string[]; organizationPermissions: string[] }>({ action: "access" }, target);
    const metadataProfile = (await db.doc(`users/${target.auth.currentUser!.uid}`).get()).data() as UserProfile;
    await expect(getDocs(query(collection(target.store, "branches"), where("organizationId", "==", organizationId)))).rejects.toMatchObject({ code: "permission-denied" });
    await expect(getDoc(doc(target.store, "branches", remote))).rejects.toMatchObject({ code: "permission-denied" });
    const metadata = await loadFinancialBranches(target.store, metadataProfile, metadataAccess, cursor => call({ action: "locations", ...(cursor ? { cursor } : {}) }, target, "getDailyCloseWorkspace"));
    expect(metadata.map(branch => branch.id)).toEqual([branchId]);
    const providerPeriod = { action: "workspace", fromDate, toDate };
    await expect(call({ ...providerPeriod, branchId }, target, "providerFunds")).resolves.toMatchObject({ branchId, rows: [], summary: { outstandingMinor: 0 } });
    await expect(call({ ...providerPeriod, branchId: remote }, target, "providerFunds")).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(call({ action: "detail", saleId: "provider-remote-scope" }, target, "providerFunds")).rejects.toMatchObject({ code: "functions/permission-denied" });
    const remoteProviderRetry = { action: "settle", saleId: "provider-remote-scope", componentId: "provider-scope-line", method: "cash", amountMinor: 1, reference: "SCOPE-REF", reason: "Synthetic retry scope verification", idempotencyKey: crypto.randomUUID() };
    await db.doc(`idempotencyOperations/${uniquenessDocumentId(organizationId, "providerFunds", remoteProviderRetry.idempotencyKey)}`).set({ organizationId, fingerprint: createHash("sha256").update(JSON.stringify(remoteProviderRetry)).digest("hex"), result: { paymentId: "remote-existing-payment" } });
    await expect(call(remoteProviderRetry, target, "providerFunds")).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(call({ action: "access" }, target)).resolves.toMatchObject({ organizationPermissions: expect.not.arrayContaining(["finance.journal.read"]) });
    if (base === "finance_officer") {
      // Current explicit finance permission is enough; sales.read.all is not required.
      await db.doc(`roles/${role.id}`).update({ permissionIds: ["finance.journal.read", "banking.read", "accounting.close.read"] });
      await expect(call(statement, target, "generateFinancialStatement")).resolves.toMatchObject({ branchId: null, expenseMinor: 112344, incomeMinor: 0, profitMinor: -112344 });
      await expect(call({ ...filter, branchId: remote }, target)).resolves.toMatchObject({ entries: [expect.objectContaining({ branchId: remote })] });
      await expect(call({ fromDate, toDate }, target, "getTaxWorkspace")).resolves.toMatchObject({ vat: { calculatedLiabilityMinor: 0 } });
      await expect(call({}, target, "getBankReconciliationWorkspace")).resolves.toMatchObject({ accounts: expect.any(Array) });
      await expect(call({ periodKey: "2025-08" }, target, "getAccountingCloseWorkspace")).resolves.toBeDefined();
      // No profile refresh: the next callable must observe the revoked global grant.
      await db.doc(`roles/${role.id}`).update({ permissionIds: ["procurement.read"] });
      await expect(call({ ...statement, branchId: remote }, target, "generateFinancialStatement")).rejects.toMatchObject({ code: "functions/permission-denied" });
      await expect(call({ ...statement, branchId }, target, "generateFinancialStatement")).resolves.toMatchObject({ expenseMinor: 12345 });
      await expect(call({}, target, "getBankReconciliationWorkspace")).rejects.toMatchObject({ code: "functions/permission-denied" });
      await expect(call({ periodKey: "2025-08" }, target, "getAccountingCloseWorkspace")).rejects.toMatchObject({ code: "functions/permission-denied" });
      // Location metadata may support an explicit global creation grant without returning remote financial records.
      await db.doc(`roles/${role.id}`).update({ permissionIds: ["expenses.create"] });
      await expect(call({ branchId }, target, "getExpenseWorkspace")).resolves.toMatchObject({ branches: expect.arrayContaining([expect.objectContaining({ id: remote })]), expenses: [expect.objectContaining({ branchId })] });
      await expect(call({ branchId: remote }, target, "getExpenseWorkspace")).rejects.toMatchObject({ code: "functions/permission-denied" });
    }
    await expect(call({ ...statement, branchId: remote }, accountant, "generateFinancialStatement")).resolves.toMatchObject({ expenseMinor: 99999, incomeMinor: 0, profitMinor: -99999 });
  });

});


describe("finance branch picker existing-access integration", () => {
  it("lets an unassigned ordinary finance officer choose an already-authorized store for synthetic journal posting and reversal", async () => {
    const target = await actor("unassigned-finance-picker@example.test", "finance_officer");
    const userRef = db.doc(`users/${target.auth.currentUser!.uid}`);
    await userRef.update({ branchIds: [] });
    const profile = (await userRef.get()).data() as UserProfile;
    const access = await call<{ branchIds: string[]; permissions: string[]; organizationPermissions: string[] }>({ action: "access" }, target);
    await expect(getDocs(query(collection(target.store, "branches"), where("organizationId", "==", organizationId)))).rejects.toMatchObject({ code: "permission-denied" });
    const options = await loadFinancialBranches(target.store, profile, access, cursor => call({ action: "locations", ...(cursor ? { cursor } : {}) }, target, "getDailyCloseWorkspace"));
    expect(options).toEqual(expect.arrayContaining([{ id: branchId, name: "Head Office" }]));
    const selected = options.find(branch => branch.id === branchId)!;
    // Earlier cases close March and deactivate account6100. Keep this workflow fixture independent.
    for (const [code, name] of [["6205", "Picker depreciation expense"], ["1595", "Picker accumulated depreciation"]])
      await call({ action: "save_account", code, name, active: true, reason: "Create independent synthetic picker accounts", idempotencyKey: crypto.randomUUID() }, target);
    const posted = await call<{ journalEntryId: string }>({ ...instructions(), branchId: selected.id, effectiveAt: "2025-09-15T12:00:00Z", reference: "PICKER-POST", lines: [
      { accountId: accountId("6205"), debitMinor: 50000, creditMinor: 0 }, { accountId: accountId("1595"), debitMinor: 0, creditMinor: 50000 },
    ] }, target);
    expect((await db.doc(`journalEntries/${posted.journalEntryId}`).get()).get("branchId")).toBe(selected.id);
    const reversed = await call<{ journalEntryId: string }>({ action: "reverse", branchId: selected.id, journalEntryId: posted.journalEntryId, effectiveAt: "2025-09-20T12:00:00Z", reference: "PICKER-REV", reason: "Synthetic picker reversal verification", idempotencyKey: crypto.randomUUID() }, target);
    expect((await db.doc(`journalEntries/${reversed.journalEntryId}`).get()).get("branchId")).toBe(selected.id);
  });
  it("does not grant remote branch metadata to a global financial custom role lacking existing metadata authority", async () => {
    const target = await actor("global-finance-metadata@example.test", "branch_manager");
    const role: StoredRole = { id: "global-finance-metadata-role", organizationId, name: "Financial reader", baseRoleId: "finance_officer", permissionIds: ["finance.journal.read"], status: "active" };
    await db.doc(`roles/${role.id}`).set(role);
    const userRef = db.doc(`users/${target.auth.currentUser!.uid}`);
    await userRef.update(buildRoleAssignment([], [role]));
    const profile = (await userRef.get()).data() as UserProfile;
    const access = await call<{ branchIds: string[]; permissions: string[]; organizationPermissions: string[] }>({ action: "access" }, target);
    expect(access.organizationPermissions).toContain("finance.journal.read");
    const options = await loadFinancialBranches(target.store, profile, access, async () => { throw new Error("Daily-close metadata permission was not granted."); });
    expect(options.map(branch => branch.id)).toEqual([branchId]);
    await expect(getDoc(doc(target.store, "branches", "journal-remote-store"))).rejects.toMatchObject({ code: "permission-denied" });
  });
});
