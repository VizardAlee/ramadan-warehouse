import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uniquenessDocumentId } from "../functions/src/inventory/calculations";
import { releaseNotes } from "../functions/src/releases/catalog";
import { buildRoleAssignment, type StoredRole } from "../functions/src/auth/custom-roles";

const projectId = "demo-ramadan-warehouse", organizationId = "financial-upgrade-fixtures";
const admin = initializeAdminApp({ projectId }, "financial-upgrade-fixtures"), db = getFirestore(admin), auth = getAdminAuth(admin), apps: FirebaseApp[] = [];
function client(name: string) {
  const app = initializeApp({ projectId, apiKey: "demo", appId: `financial-${name}` }, `financial-${name}`); apps.push(app);
  const clientAuth = getAuth(app); connectAuthEmulator(clientAuth, "http://127.0.0.1:9099", { disableWarnings: true });
  const functions = getFunctions(app, "us-central1"); connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  return { auth: clientAuth, functions };
}
async function actor(name: string, roleId = "system_administrator", branchIds: string[] = []) {
  const email = `${name}@financial.example.test`, user = await auth.createUser({ email, password: "Synthetic!234567" });
  await db.doc(`users/${user.uid}`).set({ uid: user.uid, organizationId, roleId, roleIds: roleId === "branch_manager" ? ["branch_manager", "warehouse_manager"] : [roleId], branchIds, warehouseIds: [], email, displayName: name, status: "active", authDisabled: false, authorizationVersion: 1 });
  const target = client(name); await signInWithEmailAndPassword(target.auth, email, "Synthetic!234567"); return target;
}
async function call<T = Record<string, unknown>>(target: ReturnType<typeof client>, name: string, input: object): Promise<T> { return (await httpsCallable(target.functions, name)(input)).data as T; }
let administrator: ReturnType<typeof client>, manager: ReturnType<typeof client>, second: ReturnType<typeof client>;
beforeAll(async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8180" || process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099") throw new Error("Financial upgrade tests require explicit local demo emulators; production access is prohibited.");
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${projectId}/accounts`, { method: "DELETE" });
  await fetch(`http://127.0.0.1:8180/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" });
  await db.doc(`organizations/${organizationId}`).set({ status: "active", legalName: "Synthetic organization", tradingName: "Synthetic" });
  for (const id of ["a", "b"]) await db.doc(`branches/${id}`).set({ organizationId, status: "active", name: `Store ${id}` });
  for (const [id, branchId, code] of [["bank-a", "a", "1031"], ["bank-b", "b", "1032"]]) await db.doc(`bankAccounts/${id}`).set({ organizationId, branchId, active: true, bankName: "Synthetic bank", accountName: id, accountNumberLast4: "1234", ledgerAccountCode: code });
  await db.doc("suppliers/supplier").set({ organizationId, active: true, name: "Synthetic supplier", supplierNumber: "SUP-1", outstandingBalanceMinor: 0, advanceBalanceMinor: 0, advanceBalancesByLocation: {} });
  await db.doc("products/product").set({ organizationId, active: true, name: "Synthetic product", sku: "SYN-1", unitOfMeasure: "unit", itemKind: "goods" });
  await db.doc("productSalesPrices/product").set({ organizationId, active: true, basePriceMinor: 10001, vatRateBasisPoints: 750, version: 1 });
  administrator = await actor("administrator"); manager = await actor("manager", "branch_manager", ["a"]); second = await actor("second");
});
afterAll(async () => { await Promise.all(apps.map(app => deleteApp(app))); });
describe.sequential("financial upgrade isolated callables", () => {
  it("posts both store journals atomically and replays a cross-store transfer once", async () => {
    const input = { branchId: "a", sourceBankAccountId: "bank-a", destinationBankAccountId: "bank-b", amountMinor: 10001, transferredAt: "2026-10-17T09:00:00Z", reference: "SYN-TRANSFER", reason: "Synthetic completed transfer", confirmedCompleted: true, idempotencyKey: crypto.randomUUID() };
    const [first, replay] = await Promise.all([call<{ journalEntryId: string; destinationJournalEntryId: string }>(administrator, "recordCompanyFundsTransfer", input), call(administrator, "recordCompanyFundsTransfer", input)]);
    expect(replay).toEqual(first); expect(first.destinationJournalEntryId).toBeTruthy();
    const journals = await db.getAll(db.doc(`journalEntries/${first.journalEntryId}`), db.doc(`journalEntries/${first.destinationJournalEntryId}`));
    expect(journals.map(row => row.get("branchId"))).toEqual(["a", "b"]);
    for (const journal of journals) expect(journal.data()).toMatchObject({ totalDebitMinor: 10001, totalCreditMinor: 10001, journalType: "internal_funds_transfer" });
    const range = { fromDate: "2026-10-17", toDate: "2026-10-17" };
    const consolidated = await call(administrator, "generateFinancialStatement", { ...range, reportType: "receipts_payments" });
    expect(consolidated).toMatchObject({ receiptsMinor: 0, paymentsMinor: 0, netCashMovementMinor: 0 });
    await expect(call(administrator, "generateFinancialStatement", { ...range, reportType: "receipts_payments", branchId: "a" })).resolves.toMatchObject({ receiptsMinor: 0, paymentsMinor: 10001, netCashMovementMinor: -10001 });
    await expect(call(administrator, "generateFinancialStatement", { ...range, reportType: "receipts_payments", branchId: "b" })).resolves.toMatchObject({ receiptsMinor: 10001, paymentsMinor: 0, netCashMovementMinor: 10001 });
    for (const [branchId, amountMinor] of [["a", -10001], ["b", 10001]] as const) {
      const statement = await call<{ rows: Array<{ section: string; amountMinor: number }> }>(administrator, "generateFinancialStatement", { ...range, reportType: "cash_flow", branchId });
      expect(statement.rows).toEqual(expect.arrayContaining([{ section: "Operating activities", amountMinor: 0 }, { section: "Store funding transfers", amountMinor }]));
    }
    await expect(call(administrator, "recordCompanyFundsTransfer", input)).resolves.toEqual(first);
    expect(await call(administrator, "generateFinancialStatement", { ...range, reportType: "receipts_payments" })).toEqual(consolidated);
    const lines = await db.collection("journalLines").where("organizationId", "==", organizationId).get();
    expect(lines.size).toBe(4);
    expect(lines.docs.filter(row => row.get("accountCode") === "1380").reduce((sum, row) => sum + row.get("debitMinor") - row.get("creditMinor"), 0)).toBe(0);
    expect(lines.docs.filter(row => row.get("bankAccountId")).map(row => row.get("bankAccountId")).sort()).toEqual(["bank-a", "bank-b"]);
    await expect(call(manager, "recordCompanyFundsTransfer", { ...input, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(call(administrator, "recordCompanyFundsTransfer", { ...input, branchId: "b", idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    expect((await db.collection("journalEntries").where("organizationId", "==", organizationId).get()).size).toBe(2);
  });
  it("records exact split supplier advances once and rejects another store's account without changing balances", async () => {
    const input = { supplierId: "supplier", branchId: "a", purpose: "advance", method: "cash", amountMinor: 10001, allocations: [], paidAt: "2026-10-17T09:00:00Z", tenders: [{ method: "cash", amountMinor: 3333 }, { method: "bank_transfer", bankAccountId: "bank-a", reference: "SYN-ADV", amountMinor: 6668 }], idempotencyKey: crypto.randomUUID() };
    await expect(call(administrator, "recordSupplierPayment", { ...input, tenders: [input.tenders[0], { ...input.tenders[1], bankAccountId: "bank-b" }] })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect((await db.doc("suppliers/supplier").get()).get("advanceBalanceMinor")).toBe(0);
    const first = await call<{ paymentId: string }>(administrator, "recordSupplierPayment", input);
    await expect(call(administrator, "recordSupplierPayment", input)).resolves.toMatchObject({ paymentId: first.paymentId, recorded: false });
    expect((await db.doc("suppliers/supplier").get()).data()).toMatchObject({ advanceBalanceMinor: 10001, advanceSourceBalancesByLocation: { "branch:a": { cashAdvanceMinor: 10001, returnCreditMinor: 0, legacyUnclassifiedMinor: 0 } } });
    const payment = await db.doc(`supplierPayments/${first.paymentId}`).get();
    expect(payment.get("method")).toBe("split"); expect(payment.get("tenders")).toHaveLength(2);
    const lines = await db.collection("journalLines").where("journalEntryId", "==", payment.get("journalEntryId")).get();
    expect(lines.docs.reduce((sum, row) => sum + row.get("debitMinor") - row.get("creditMinor"), 0)).toBe(0);
    expect(lines.docs.map(row => [row.get("accountCode"), row.get("creditMinor")]).sort()).toEqual([["1010", 3333], ["1031", 6668], ["1250", 0]]);
  });
  it("creates and retrieves a quote without stock, debt, money or journal writes; quote replay is immutable", async () => {
    const count = async (collection: string) => (await db.collection(collection).get()).size;
    const collections = ["inventoryTransactions", "inventoryBalances", "sales", "customerPayments", "journalEntries", "supplierPayments"];
    const before = await Promise.all(collections.map(count));
    const input = { action: "create_proforma", branchId: "a", customerName: "Prospective customer", validUntil: new Date(Date.now() + 86400000).toISOString().slice(0, 10), lines: [{ productId: "product", quantity: 2 }], idempotencyKey: crypto.randomUUID() };
    const first = await call<{ proformaId: string }>(manager, "createPosSaleOrder", input);
    await expect(call(manager, "createPosSaleOrder", input)).resolves.toEqual(first);
    const quote = await call<Record<string, unknown>>(manager, "getSaleDocument", { action: "get_proforma", proformaId: first.proformaId });
    expect(quote).toMatchObject({ status: "proforma", grossAmountMinor: 21502, subtotalAmountMinor: 20002, vatAmountMinor: 1500 });
    await expect(call(manager, "createPosSaleOrder", { ...input, lines: [{ productId: "product", quantity: 3 }] })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await expect(call(manager, "createPosSaleOrder", { ...input, branchId: "b", idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(call(manager, "createPosSaleOrder", { ...input, payments: [{ method: "cash", amountMinor: 21502 }], idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/invalid-argument" });
    expect(await Promise.all(collections.map(count))).toEqual(before);
  });
  it("does not turn a separate global sales-read grant into cross-store quote creation", async () => {
    const scoped = await actor("scoped-quoter", "branch_manager", ["a"]);
    const role: StoredRole = { id: "quote-global-reader", organizationId, name: "Quote read authority", baseRoleId: "finance_officer", permissionIds: ["reports.sales.read"], status: "active" };
    await db.doc(`roles/${role.id}`).set(role);
    await db.doc(`users/${scoped.auth.currentUser!.uid}`).update(buildRoleAssignment(["branch_manager"], [role]));
    const input = { action: "create_proforma", branchId: "b", validUntil: new Date(Date.now() + 86400000).toISOString().slice(0,10), lines: [{ productId: "product", quantity: 1 }], idempotencyKey: crypto.randomUUID() };
    await expect(call(scoped, "createPosSaleOrder", input)).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(call(scoped, "getSaleDocument", { action: "list_proformas", branchId: "b" })).resolves.toMatchObject({ rows: [] });
    await expect(call(scoped, "createPosSaleOrder", { ...input, branchId: "a", idempotencyKey: crypto.randomUUID() })).resolves.toMatchObject({ saved: true });
  });
  it("conserves customer deposits, split repayments and concurrent final repayments without silently offsetting credit", async () => {
    await db.doc("customers/customer").set({ organizationId, active: true, name: "Synthetic customer", customerNumber: "CUS-SYN", creditStatus: "approved", creditLimitMinor: 50000, outstandingBalanceMinor: 30000, availableCreditMinor: 20000, arrangements: [], invoiceDebtByAccount: { general: 30000 }, advanceBalances: {} });
    await db.doc("sales/customer-invoice").set({ organizationId, branchId: "a", customerId: "customer", customerAccountId: "general", receivableVersion: 1, receivableOutstandingMinor: 30000, receivablePaidMinor: 0, receivableStatus: "open", saleNumber: "SAL-SYN", recordedAt: Timestamp.now() });
    const base = { customerId: "customer", branchId: "a", method: "cash" };
    const deposit = { ...base, purpose: "advance", amountMinor: 10001, tenders: [{ method: "cash", amountMinor: 3333 }, { method: "card", bankAccountId: "bank-a", reference: "SYN-DEP", amountMinor: 6668 }], idempotencyKey: crypto.randomUUID() };
    const posted = await call<{ paymentId: string }>(administrator, "recordCustomerPayment", deposit);
    await expect(call(administrator, "recordCustomerPayment", deposit)).resolves.toMatchObject({ paymentId: posted.paymentId, recorded: false });
    expect((await db.doc("customers/customer").get()).data()).toMatchObject({ outstandingBalanceMinor: 30000, availableCreditMinor: 20000, advanceBalances: { general: 10001 } });
    await call(administrator, "recordCustomerPayment", { ...base, amountMinor: 10000, tenders: [{ method: "cash", amountMinor: 3333 }, { method: "bank_transfer", bankAccountId: "bank-a", reference: "SYN-PAY", amountMinor: 6667 }], invoiceAllocations: [{ saleId: "customer-invoice", amountMinor: 10000 }], idempotencyKey: crypto.randomUUID() });
    await call(administrator, "recordCustomerPayment", { ...base, source: "advance_balance", amountMinor: 5000, invoiceAllocations: [{ saleId: "customer-invoice", amountMinor: 5000 }], idempotencyKey: crypto.randomUUID() });
    const results = await Promise.allSettled([1,2].map(() => call(administrator, "recordCustomerPayment", { ...base, amountMinor: 15000, invoiceAllocations: [{ saleId: "customer-invoice", amountMinor: 15000 }], idempotencyKey: crypto.randomUUID() })));
    expect(results.filter(row => row.status === "fulfilled")).toHaveLength(1);
    expect((await db.doc("customers/customer").get()).data()).toMatchObject({ outstandingBalanceMinor: 0, availableCreditMinor: 50000, advanceBalances: { general: 5001 }, invoiceDebtByAccount: { general: 0 } });
    expect((await db.doc("sales/customer-invoice").get()).data()).toMatchObject({ receivableOutstandingMinor: 0, receivablePaidMinor: 30000 });
    const payments = await db.collection("customerPayments").where("customerId", "==", "customer").get(); expect(payments.size).toBe(4);
    for (const payment of payments.docs) {
      const lines = await db.collection("journalLines").where("journalEntryId", "==", payment.get("journalEntryId")).get();
      expect(lines.docs.reduce((sum,row) => sum + row.get("debitMinor") - row.get("creditMinor"), 0)).toBe(0);
      if (payment.get("source") === "advance_balance") expect(lines.docs.some(row => /^10/.test(row.get("accountCode")))).toBe(false);
    }
  });
  it("keeps release acknowledgements user scoped, idempotent, and unable to change a role", async () => {
    const releaseId = releaseNotes[0].id, before = (await db.doc(`users/${administrator.auth.currentUser!.uid}`).get()).data();
    const input = { action: "acknowledge_release", releaseId, userId: second.auth.currentUser!.uid };
    await call(administrator, "getMyAccessContext", input); await call(administrator, "getMyAccessContext", input);
    await expect(call(administrator, "getMyAccessContext", { action: "release_notes" })).resolves.toMatchObject({ acknowledgedReleaseIds: [releaseId] });
    await expect(call(second, "getMyAccessContext", { action: "release_notes" })).resolves.toMatchObject({ acknowledgedReleaseIds: [] });
    expect((await db.collection("userReleaseAcknowledgements").get()).size).toBe(1);
    expect((await db.doc(`users/${administrator.auth.currentUser!.uid}`).get()).data()).toEqual(before);
    expect((await db.doc(`userReleaseAcknowledgements/${uniquenessDocumentId(organizationId, second.auth.currentUser!.uid, releaseId)}`).get()).exists).toBe(false);
  });
  it("edits only actual handover metadata with versioned replay and current branch authority", async () => {
    const dispatcher = await actor("dispatcher", "branch_manager", ["a"]), reader = await actor("reader", "branch_requester", ["a"]);
    await db.doc("sales/dispatch-sale").set({ organizationId, branchId: "a", status: "completed" });
    await db.doc("saleCollections/dispatch-handover").set({ organizationId, saleId: "dispatch-sale", branchId: "a", totalQuantity: 2 });
    const count = async (collection: string) => (await db.collection(collection).get()).size, collections = ["inventoryTransactions", "inventoryEntries", "journalEntries", "customerPayments", "supplierPayments"];
    const before = await Promise.all(collections.map(count));
    const input = { action: "update_dispatch_details", saleId: "dispatch-sale", collectionId: "dispatch-handover", expectedVersion: 0, dispatcherPhone: "+234 800 000 0000", vehiclePlate: "SYN-001", deliveryRecipientName: "Synthetic receiver", idempotencyKey: crypto.randomUUID() };
    await expect(call(reader, "confirmPosSaleOrder", input)).rejects.toMatchObject({ code: "functions/permission-denied" });
    const [posted, replay] = await Promise.all([call(dispatcher, "confirmPosSaleOrder", input), call(dispatcher, "confirmPosSaleOrder", input)]);
    expect(posted).toEqual(replay); expect(posted).toMatchObject({ dispatchDetailsVersion: 1, vehiclePlate: "SYN-001" });
    await expect(call(dispatcher, "confirmPosSaleOrder", { ...input, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect(await Promise.all(collections.map(count))).toEqual(before);
    expect((await db.doc("saleCollections/dispatch-handover").get()).get("totalQuantity")).toBe(2);
    await db.doc(`users/${dispatcher.auth.currentUser!.uid}`).update({ branchIds: ["b"], authorizationVersion: 2 });
    await expect(call(dispatcher, "confirmPosSaleOrder", input)).rejects.toMatchObject({ code: "functions/permission-denied" });
  });
  it("binds dispatch edits and replays to their own current store-release grant", async () => {
    const scoped = await actor("mixed-dispatch", "branch_manager", ["a"]);
    const reportRole: StoredRole = { id: "dispatch-report-reader", organizationId, name: "Reports only", baseRoleId: "finance_officer", permissionIds: ["reports.sales.read"], status: "active" };
    await db.doc(`roles/${reportRole.id}`).set(reportRole);
    await db.doc(`users/${scoped.auth.currentUser!.uid}`).update(buildRoleAssignment(["branch_manager"], [reportRole]));
    await db.doc("sales/mixed-dispatch-sale").set({ organizationId, branchId: "b", status: "completed" });
    await db.doc("saleCollections/mixed-dispatch-handover").set({ organizationId, saleId: "mixed-dispatch-sale", branchId: "b", totalQuantity: 1 });
    const input = { action: "update_dispatch_details", saleId: "mixed-dispatch-sale", collectionId: "mixed-dispatch-handover", expectedVersion: 0, vehiclePlate: "SYN-MIXED", idempotencyKey: crypto.randomUUID() };
    await expect(call(scoped, "confirmPosSaleOrder", input)).rejects.toMatchObject({ code: "functions/permission-denied" });
    expect((await db.doc("saleCollections/mixed-dispatch-handover").get()).get("dispatchDetailsVersion")).toBeUndefined();
    await expect(call(administrator, "confirmPosSaleOrder", input)).resolves.toMatchObject({ dispatchDetailsVersion: 1 });
    await expect(call(scoped, "confirmPosSaleOrder", input)).rejects.toMatchObject({ code: "functions/permission-denied" });
    const releaseRole: StoredRole = { ...reportRole, id: "dispatch-global-release", name: "Explicit global release", baseRoleId: "operations_administrator", permissionIds: ["sales.stock.release"] };
    await db.doc(`roles/${releaseRole.id}`).set(releaseRole);
    await db.doc(`users/${scoped.auth.currentUser!.uid}`).update(buildRoleAssignment(["branch_manager"], [releaseRole]));
    const secondEdit = { ...input, expectedVersion: 1, vehiclePlate: "SYN-GLOBAL", idempotencyKey: crypto.randomUUID() };
    await expect(call(scoped, "confirmPosSaleOrder", secondEdit)).resolves.toMatchObject({ dispatchDetailsVersion: 2 });
    await db.doc(`roles/${releaseRole.id}`).update({ permissionIds: [] });
    await expect(call(scoped, "confirmPosSaleOrder", secondEdit)).rejects.toMatchObject({ code: "functions/permission-denied" });
    expect((await db.doc("saleCollections/mixed-dispatch-handover").get()).get("dispatchDetailsVersion")).toBe(2);
  });
  it("keeps receipt store authority separate from reports and preserves explicit global reads and balances", async () => {
    const scoped = await actor("mixed-receipt", "branch_manager", ["a"]);
    const reportRole: StoredRole = { id: "receipt-report-reader", organizationId, name: "Reports only", baseRoleId: "finance_officer", permissionIds: ["reports.sales.read"], status: "active" };
    await db.doc(`roles/${reportRole.id}`).set(reportRole);
    await db.doc(`users/${scoped.auth.currentUser!.uid}`).update(buildRoleAssignment(["branch_manager"], [reportRole]));
    await db.doc("customers/scope-receipt-customer").set({ organizationId, name: "Scope receipt customer", active: true });
    for (const branchId of ["a", "b"]) await db.doc(`customerPayments/scope-receipt-${branchId}`).set({ organizationId, customerId: "scope-receipt-customer", branchId, status: "recorded", method: "cash", amountMinor: 100, outstandingAfterMinor: 5000, advanceBalancesAfter: { general: 1200 } });
    const input = { view: "payment_receipt", customerId: "scope-receipt-customer", paymentId: "scope-receipt-b", branchId: "b" };
    await expect(call(scoped, "getCustomerHistory", input)).rejects.toMatchObject({ code: "functions/permission-denied" });
    const balances = { outstandingAfterMinor: 5000, advanceAfterMinor: 1200 };
    await expect(call(scoped, "getCustomerHistory", { ...input, paymentId: "scope-receipt-a", branchId: "a" })).resolves.toMatchObject(balances);
    await expect(call(administrator, "getCustomerHistory", input)).resolves.toMatchObject(balances);
    const customerRole: StoredRole = { ...reportRole, id: "receipt-global-customer", name: "Explicit global customers", baseRoleId: "operations_administrator", permissionIds: ["customers.read"] };
    await db.doc(`roles/${customerRole.id}`).set(customerRole);
    await db.doc(`users/${scoped.auth.currentUser!.uid}`).update(buildRoleAssignment(["branch_manager"], [customerRole]));
    await expect(call(scoped, "getCustomerHistory", input)).resolves.toMatchObject(balances);
    await db.doc("customerPayments/scope-receipt-b").update({ organizationId: "foreign-synthetic" });
    await expect(call(scoped, "getCustomerHistory", input)).rejects.toMatchObject({ code: "functions/not-found" });
    await db.doc("customerPayments/scope-receipt-b").update({ organizationId });
    await db.doc(`roles/${customerRole.id}`).update({ permissionIds: [] });
    await expect(call(scoped, "getCustomerHistory", input)).rejects.toMatchObject({ code: "functions/permission-denied" });
  });
  it("reprints authorized historical supplier allocation evidence without rewriting balances", async () => {
    await db.doc("supplierInvoices/legacy-receipt-invoice").set({ organizationId, supplierId: "supplier", branchId: "a", supplierInvoiceNumber: "SYN-LEGACY-INV", outstandingAmountMinor: 777 });
    await db.doc("supplierPayments/legacy-receipt-payment").set({ organizationId, supplierId: "supplier", branchId: "a", status: "recorded", purpose: "payment", method: "cash", amountMinor: 10000, journalEntryId: "legacy-receipt-journal", paidAt: Timestamp.fromDate(new Date("2026-10-17T10:00:00Z")) });
    await db.doc("supplierPaymentAllocations/legacy-receipt-allocation").set({ organizationId, supplierId: "supplier", supplierPaymentId: "legacy-receipt-payment", supplierInvoiceId: "legacy-receipt-invoice", amountMinor: 10000 });
    await db.doc("supplierAccountEntries/legacy-receipt-entry").set({ organizationId, supplierId: "supplier", branchId: "a", referenceType: "supplierPayment", referenceId: "legacy-receipt-payment", entryType: "supplier_payment", journalEntryId: "legacy-receipt-journal", allocations: [{ supplierInvoiceId: "legacy-receipt-invoice", amountMinor: 10000 }], balanceAfterMinor: 3210, advanceBalanceAfterMinor: 500 });
    const original = (await db.doc("supplierPayments/legacy-receipt-payment").get()).data();
    const input = { view: "supplier_payment_receipt", supplierId: "supplier", paymentId: "legacy-receipt-payment", branchId: "a" };
    const allocations = [{ invoiceNumber: "SYN-LEGACY-INV", amountMinor: 10000, outstandingAfterMinor: null }];
    await expect(call(administrator, "getProcurementWorkspace", input)).resolves.toMatchObject({ allocations, outstandingAfterMinor: 3210, advanceAfterMinor: 500 });
    await expect(call(manager, "getProcurementWorkspace", input)).resolves.toMatchObject({ allocations, outstandingAfterMinor: null, advanceAfterMinor: null });
    expect((await db.doc("supplierPayments/legacy-receipt-payment").get()).data()).toEqual(original);
    await db.doc("supplierInvoices/legacy-receipt-invoice").update({ organizationId: "foreign-synthetic" });
    await expect(call(administrator, "getProcurementWorkspace", input)).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await db.doc("supplierInvoices/legacy-receipt-invoice").update({ organizationId });
  });
  it("returns stable scoped running statements across tied timestamps and complete history beyond a page", async () => {
    await db.doc("suppliers/statement-supplier").set({ organizationId, active: true, name: "Statement fixture", supplierNumber: "SUP-STATEMENT" });
    const batch = db.batch(), at = Timestamp.fromDate(new Date("2026-10-16T23:00:00Z"));
    for (let i = 0; i < 120; i++) batch.set(db.doc(`supplierAccountEntries/tied-${String(i).padStart(3, "0")}`), { organizationId, supplierId: "statement-supplier", branchId: "a", amountMinor: 101, advanceAmountMinor: 0, effectiveAt: at, entryType: "invoice", referenceNumber: `SYN-${i}` });
    batch.set(db.doc("supplierAccountEntries/foreign-store"), { organizationId, supplierId: "statement-supplier", branchId: "b", amountMinor: 999999, advanceAmountMinor: 0, effectiveAt: at });
    await batch.commit();
    const input = { view: "supplier_account", supplierId: "statement-supplier", branchId: "a", from: "2026-10-17", through: "2026-10-17", limit: 25 };
    const first = await call<{ entries: Array<{ id: string; runningPayableMinor: number }>; nextCursor: string; statementVersion: string }>(manager, "getProcurementWorkspace", input);
    const full = await call<{ entries: Array<{ id: string; runningPayableMinor: number }>; statementVersion: string }>(manager, "getProcurementWorkspace", { ...input, complete: true });
    expect(full.entries).toHaveLength(120); expect(full.entries[0]!.runningPayableMinor).toBe(101); expect(full.entries.at(-1)!.runningPayableMinor).toBe(12120);
    expect(first.statementVersion).toBe(full.statementVersion); expect(first.entries[0]!.id).toBe("tied-119");
    expect(JSON.stringify(full)).not.toContain("foreign-store"); expect(JSON.stringify(full)).not.toContain("balanceAfterMinor");
    await expect(call(manager, "getProcurementWorkspace", { ...input, branchId: "b" })).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(call(manager, "getProcurementWorkspace", { view: "supplier_account", supplierId: "supplier" })).rejects.toMatchObject({ code: "functions/permission-denied" });
    const next = await call<{ entries: Array<{ id: string }> }>(manager, "getProcurementWorkspace", { ...input, cursor: first.nextCursor });
    expect(new Set([...first.entries, ...next.entries].map(row => row.id)).size).toBe(50);
  });
});
