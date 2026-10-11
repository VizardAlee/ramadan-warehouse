import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { getApps, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CeoDashboard } from "../functions/src/dashboard/ceo-model";
const projectId = "demo-ramadan-warehouse", organizationId = "ceo-test-org";
const app = getApps().find(item => item.name === "ceo-tests") ?? initializeAdminApp({ projectId }, "ceo-tests");
const db = getFirestore(app), adminAuth = getAdminAuth(app), apps: FirebaseApp[] = [];
function client(name: string) {
  const app = initializeApp({ projectId, apiKey: "demo", appId: name }, name); apps.push(app);
  const auth = getAuth(app); connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const functions = getFunctions(app, "us-central1"); connectFunctionsEmulator(functions, "127.0.0.1", 5001); return { auth, functions };
}
async function actor(roleId: string, extra = {}) {
  const email = `${roleId}-${apps.length}@ceo.test`, user = await adminAuth.createUser({ email, password: "Password!234567" });
  await db.doc(`users/${user.uid}`).set({ uid: user.uid, organizationId, roleId, branchIds: ["branch-a"], warehouseIds: [], email, status: "active", authDisabled: false, authorizationVersion: 1, ...extra });
  const target = client(email); await signInWithEmailAndPassword(target.auth, email, "Password!234567"); return target;
}
let owner: Awaited<ReturnType<typeof actor>>, ops: typeof owner, finance: typeof owner, auditor: typeof owner, branch: typeof owner, limited: typeof owner;
const input = { section: "ceo", fromDate: "2026-10-01", toDate: "2026-10-10", operatingContext: { type: "branch", id: "branch-a" } };
async function call(change = {}, target = owner) { return (await httpsCallable(target.functions, "getDashboardWorkspace")({ ...input, ...change })).data as CeoDashboard; }
const value = (data: CeoDashboard, id: string) => data.metrics.find(item => item.id === id)?.value;
beforeAll(async () => {
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${projectId}/accounts`, { method: "DELETE" });
  await fetch(`http://127.0.0.1:8180/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" });
  await db.doc(`organizations/${organizationId}`).set({ status: "active" });
  owner = await actor("system_administrator"); ops = await actor("operations_administrator"); finance = await actor("finance_officer"); auditor = await actor("auditor");
  branch = await actor("branch_manager", { effectivePermissions: ["sales.read.all", "reports.sales.read", "requests.read.all", "transfers.read.all", "inventory.read", "expenses.read", "hr.read"] });
  limited = await actor("finance_officer", { directRoleIds: [], customRoleIds: ["limited"], effectivePermissions: ["sales.read.all", "reports.sales.read"] });
  const batch = db.batch(), at = Timestamp.fromDate(new Date("2026-09-30T23:30:00Z"));
  const write = (path: string, data: Record<string, unknown>) => batch.set(db.doc(path), { organizationId, branchId: "branch-a", recordedAt: at, ...data });
  for (const id of ["branch-a", "branch-b", "branch-c", "branch-d", "branch-e", "branch-f", "branch-g"]) write(`branches/${id}`, { name: id, status: "active" });
  write("branches/foreign", { organizationId: "foreign", name: "Forbidden" });
  write("sales/a", { grossAmountMinor: 10000, creditAmountMinor: 4000 });
  write("sales/b", { branchId: "branch-b", grossAmountMinor: 30000, creditAmountMinor: 10000 });
  write("sales/late", { grossAmountMinor: 99999, creditAmountMinor: 99999, recordedAt: Timestamp.fromDate(new Date("2026-10-10T23:30:00Z")) });
  write("sales/foreign", { organizationId: "foreign", grossAmountMinor: 99999, creditAmountMinor: 99999 });
  for (const [id, method, status, amountMinor] of [["cash", "cash", "recorded", 6000], ["advance", "customer_advance", "recorded", 9000], ["exchange", "exchange_credit", "recorded", 8000], ["pending", "bank_transfer", "awaiting_verification", 7000]] as const) write(`salePayments/${id}`, { method, status, amountMinor });
  write("salePayments/b", { branchId: "branch-b", method: "bank_transfer", status: "recorded", amountMinor: 20000 });
  for (const [id, direction, amountMinor] of [["receipt", "inflow", 2000], ["refund", "outflow", 1000], ["advance", "non_cash", 4000]] as const) write(`customerPayments/${id}`, { direction, amountMinor, status: "recorded" });
  write("customerPayments/legacy", { amountMinor: 3000, status: "recorded" });
  write("aftersalesPayments/receipt", { entryType: "receipt", amountMinor: 700 }); write("aftersalesPayments/refund", { entryType: "refund", amountMinor: 200 });
  write("customers/a", { outstandingBalanceMinor: 10000 }); write("customers/foreign", { organizationId: "foreign", outstandingBalanceMinor: 99999 });
  write("inventoryBalances/a", { onHandQuantity: 1.5, reservedQuantity: 1.5, availableQuantity: 0, totalValueMinor: 3000 }); write("inventoryBalances/b", { branchId: "branch-b", onHandQuantity: 5.25, reservedQuantity: 2.25, availableQuantity: 3, totalValueMinor: 9000 });
  for (const collection of ["supplierInvoices", "expenses"]) {
    for (const [id, status, outstandingAmountMinor] of [["approved", "approved", 700], ["partial", "partially_paid", 300], ["draft", "draft", 9000], ["submitted", "submitted", 8000], ["paid", "paid", 0]] as const) write(`${collection}/${id}`, { status, outstandingAmountMinor });
    write(`${collection}/b`, { branchId: "branch-b", status: "approved", outstandingAmountMinor: 2000 });
    write(`${collection}/foreign`, { organizationId: "foreign", status: "approved", outstandingAmountMinor: 99999 });
  }
  write("attendanceEvents/clock", { kind: "clock_in", occurredAt: at, employeeId: "private-staff-id" });
  for (const id of ["old", "new"]) write(`chartOfAccounts/${id}`, { code: id === "old" ? "2310" : "2320", currency: "NGN", active: id !== "old", billingControlPurpose: "provider_payable" });
  write("billingConfigurations/ceo-test-org", { mapping: { providerPayable: { id: "new" } } });
  write("journalLines/old", { accountId: "old", creditMinor: 10000, debitMinor: 0 }); write("journalLines/new", { accountId: "new", creditMinor: 5000, debitMinor: 0 });
  write("journalLines/foreign", { organizationId: "foreign", accountId: "new", creditMinor: 99999, debitMinor: 0 });
  await batch.commit();
}, 60000);
afterAll(async () => { await Promise.all(apps.map(deleteApp)); });
describe("CEO callable preserves authority and reconciles real sources", () => {
  it("accepts the browser envelope and separates invoices, cash, repayments, credit and current balances", async () => {
    const result = await call();
    expect(value(result, "invoiced")).toBe(40000); expect(value(result, "checkout")).toBe(26000);
    expect(value(result, "customerReceipts")).toBe(2000); expect(value(result, "serviceReceipts")).toBe(700);
    expect(value(result, "credit")).toBe(14000); expect(value(result, "debt")).toBe(10000);
    expect(value(result, "reserved")).toBe(3.75); expect(value(result, "emptyStock")).toBe(1);
    expect(value(result, "onHand")).toBe(6.75); expect(value(result, "stockValue")).toBe(12000);
    expect(value(result, "payables")).toBe(3000); expect(value(result, "expenses")).toBe(3000);
    expect(value(result, "providerFunds")).toBe(15000);
    expect(result.trend?.reduce((sum, row) => sum + row.invoicedMinor, 0)).toBe(40000);
    expect(result.trend?.reduce((sum, row) => sum + row.checkoutReceiptsMinor, 0)).toBe(26000);
    expect(JSON.stringify(result)).not.toContain("private-staff-id");
  });
  it("filters a branch without presenting the organization customer balance as branch debt", async () => {
    const result = await call({ branchId: "branch-a" });
    expect(value(result, "invoiced")).toBe(10000); expect(value(result, "checkout")).toBe(6000);
    expect(value(result, "reserved")).toBe(1.5); expect(result.metrics.some(row => row.id === "debt")).toBe(false);
    expect(value(result, "payables")).toBe(1000); expect(value(result, "expenses")).toBe(1000);
    await expect(call({ branchId: "foreign" })).rejects.toMatchObject({ code: "functions/not-found" });
  });
  it("denies extra read-all permissions on a branch-scoped actor before any overview is returned", async () => {
    await expect(call({}, branch)).rejects.toMatchObject({ code: "functions/permission-denied" });
  });
  it("respects domain permissions for all existing organization roles and custom limited readers", async () => {
    for (const target of [ops, finance, auditor]) {
      const result = await call({}, target); expect(value(result, "invoiced")).toBe(40000);
      if (target === ops) { expect(result.metrics.some(row => row.id === "providerFunds")).toBe(false); expect(result.billingConfigured).toBeNull(); }
    }
    const result = await call({}, limited);
    expect(result.metrics.map(row => row.id).sort()).toEqual(["checkout", "credit", "invoiced"]);
    expect(result.billingConfigured).toBeNull();
  });
  it("pages branch metadata without exposing foreign branches and validates cursor ownership", async () => {
    const first = await call(); expect(first.branches).toHaveLength(6); expect(first.nextBranchCursor).toBeTruthy();
    const next = await call({ branchCursor: first.nextBranchCursor }); expect(next.branches).toHaveLength(1);
    expect(next.branches.some(row => first.branches.some(old => old.id === row.id))).toBe(false);
    const invalid = await call({ branchCursor: "foreign" }); expect(invalid.branchError).toBe(true); expect(invalid.branches).toEqual([]);
  });
  it("rejects unknown fields, malformed envelopes, reversed/oversized dates and future periods", async () => {
    for (const change of [{ extra: true }, { operatingContext: { type: "branch", id: "branch-a", extra: true } }, { fromDate: "2026-10-11" }, { fromDate: "2020-01-01" }, { toDate: "2099-01-01" }])
      await expect(call(change)).rejects.toMatchObject({ code: "functions/invalid-argument" });
  });
  it("does not fabricate zero inventory value when a balance has unknown cost", async () => {
    await db.doc("inventoryBalances/missing-cost").set({ organizationId, branchId: "branch-a", onHandQuantity: 1, reservedQuantity: 0, availableQuantity: 1 });
    const result = await call(); expect(value(result, "stockValue")).toBeNull();
    expect(result.metrics.find(row => row.id === "stockValue")?.state).toBe("unavailable");
  });
});
