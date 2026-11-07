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
  await adminDb.doc(`organizations/${organizationId}`).set({ name: "Banking test organization", status: "active" });
  administrator = await createActor("bank-admin@example.test", "system_administrator");
  financeOfficer = await createActor("bank-finance@example.test", "finance_officer");

});
afterAll(async () => Promise.all(apps.map((app) => deleteApp(app))));

describe.sequential("bank reconciliation callables", () => {
  it("atomically posts both transfer sides, preserves account configuration and safely replays concurrent requests", async () => {
    for (const [id, ledgerAccountCode] of [["transfer-from", "1032"], ["transfer-to", "1033"]])
      await adminDb.doc(`bankAccounts/${id}`).set({ organizationId, active: true, bankName: "Test Bank", accountName: id, ledgerAccountCode, openingBalanceMinor: 500000 });
    await adminDb.doc("branches/transfer-store").set({ organizationId, status: "active", name: "Head Office" });
    const input = { sourceBankAccountId: "transfer-from", destinationBankAccountId: "transfer-to", branchId: "transfer-store",
      amountMinor: 200000, transferredAt: "2026-10-09T09:00:00Z", reference: "BANK-TRANSFER-1", reason: "Move completed reserve transfer", confirmedCompleted: true, idempotencyKey: crypto.randomUUID() };
    const [first, replay] = await Promise.all([call<{ journalEntryId: string; journalNumber: string }>(financeOfficer, "recordCompanyFundsTransfer", input), call(financeOfficer, "recordCompanyFundsTransfer", input)]);
    expect(replay).toEqual(first);
    const journal = await adminDb.doc(`journalEntries/${first.journalEntryId}`).get();
    expect(journal.data()).toMatchObject({ journalType: "internal_funds_transfer", totalDebitMinor: 200000, totalCreditMinor: 200000, branchId: "transfer-store", details: { sourceBankAccountId: "transfer-from", destinationBankAccountId: "transfer-to" } });
    const lines = await adminDb.collection("journalLines").where("journalEntryId", "==", first.journalEntryId).get();
    expect(lines.size).toBe(2);
    expect(lines.docs.map(line => [line.get("accountCode"), line.get("debitMinor"), line.get("creditMinor")]).sort()).toEqual([["1032", 0, 200000], ["1033", 200000, 0]]);
    expect((await adminDb.doc("bankAccounts/transfer-from").get()).get("openingBalanceMinor")).toBe(500000);
    expect((await adminDb.collection("auditLogs").where("entityId", "==", first.journalEntryId).get()).size).toBe(1);
    const reportInput = { fromDate: "2026-10-09", toDate: "2026-10-09", branchId: "transfer-store" };
    await expect(call(financeOfficer, "generateFinancialStatement", { ...reportInput, reportType: "cash_flow" })).resolves.toMatchObject({ netCashMovementMinor: 0 });
    await expect(call(financeOfficer, "generateFinancialStatement", { ...reportInput, reportType: "income_statement" })).resolves.toMatchObject({ incomeMinor: 0, expenseMinor: 0, profitMinor: 0 });
    await expect(call(financeOfficer, "recordCompanyFundsTransfer", { ...input, amountMinor: 200001 })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await adminDb.doc("bankAccounts/transfer-from").update({ active: false });
    // A confirmed historic result is still retrievable after account deactivation.
    await expect(call(financeOfficer, "recordCompanyFundsTransfer", input)).resolves.toEqual(first);
  });

  it("rejects unauthorized roles, foreign/inactive accounts, shared ledger codes and locked months without posting", async () => {
    const restricted = await createActor("bank-restricted@example.test", "finance_officer");
    await adminDb.doc("roles/restricted").set({ id: "restricted", organizationId, name: "Read-only banking", baseRoleId: "finance_officer", permissionIds: ["banking.read"], status: "active" });
    await adminDb.doc(`users/${restricted.auth.currentUser!.uid}`).update({ directRoleIds: [], customRoleIds: ["restricted"], effectivePermissions: ["banking.read"] });
    const base = { sourceBankAccountId: "transfer-from", destinationBankAccountId: "transfer-to", branchId: "transfer-store", amountMinor: 1000,
      transferredAt: "2026-10-09T09:00:00Z", reference: "BANK-TRANSFER-2", reason: "Move reserve funds", confirmedCompleted: true };
    const post = (change = {}) => call(financeOfficer, "recordCompanyFundsTransfer", { ...base, ...change, idempotencyKey: crypto.randomUUID() });
    await expect(call(restricted, "recordCompanyFundsTransfer", { ...base, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/permission-denied" });
    const count = (await adminDb.collection("journalEntries").where("journalType", "==", "internal_funds_transfer").get()).size;
    await expect(post()).rejects.toMatchObject({ code: "functions/failed-precondition" }); // inactive source
    await adminDb.doc("bankAccounts/transfer-from").update({ active: true });
    await adminDb.doc("bankAccounts/transfer-to").update({ organizationId: "other-org" });
    await expect(post()).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await adminDb.doc("bankAccounts/transfer-to").update({ organizationId, ledgerAccountCode: "1032" });
    await expect(post()).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await adminDb.doc("bankAccounts/transfer-to").update({ ledgerAccountCode: "1033" });
    const { uniquenessDocumentId } = await import("../functions/src/inventory/calculations");
    const period = adminDb.doc(`accountingPeriods/${uniquenessDocumentId(organizationId, "2026-10")}`);
    await period.set({ organizationId, periodKey: "2026-10", status: "prepared" });
    await expect(post()).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await period.delete();
    await expect(post({ transferredAt: "2099-01-01T00:00:00Z" })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    expect((await adminDb.collection("journalEntries").where("journalType", "==", "internal_funds_transfer").get()).size).toBe(count);
  });

  it("imports, matches, independently closes, and freezes reconciled evidence", async () => {
    const account = await call<{ bankAccountId: string }>(financeOfficer, "saveBankAccount", { bankName: "Access Bank", accountName: "ABR operating account", accountNumberLast4: "4321", ledgerAccountCode: "1030", openingBalanceMinor: 100_000, openingDate: "2026-08-01", active: true });
  const effectiveAt = Timestamp.fromDate(new Date("2026-08-02T00:00:00.000Z"));
  await adminDb.doc("journalLines/bank-credit-line").set({ organizationId, journalEntryId: "journal-bank-credit", journalNumber: "JRN-2026-000001", accountCode: "1030", accountName: "Bank transfer clearing", debitMinor: 0, creditMinor: 20_000, currency: "NGN", effectiveAt, createdAt: effectiveAt });
  await adminDb.doc("journalLines/wrong-credit-line").set({ organizationId, journalEntryId: "journal-wrong-credit", journalNumber: "JRN-2026-000002", accountCode: "1030", accountName: "Bank transfer clearing", debitMinor: 0, creditMinor: 10_000, currency: "NGN", effectiveAt, createdAt: effectiveAt });
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

describe.sequential("recoverable financial account lifecycle and reviewed openings", () => {
  let nextCode = 1050;
  const save = (code = String(nextCode++)) => ({ bankName: "Synthetic Bank", accountName: `Lifecycle ${code}`, accountNumberLast4: "2222", ledgerAccountCode: code, openingBalanceMinor: 0, openingDate: "2025-01-01", active: true });
  const lifecycle = (bankAccountId: string, action: string) => call(financeOfficer, "saveBankAccount", { action, bankAccountId, reason: "Reviewed synthetic lifecycle change", idempotencyKey: crypto.randomUUID() });
  async function bank() {
    const input = save();
    const result = await call<{ bankAccountId: string }>(financeOfficer, "saveBankAccount", input);
    return { ...result, input };
  }
  const opening = (bankAccountId: string, counterpartAccountId: string) => ({ action: "bank_opening", bankAccountId, counterpartAccountId, branchId: "opening-store", effectiveAt: "2025-01-01T00:00:00Z", amountMinor: 150000, reference: "Reviewed starting bank statement", reason: "Accountant reviewed prior balances and counterpart", confirmedNoPreviousOpening: true, idempotencyKey: crypto.randomUUID() });
  let counterpartId: string;
  beforeAll(async () => {
    await adminDb.doc("branches/opening-store").set({ organizationId, name: "Opening store", status: "active" });
    const result = await call<{ accountId: string }>(financeOfficer, "accountingJournals", { action: "save_account", code: "3015", name: "Reviewed opening equity", active: true, reason: "Reviewed synthetic opening account", idempotencyKey: crypto.randomUUID() });
    counterpartId = result.accountId;
  });
  it("creates a usable chart account without posting and reserves its code through removal/restoration", async () => {
    const account = await bank();
    const chart = await adminDb.collection("chartOfAccounts").where("organizationId", "==", organizationId).where("code", "==", account.input.ledgerAccountCode).get();
    expect(chart.size).toBe(1);
    expect(chart.docs[0]!.data()).toMatchObject({ active: true, bankAccountId: account.bankAccountId, currency: "NGN" });
    await expect(lifecycle(account.bankAccountId, "lifecycle_preview")).resolves.toMatchObject({ removalMode: "remove", hasDependencies: false });
    await expect(lifecycle(account.bankAccountId, "remove")).resolves.toMatchObject({ lifecycleStatus: "removed" });
    expect((await adminDb.doc(`bankAccounts/${account.bankAccountId}`).get()).exists).toBe(true);
    await expect(call(financeOfficer, "saveBankAccount", account.input)).rejects.toMatchObject({ code: "functions/already-exists" });
    await expect(call(financeOfficer, "saveBankAccount", { ...account.input, bankAccountId: account.bankAccountId })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await expect(lifecycle(account.bankAccountId, "restore")).resolves.toMatchObject({ lifecycleStatus: "active" });
  });
  it("archives direct unposted references, code-only legacy ledger lines, statements and reconciliations without deleting history", async () => {
    for (const kind of ["saleReturns", "journalEntries", "journalLines", "bankStatementTransactions", "bankReconciliations"]) {
      const account = await bank();
      const ref = adminDb.collection(kind).doc();
      await ref.set({ organizationId, ...(kind === "journalLines" ? { accountCode: account.input.ledgerAccountCode } : kind === "journalEntries" ? { details: { bankAccounts: [{ accountCode: account.input.ledgerAccountCode }] } } : { bankAccountId: account.bankAccountId }) });
      await expect(lifecycle(account.bankAccountId, "remove")).resolves.toMatchObject({ lifecycleStatus: "archived", hasDependencies: true });
      expect((await ref.get()).exists).toBe(true);
      await expect(lifecycle(account.bankAccountId, "restore")).resolves.toMatchObject({ lifecycleStatus: "active" });
    }
  });
  it("archives nested held-order and financial audit-only references without treating creation audits as financial usage", async () => {
    const orderBank = await bank();
    await adminDb.collection("salesOrders").add({ organizationId, status: "held", payload: { payments: [{ bankAccountId: orderBank.bankAccountId, amountMinor: 100 }] } });
    await expect(lifecycle(orderBank.bankAccountId, "remove")).resolves.toMatchObject({ lifecycleStatus: "archived" });
    for (const sourceFunction of ["recordSupplierPayment", "accountingJournals"]) {
      const auditBank = await bank();
      await adminDb.collection("auditLogs").add({ organizationId, sourceFunction, after: { tenders: [{ ledgerAccountCode: auditBank.input.ledgerAccountCode }] } });
      await expect(lifecycle(auditBank.bankAccountId, "remove")).resolves.toMatchObject({ lifecycleStatus: "archived" });
    }
    const unused = await bank();
    await expect(lifecycle(unused.bankAccountId, "remove")).resolves.toMatchObject({ lifecycleStatus: "removed", hasDependencies: false });
  });
  it("posts signed reviewed openings exactly once under concurrent retries, keeps metadata and reports opening separately", async () => {
    for (const amountMinor of [150000, -25000]) {
      const account = await bank();
      const input = { ...opening(account.bankAccountId, counterpartId), amountMinor };
      const [first, replay] = await Promise.all([call(financeOfficer, "accountingJournals", input), call(financeOfficer, "accountingJournals", input)]);
      expect(first).toEqual(replay);
      await expect(call(financeOfficer, "prepareBankReconciliation", { bankAccountId: account.bankAccountId, periodStart: "2025-01-01", periodEnd: "2025-01-31", openingBalanceMinor: amountMinor, closingBalanceMinor: amountMinor, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition", details: { code: "OPERATIONAL_EVIDENCE_ACTION_REQUIRED" } });

      await expect(call(financeOfficer, "accountingJournals", { ...input, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
      const lines = await adminDb.collection("journalLines").where("journalEntryId", "==", first.journalEntryId).get();
      expect(lines.size).toBe(2);
      const bankLine = lines.docs.find(line => line.get("bankAccountId") === account.bankAccountId)!;
      expect(bankLine.get("debitMinor") - bankLine.get("creditMinor")).toBe(amountMinor);
      await call(financeOfficer, "saveBankAccount", { ...account.input, bankAccountId: account.bankAccountId, accountName: "Updated display name" });
      expect((await adminDb.doc(`bankAccounts/${account.bankAccountId}`).get()).get("openingJournalEntryId")).toBe(first.journalEntryId);
      await expect(call(financeOfficer, "saveBankAccount", { ...account.input, bankAccountId: account.bankAccountId, openingBalanceMinor: 999 })).rejects.toMatchObject({ code: "functions/failed-precondition" });

      await expect(lifecycle(account.bankAccountId, "remove")).resolves.toMatchObject({ lifecycleStatus: "archived" });
      await expect(call(financeOfficer, "recordCompanyFundsTransfer", { sourceBankAccountId: account.bankAccountId, destinationBankAccountId: "transfer-to", branchId: "opening-store", amountMinor: 100, transferredAt: "2025-02-01T00:00:00Z", reference: "Blocked inactive posting", reason: "Synthetic inactive test", confirmedCompleted: true, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
      await lifecycle(account.bankAccountId, "restore");
      await call(financeOfficer, "accountingJournals", { action: "reverse", journalEntryId: first.journalEntryId, branchId: "opening-store", effectiveAt: "2025-02-01T00:00:00Z", reference: "Opening correction reversal", reason: "Reviewed reversal preserves original evidence", idempotencyKey: crypto.randomUUID() });
      await expect(call(financeOfficer, "accountingJournals", { ...input, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    }
    const report = { fromDate: "2025-01-01", toDate: "2025-01-31", branchId: "opening-store" };
    await expect(call(financeOfficer, "generateFinancialStatement", { ...report, reportType: "income_statement" })).resolves.toMatchObject({ incomeMinor: 0, profitMinor: 0 });
    await expect(call(financeOfficer, "generateFinancialStatement", { ...report, reportType: "receipts_payments" })).resolves.toMatchObject({ receiptsMinor: 0, paymentsMinor: 0, netCashMovementMinor: 0, openingBalanceMinor: 125000 });
  });
  it("permits only one opening under distinct simultaneous keys and blocks historical baseline conflicts", async () => {
    const account = await bank();
    const attempts = await Promise.allSettled([call(financeOfficer, "accountingJournals", opening(account.bankAccountId, counterpartId)), call(financeOfficer, "accountingJournals", opening(account.bankAccountId, counterpartId))]);
    expect(attempts.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter(result => result.status === "rejected")).toHaveLength(1);
    const baseline = await bank();
    await adminDb.doc(`bankAccounts/${baseline.bankAccountId}`).update({ openingBalanceMinor: 100 });
    await expect(call(financeOfficer, "accountingJournals", opening(baseline.bankAccountId, counterpartId))).rejects.toMatchObject({ code: "functions/failed-precondition" });
    const reconciled = await bank();
    await adminDb.collection("bankReconciliations").add({ organizationId, bankAccountId: reconciled.bankAccountId, periodStart: "2025-03-01", status: "closed" });
    await expect(call(financeOfficer, "accountingJournals", opening(reconciled.bankAccountId, counterpartId))).rejects.toMatchObject({ code: "functions/failed-precondition" });
  });
  it("uses Nigerian dates for a nonzero baseline and rejects orphan headers and wrong restore mapping", async () => {
    const input = { ...save(), openingBalanceMinor: 700, openingDate: "2025-01-01" };
    const account = await call<{ bankAccountId: string }>(financeOfficer, "saveBankAccount", input);
    await expect(call(financeOfficer, "accountingJournals", { ...opening(account.bankAccountId, counterpartId), amountMinor: 700, effectiveAt: "2024-12-31T23:30:00Z" })).resolves.toMatchObject({ posted: true });
    const orphan = await bank();
    const header = adminDb.collection("journalEntries").doc();
    await header.set({ organizationId, journalType: "manual_adjustment", status: "posted", details: { purpose: "opening_balance", bankAccounts: [{ bankAccountId: orphan.bankAccountId, accountCode: orphan.input.ledgerAccountCode }] } });
    await expect(call(financeOfficer, "accountingJournals", opening(orphan.bankAccountId, counterpartId))).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await expect(lifecycle(orphan.bankAccountId, "remove")).resolves.toMatchObject({ lifecycleStatus: "archived" });
    const restore = await bank();
    await lifecycle(restore.bankAccountId, "remove");
    const chart = await adminDb.collection("chartOfAccounts").where("organizationId", "==", organizationId).where("code", "==", restore.input.ledgerAccountCode).get();
    await chart.docs[0]!.ref.update({ bankAccountId: "wrong-bank-owner" });
    await expect(lifecycle(restore.bankAccountId, "restore")).rejects.toMatchObject({ code: "functions/failed-precondition" });
  });
  it("rejects missing confirmation, foreign accounts, unauthorized actors, future dates, locked periods and prior legacy openings", async () => {
    const account = await bank();
    const base = opening(account.bankAccountId, counterpartId);
    const restricted = await createActor("opening-cashier@example.test", "sales_cashier");
    await expect(call(restricted, "accountingJournals", base)).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(call(restricted, "saveBankAccount", { action: "remove", bankAccountId: account.bankAccountId, reason: "Unauthorized synthetic removal", idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/permission-denied" });
    await adminDb.doc("branches/other-opening-store").set({ organizationId, name: "Other store", status: "active" });
    await expect(call(financeOfficer, "accountingJournals", { ...base, operatingContext: { type: "branch", id: "other-opening-store" } })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await adminDb.doc(`bankAccounts/${account.bankAccountId}`).update({ branchId: "other-opening-store" });
    await expect(call(financeOfficer, "accountingJournals", base)).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await adminDb.doc(`bankAccounts/${account.bankAccountId}`).update({ branchId: FieldValue.delete() });
    await adminDb.doc("chartOfAccounts/foreign-opening-counterpart").set({ organizationId: "foreign", code: "3015", currency: "NGN", active: true, name: "Foreign equity" });
    await expect(call(financeOfficer, "accountingJournals", { ...base, counterpartAccountId: "foreign-opening-counterpart" })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await expect(call(financeOfficer, "accountingJournals", { ...base, confirmedNoPreviousOpening: false })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    await expect(call(financeOfficer, "accountingJournals", { ...base, effectiveAt: "2099-01-01T00:00:00Z" })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    const { uniquenessDocumentId } = await import("../functions/src/inventory/calculations");
    const period = adminDb.doc(`accountingPeriods/${uniquenessDocumentId(organizationId, "2025-01")}`);
    await period.set({ organizationId, status: "closed", periodKey: "2025-01" });
    await expect(call(financeOfficer, "accountingJournals", base)).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await period.delete();
    await adminDb.doc(`bankAccounts/${account.bankAccountId}`).update({ organizationId: "foreign-org" });
    await expect(call(financeOfficer, "accountingJournals", base)).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await expect(lifecycle(account.bankAccountId, "remove")).rejects.toMatchObject({ code: "functions/not-found" });
    await adminDb.doc(`bankAccounts/${account.bankAccountId}`).update({ organizationId });
    await adminDb.doc("journalEntries/legacy-opening").set({ organizationId, journalType: "manual_adjustment", status: "posted", details: { purpose: "opening_balance" } });
    await adminDb.doc("journalLines/legacy-opening-line").set({ organizationId, accountCode: account.input.ledgerAccountCode, journalEntryId: "legacy-opening" });
    await expect(call(financeOfficer, "accountingJournals", base)).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await expect(call(financeOfficer, "saveBankAccount", save("1010"))).rejects.toMatchObject({ code: "functions/failed-precondition" });
  });
});
