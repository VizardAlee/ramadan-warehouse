import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import type { AccessProfile } from "../functions/src/auth/authorize";
import { uniquenessDocumentId } from "../functions/src/inventory/calculations";
import { internalTradeBalanceId } from "../functions/src/branch-trading/identity";
import { TransferFirestoreFixture } from "./helpers/transfer-firestore-fixture";

const state = vi.hoisted(() => ({ db: null as unknown as TransferFirestoreFixture }));
const actor: AccessProfile = { userId: "admin", organizationId: "org", roleId: "system_administrator", roleIds: ["system_administrator"], directRoleIds: ["system_administrator"], branchIds: [], warehouseIds: [], authorizationVersion: 1 };
vi.mock("../functions/src/admin.js", () => ({ db: {
  doc: (path: string) => state.db.doc(path), collection: (path: string) => state.db.collection(path),
  getAll: (...refs: Parameters<TransferFirestoreFixture["getAll"]>) => state.db.getAll(...refs),
  runTransaction: (handler: Parameters<TransferFirestoreFixture["runTransaction"]>[0]) => state.db.runTransaction(handler),
} }));
vi.mock("../functions/src/auth/authorize.js", async original => ({ ...await original<typeof import("../functions/src/auth/authorize")>(), requireAccess: async () => actor }));
vi.mock("../functions/src/config.js", () => ({ enforceAppCheck: false }));
import { recordInternalTradePayment, type InternalTradePaymentInput } from "../functions/src/branch-trading/payments";
import { generateFinancialStatement } from "../functions/src/callable/financial-reports";
import { writeJournal } from "../functions/src/accounting/write-journal";
const { Timestamp } = createRequire(new URL("../functions/package.json", import.meta.url))("firebase-admin/firestore") as typeof import("firebase-admin/firestore");
const at = "2026-01-05T12:00:00.000Z";
function report(reportType: "trial_balance" | "income_statement" | "cash_flow" | "receipts_payments", branchId?: string) {
  return generateFinancialStatement.run({ data: {reportType, fromDate: "2026-01-05", toDate: "2026-01-05", ...(branchId ? {branchId} : {})} } as Parameters<typeof generateFinancialStatement.run>[0]);
}
beforeEach(async () => {
  state.db = new TransferFirestoreFixture();
  for (const branchId of ["branch", "hq"]) state.db.seed(`branches/${branchId}`, {organizationId: "org", status: "active"});
  for (const [id, branchId, code] of [["from", "branch", "1041"], ["to", "hq", "1042"]]) state.db.seed(`bankAccounts/${id}`, {organizationId: "org", branchId, active: true, ledgerAccountCode: code, bankName: id, accountName: id});
  const base = {organizationId: "org", branchId: "branch", headOfficeBranchId: "hq", paidMinor: 0, returnedMinor: 0, balanceMinor: 1000, version: 0};
  state.db.seed("internalTradeInvoices/invoice", {...base, totalMinor: 1000});
  state.db.seed(`internalTradeBalances/${internalTradeBalanceId("org", "hq", "branch")}`, {...base, invoicedMinor: 1000});
  // Unrelated external activity goes through the real journal writer too.
  await state.db.runTransaction(async tx => {
    const counter = state.db.doc(`journalCounters/${uniquenessDocumentId("org", "general")}`);
    const common = {journalCounter: counter, referenceType: "sale", referenceId: "external-sale", referenceNumber: "SALE-1", description: "External customer sale", branchId: "branch", effectiveAt: Timestamp.fromDate(new Date(at))};
    writeJournal(tx as unknown as Parameters<typeof writeJournal>[0], actor, {...common, journal: state.db.doc("journalEntries/opening") as unknown as Parameters<typeof writeJournal>[2]["journal"], journalCounter: counter as unknown as Parameters<typeof writeJournal>[2]["journalCounter"], journalCounterValue: 1, journalType: "inventory_opening_balance", lines: [{accountCode: "1200", debitMinor: 100, creditMinor: 0}, {accountCode: "3100", debitMinor: 0, creditMinor: 100}]});
    writeJournal(tx as unknown as Parameters<typeof writeJournal>[0], actor, {...common, journal: state.db.doc("journalEntries/external-sale") as unknown as Parameters<typeof writeJournal>[2]["journal"], journalCounter: counter as unknown as Parameters<typeof writeJournal>[2]["journalCounter"], journalCounterValue: 2, journalType: "sale", lines: [{accountCode: "1010", debitMinor: 300, creditMinor: 0}, {accountCode: "4000", debitMinor: 0, creditMinor: 300}, {accountCode: "5000", debitMinor: 100, creditMinor: 0}, {accountCode: "1200", debitMinor: 0, creditMinor: 100}]});
  });
});
describe("actual internal payment postings through actual financial statements", () => {
  it.each([
    ["cash", "cash"], ["bank_transfer", "bank_transfer"], ["cash", "bank_transfer"], ["bank_transfer", "cash"],
  ] as const)("consolidates %s to %s without suppressing external activity", async (sourceMethod, destinationMethod) => {
    const beforeIncome = await report("income_statement");
    expect(beforeIncome).toMatchObject({incomeMinor: 300, expenseMinor: 100, profitMinor: 200});
    expect(await report("trial_balance")).toMatchObject({totalDebitMinor: 500, totalCreditMinor: 500});
    const input: InternalTradePaymentInput = {action: "record_payment", invoiceId: "invoice", amountMinor: 200, sourceMethod, destinationMethod, ...(sourceMethod === "bank_transfer" ? {sourceBankAccountId: "from"} : {}), ...(destinationMethod === "bank_transfer" ? {destinationBankAccountId: "to"} : {}), paymentDate: at, reference: "Completed HQ settlement", confirmedCompleted: true, idempotencyKey: crypto.randomUUID()};
    await recordInternalTradePayment(actor, input);
    const journals = state.db.all("journalEntries").filter(row => row.journalType === "internal_funds_transfer");
    expect(journals).toHaveLength(2);
    expect(new Set(journals.map(row => row.referenceId)).size).toBe(1);
    expect(await report("income_statement")).toEqual(beforeIncome);
    expect(await report("trial_balance")).toMatchObject({totalDebitMinor: 900, totalCreditMinor: 900});
    expect(await report("receipts_payments")).toMatchObject({receiptsMinor: 300, paymentsMinor: 0, netCashMovementMinor: 300});
    expect((await report("cash_flow")).rows).toEqual(expect.arrayContaining([{section: "Operating activities", amountMinor: 300}, {section: "Store funding transfers", amountMinor: 0}]));
    expect(await report("receipts_payments", "branch")).toMatchObject({receiptsMinor: 300, paymentsMinor: 200, netCashMovementMinor: 100});
    expect(await report("receipts_payments", "hq")).toMatchObject({receiptsMinor: 200, paymentsMinor: 0, netCashMovementMinor: 200});
    expect((await report("cash_flow", "branch")).rows).toEqual(expect.arrayContaining([{section: "Operating activities", amountMinor: 300}, {section: "Store funding transfers", amountMinor: -200}]));
    expect((await report("cash_flow", "hq")).rows).toEqual(expect.arrayContaining([{section: "Operating activities", amountMinor: 0}, {section: "Store funding transfers", amountMinor: 200}]));
    const after = await report("trial_balance");
    await recordInternalTradePayment(actor, input);
    expect(await report("trial_balance")).toEqual(after);
  });
});
