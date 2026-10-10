import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { getApps, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
const projectId = "demo-ramadan-warehouse", organizationId = "budget-test-org";
const adminApp = getApps().find(app => app.name === "budget-tests") ?? initializeAdminApp({ projectId }, "budget-tests"), db = getFirestore(adminApp), auth = getAdminAuth(adminApp), apps: FirebaseApp[] = [];
function client(name: string) {
  const app = initializeApp({ projectId, apiKey: "demo", appId: name }, name); apps.push(app);
  const auth = getAuth(app); connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const functions = getFunctions(app, "us-central1"); connectFunctionsEmulator(functions, "127.0.0.1", 5001); return { auth, functions };
}
let accountant: ReturnType<typeof client>, restricted: ReturnType<typeof client>, branchReader: ReturnType<typeof client>;
async function actor(email: string, roleId: string, extra = {}) {
  const user = await auth.createUser({ email, password: "Password!234567" });
  await db.doc(`users/${user.uid}`).set({ uid: user.uid, organizationId, roleId, branchIds: [], warehouseIds: [], email, status: "active", authDisabled: false, authorizationVersion: 1, createdAt: FieldValue.serverTimestamp(), ...extra });
  const result = client(email); await signInWithEmailAndPassword(result.auth, email, "Password!234567"); return result;
}
async function call<T = Record<string, unknown>>(data: Record<string, unknown>, target = accountant) { return (await httpsCallable(target.functions, "budgetWorkspace")(JSON.parse(JSON.stringify(data)))).data as T; }
const save = (change = {}) => ({ action: "save", month: "2026-10", branchId: "branch-a", accountId: "income", amountMinor: 10000, expectedVersion: 0, reason: "Reviewed monthly operating target", idempotencyKey: crypto.randomUUID(), ...change });
beforeAll(async () => {
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${projectId}/accounts`, { method: "DELETE" });
  await fetch(`http://127.0.0.1:8180/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" });
  await db.doc(`organizations/${organizationId}`).set({ name: "Budget test", status: "active" });
  for (const id of ["branch-a", "branch-b"]) await db.doc(`branches/${id}`).set({ organizationId, name: id, active: true });
  for (const [id, code] of [["income", "4100"], ["expense", "6100"], ["asset", "1100"]]) await db.doc(`chartOfAccounts/${id}`).set({ organizationId, code, name: id, active: true });
  accountant = await actor("budget-finance@example.test", "finance_officer"); restricted = await actor("budget-cashier@example.test", "sales_cashier");
  branchReader = await actor("budget-store@example.test", "branch_manager", { branchIds: ["branch-a"], directRoleIds: [], effectivePermissions: ["finance.journal.read"] });
});
afterAll(async () => Promise.all(apps.map(app => deleteApp(app))));
describe.sequential("trusted budget workflow", () => {
  it("records one revision for exact concurrent retries and rejects stale edits", async () => {
    const input = save(), results = await Promise.all([call<{ budgetId: string }>(input), call<{ budgetId: string }>(input)]);
    expect(results[0]).toEqual(results[1]);
    expect((await db.collection("budgetRevisions").where("budgetId", "==", results[0]!.budgetId).get()).size).toBe(1);
    await expect(call(save())).rejects.toMatchObject({ code: "functions/failed-precondition" });
    const races = await Promise.allSettled([call(save({ expectedVersion: 1, amountMinor: 15000 })), call(save({ expectedVersion: 1, amountMinor: 18000 }))]);
    expect(races.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const history = await call<{ revisions: Array<{ version: number }> }>({ action: "history", budgetId: results[0]!.budgetId }); expect(history.revisions.map(row => row.version)).toEqual([1, 2]);
    await expect(call({ ...input, amountMinor: 999 })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect((await db.collection("journalEntries").get()).empty).toBe(true);
  });
  it("compares actuals using Lagos month boundaries and separate consolidated targets", async () => {
    await call(save({ accountId: "expense", amountMinor: 10000 }));
    await call(save({ branchId: undefined, amountMinor: 50000 }));
    const batch = db.batch();
    for (const [id, branchId, accountCode, debitMinor, creditMinor, date] of [
      ["early", "branch-a", "6100", 8000, 0, "2026-09-30T23:30:00Z"],
      ["late", "branch-a", "6100", 2000, 0, "2026-10-31T23:30:00Z"],
      ["sale-a", "branch-a", "4100", 0, 20000, "2026-10-02T12:00:00Z"],
      ["sale-b", "branch-b", "4100", 0, 30000, "2026-10-02T12:00:00Z"],
    ] as const) batch.set(db.doc(`journalLines/${id}`), { organizationId, branchId, accountCode, debitMinor, creditMinor, effectiveAt: Timestamp.fromDate(new Date(date)) });
    await batch.commit();
    const store = await call<{ rows: Array<{ accountCode: string; actualMinor: number; varianceMinor: number }> }>({ action: "workspace", month: "2026-10", branchId: "branch-a" });
    expect(store.rows.find(row => row.accountCode === "6100")).toMatchObject({ actualMinor: 8000, varianceMinor: 2000 });
    const all = await call<{ rows: Array<{ actualMinor: number; amountMinor: number }> }>({ action: "workspace", month: "2026-10" });
    expect(all.rows).toHaveLength(1); expect(all.rows[0]).toMatchObject({ actualMinor: 50000, amountMinor: 50000 });
  });
  it("enforces permissions, store scope, account validation and history isolation", async () => {
    await expect(call(save(), restricted)).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(call(save({ accountId: "asset" }))).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await expect(call({ action: "workspace", month: "2026-10" }, branchReader)).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(call({ action: "workspace", month: "2026-10", branchId: "branch-b" }, branchReader)).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(call({ action: "workspace", month: "2026-10", branchId: "branch-a" }, branchReader)).resolves.toHaveProperty("rows");
    await db.doc("budgets/foreign-budget").set({ organizationId: "foreign", branchId: "branch-a" });
    await expect(call({ action: "history", budgetId: "foreign-budget" })).rejects.toMatchObject({ code: "functions/not-found" });
    await expect(call({ action: "workspace", month: "2026-10", cursorId: "foreign-budget" })).rejects.toMatchObject({ code: "functions/invalid-argument" });
  });
  it("pages growing budgets without mixing periods", async () => {
    const batch = db.batch(); for (let i = 0; i < 30; i++) batch.set(db.doc(`budgets/page-${i}`), { organizationId, month: "2026-11", scopeKey: "organization", branchId: null, accountCode: String(6000 + i), accountId: `test-${i}`, accountName: `Test ${i}`, amountMinor: 100, version: 1 }); await batch.commit();
    const first = await call<{ rows: Array<{ id: string }>; nextCursorId: string }>({ action: "workspace", month: "2026-11", pageSize: 25 }); expect(first.rows).toHaveLength(25);
    const second = await call<{ rows: Array<{ id: string }> }>({ action: "workspace", month: "2026-11", pageSize: 25, cursorId: first.nextCursorId }); expect(second.rows).toHaveLength(5);
    expect(second.rows.some(row => first.rows.some(previous => previous.id === row.id))).toBe(false);
    await expect(call({ action: "workspace", month: "2026-10", cursorId: first.nextCursorId })).rejects.toMatchObject({ code: "functions/invalid-argument" });
  });
});

describe("multi-month budget actuals", () => {
  it("keeps monthly/store/org targets separate and includes the last nanosecond", async () => {
    await call(save({ month: "2026-12", amountMinor: 10000 }));
    await call(save({ month: "2027-01", amountMinor: 20000 }));
    await call(save({ month: "2027-01", branchId: undefined, amountMinor: 99999 }));
    const end = Timestamp.fromDate(new Date("2026-12-31T22:59:59Z"));
    await db.doc("journalLines/comparison-last-nanosecond").set({ organizationId, branchId: "branch-a", accountCode: "4100", debitMinor: 0, creditMinor: 12345, effectiveAt: new Timestamp(end.seconds, 999999999) });
    await db.doc("journalLines/comparison-next-month").set({ organizationId, branchId: "branch-a", accountCode: "4100", debitMinor: 0, creditMinor: 6789, effectiveAt: Timestamp.fromDate(new Date("2026-12-31T23:00:00Z")) });
    await db.doc("journalLines/comparison-other-store").set({ organizationId, branchId: "branch-b", accountCode: "4100", debitMinor: 0, creditMinor: 999, effectiveAt: end });
    type Result = { rows: Array<{ month: string; amountMinor: number; actualMinor: number; varianceMinor: number }>; months: string[] };
    const report = await call<Result>({ action: "comparison", fromMonth: "2026-12", toMonth: "2027-02", branchId: "branch-a" });
    expect(report.months).toEqual(["2026-12", "2027-01", "2027-02"]);
    expect(report.rows).toHaveLength(2);
    expect(report.rows.find(row => row.month === "2026-12")).toMatchObject({ amountMinor: 10000, actualMinor: 12345, varianceMinor: 2345 });
    expect(report.rows.find(row => row.month === "2027-01")).toMatchObject({ amountMinor: 20000, actualMinor: 6789 });
    const monthly = await call<{ rows: Array<{ actualMinor: number }> }>({ action: "workspace", month: "2026-12", branchId: "branch-a" });
    expect(monthly.rows[0]?.actualMinor).toBe(12345);
    const org = await call<Result>({ action: "comparison", fromMonth: "2027-01", toMonth: "2027-01" });
    expect(org.rows[0]?.amountMinor).toBe(99999);
  });
  it("denies unauthorized readers, cross-store scope and organization consolidation", async () => {
    const input = { action: "comparison", fromMonth: "2026-12", toMonth: "2027-01", branchId: "branch-a" };
    await expect(call(input, restricted)).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(call({ ...input, branchId: "branch-b" }, branchReader)).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(call({ ...input, branchId: undefined }, branchReader)).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(call({ ...input, toMonth: "2028-12" })).rejects.toMatchObject({ code: "functions/invalid-argument" });
  });
});

describe("product invoice-cohort margins", () => {
  const report = async <T>(data: object, target = accountant) => (await httpsCallable<object, T>(target.functions, "getProductMargins")(data)).data;
  const input = { branchId: "branch-a", fromDate: "2026-08-01", toDate: "2026-08-31" };
  it("uses original sales with current approved returns and recorded costs, never requiring a completed sales status", async () => {
    await db.doc("sales/margin-invoice").set({ organizationId, branchId: "branch-a", paymentStatus: "credit", recordedAt: Timestamp.fromDate(new Date("2026-08-31T22:59:59Z")) });
    await db.doc("saleItems/margin-item").set({ organizationId, branchId: "branch-a", saleId: "margin-invoice", productId: "margin-product", sku: "MP", productName: "Margin product", quantity: 4, netAmountMinor: 10000, costAmountMinor: 4000, collectionTracked: true, collectedQuantity: 4 });
    await db.doc("saleReturns/margin-approved").set({ organizationId, saleId: "margin-invoice", status: "approved", approvedAt: Timestamp.fromDate(new Date("2026-10-01T12:00:00Z")), kind: "customer_return" });
    await db.doc("saleReturnItems/margin-return").set({ organizationId, saleId: "margin-invoice", returnId: "margin-approved", saleItemId: "margin-item", quantity: 1, netAmountMinor: 2500, costAmountMinor: 1000, condition: "restockable" });
    await db.doc("saleReturns/margin-pending").set({ organizationId, saleId: "margin-invoice", status: "submitted" });
    await db.doc("saleReturnItems/margin-pending-item").set({ organizationId, saleId: "margin-invoice", returnId: "margin-pending", saleItemId: "margin-item", quantity: 2, netAmountMinor: 5000, costAmountMinor: 2000, condition: "restockable" });
    for (const [id, branch, org, recordedAt] of [["other-store", "branch-b", organizationId, "2026-08-01T12:00:00Z"], ["other-org", "branch-a", "other", "2026-08-01T12:00:00Z"], ["next-day", "branch-a", organizationId, "2026-08-31T23:00:00Z"]])
      await db.doc(`sales/margin-${id}`).set({ organizationId: org, branchId: branch, recordedAt: Timestamp.fromDate(new Date(recordedAt!)) });
    const result = await report<{ invoiceCount: number; rows: Array<{ grossMarginMinor: number; netSalesMinor: number; netRecordedCostMinor: number }> }>(input);
    expect(result.invoiceCount).toBe(1); expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ netSalesMinor: 7500, netRecordedCostMinor: 3000, grossMarginMinor: 4500 });
    await db.doc("saleItems/margin-item").update({ collectionTracked: true, collectedQuantity: 3 });
    expect((await report<{ rows: Array<{ grossMarginMinor: number | null; unknownCostLines: number }> }>(input)).rows[0]).toMatchObject({ grossMarginMinor: null, unknownCostLines: 1 });
  });
  it("protects cost data, branch scope and invalid ranges", async () => {
    await expect(report(input, restricted)).rejects.toMatchObject({ code: "functions/permission-denied" });
    const scoped = await actor("margin-scoped@example.test", "branch_manager", { branchIds: ["branch-a"], directRoleIds: [], effectivePermissions: ["reports.sales.read", "inventory.cost.read"] });
    await expect(report({ ...input, branchId: "branch-b" }, scoped)).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(report({ ...input, fromDate: "2026-09-01" })).rejects.toMatchObject({ code: "functions/invalid-argument" });
  });
});
