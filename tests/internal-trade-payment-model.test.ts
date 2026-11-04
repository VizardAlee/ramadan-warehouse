import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import type { AccessProfile } from "../functions/src/auth/authorize";
import { uniquenessDocumentId } from "../functions/src/inventory/calculations";
import { internalTradeBalanceId } from "../functions/src/branch-trading/identity";
import { TransferFirestoreFixture } from "./helpers/transfer-firestore-fixture";
const state = vi.hoisted(() => ({ db: null as unknown as TransferFirestoreFixture }));
vi.mock("../functions/src/admin.js", () => ({ db: {
  doc: (path: string) => state.db.doc(path), collection: (path: string) => state.db.collection(path),
  getAll: (...refs: Parameters<TransferFirestoreFixture["getAll"]>) => state.db.getAll(...refs),
  runTransaction: (handler: Parameters<TransferFirestoreFixture["runTransaction"]>[0]) => state.db.runTransaction(handler),
} }));
import { recordInternalTradePayment, canRecordInternalTradePayment, type InternalTradePaymentInput } from "../functions/src/branch-trading/payments";
const { Timestamp } = createRequire(new URL("../functions/package.json", import.meta.url))("firebase-admin/firestore") as typeof import("firebase-admin/firestore");
const actor: AccessProfile = { userId: "finance", organizationId: "org", roleId: "finance_officer", roleIds: ["finance_officer"], directRoleIds: ["finance_officer"], branchIds: [], warehouseIds: [], authorizationVersion: 1 };
const balancePath = `internalTradeBalances/${internalTradeBalanceId("org", "hq", "branch")}`;
const chart = (code: string) => `chartOfAccounts/${uniquenessDocumentId("org", code)}`;
const payment = (extra: Partial<InternalTradePaymentInput> = {}): InternalTradePaymentInput => ({ action: "record_payment", invoiceId: "invoice", amountMinor: 200, sourceMethod: "cash", destinationMethod: "cash", paymentDate: "2026-01-05T12:00:00.000Z", reference: "Completed payment", confirmedCompleted: true, idempotencyKey: crypto.randomUUID(), ...extra });
beforeEach(() => {
  state.db = new TransferFirestoreFixture();
  for (const branch of ["branch", "hq"]) state.db.seed(`branches/${branch}`, { organizationId: "org", status: "active" });
  const base = { organizationId: "org", branchId: "branch", headOfficeBranchId: "hq", paidMinor: 0, returnedMinor: 0, balanceMinor: 1000, version: 0 };
  state.db.seed("internalTradeInvoices/invoice", { ...base, totalMinor: 1000 });
  state.db.seed(balancePath, { ...base, invoicedMinor: 1000 });
});
describe("internal trade payment handler", () => {
  it("records paired cash journals, preserves configured account metadata and retries exactly once", async () => {
    const registry = { organizationId: "org", code: "1010", name: "Till cash custom label", currency: "NGN", active: true, customNote: "Keep me" };
    state.db.seed(chart("1010"), registry);
    const input = payment();
    state.db.retryNext = true;
    const posted = await recordInternalTradePayment(actor, input);
    expect(await recordInternalTradePayment(actor, input)).toEqual({ ...posted, repeated: true });
    expect(state.db.all("journalEntries")).toHaveLength(2);
    expect(state.db.all("journalLines").map(row => [row.branchId, row.accountCode, row.debitMinor, row.creditMinor])).toEqual(expect.arrayContaining([
      ["branch", "1010", 0, 200], ["branch", "1380", 200, 0], ["hq", "1010", 200, 0], ["hq", "1380", 0, 200],
    ]));
    expect(state.db.row(chart("1010"))).toEqual(registry);
    expect(state.db.row(balancePath).balanceMinor).toBe(800);
    expect(state.db.all("internalTradeEntries")).toHaveLength(1);
  });
  it("records bank movements using the two actual owned accounts", async () => {
    for (const [id, branchId, code] of [["from", "branch", "1041"], ["to", "hq", "1042"]]) state.db.seed(`bankAccounts/${id}`, { organizationId: "org", branchId, active: true, ledgerAccountCode: code, bankName: id, accountName: id });
    await recordInternalTradePayment(actor, payment({ sourceMethod: "bank_transfer", destinationMethod: "bank_transfer", sourceBankAccountId: "from", destinationBankAccountId: "to" }));
    expect(state.db.all("journalLines")).toEqual(expect.arrayContaining([expect.objectContaining({ accountCode: "1041", bankAccountId: "from", creditMinor: 200 }), expect.objectContaining({ accountCode: "1042", bankAccountId: "to", debitMinor: 200 })]));
  });
  it("allocates existing completed transfers without new journals and rejects reuse beyond the amount", async () => {
    const input = payment({ existingFundsTransferId: "existing" });
    const base = { organizationId: "org", journalType: "internal_funds_transfer", referenceType: "companyFundsTransfer", referenceId: "existing", status: "posted", effectiveAt: Timestamp.fromDate(new Date(input.paymentDate)), details: { confirmedCompleted: true, sourceBranchId: "branch", destinationBranchId: "hq", amountMinor: 200 } };
    state.db.seed("journalEntries/existing", { ...base, branchId: "branch" });
    state.db.seed("journalEntries/counterpart", { ...base, branchId: "hq" });
    await recordInternalTradePayment(actor, input);
    expect(state.db.all("journalEntries")).toHaveLength(2);
    expect(state.db.all("journalLines")).toHaveLength(0);
    await expect(recordInternalTradePayment(actor, payment({ existingFundsTransferId: "existing", amountMinor: 1 }))).rejects.toThrow("already allocated");
    expect(state.db.row(balancePath).paidMinor).toBe(200);
  });
  it.each([
    ["internalTradeInvoices/invoice", { totalMinor: 999 }],
    ["internalTradeInvoices/invoice", { paidMinor: -1, balanceMinor: 1001 }],
    ["internalTradeInvoices/invoice", { returnedMinor: 1001, balanceMinor: -1 }],
    [balancePath, { invoicedMinor: 999 }],
    [balancePath, { returnedMinor: -1, balanceMinor: 1001 }],
  ])("rejects corrupt totals atomically (%s, %j)", async (path, patch) => {
    state.db.seed(path, { ...state.db.row(path), ...patch });
    const before = new Map(state.db.rows);
    await expect(recordInternalTradePayment(actor, payment())).rejects.toThrow("reconciliation");
    expect(state.db.rows).toEqual(before);
  });
  it("preserves legitimate aggregate credits caused by returns while settling another invoice", async () => {
    state.db.seed(balancePath, { ...state.db.row(balancePath), invoicedMinor: 2000, paidMinor: 1800, returnedMinor: 500, balanceMinor: -300 });
    await recordInternalTradePayment(actor, payment());
    expect(state.db.row(balancePath).balanceMinor).toBe(-500);
  });
  it.each([
    ["1380", { systemManaged: false }], ["1380", { organizationId: "other" }], ["1010", { active: false }], ["1010", { currency: "USD" }], ["1010", { billingControlPurpose: "receivables" }],
  ])("rejects incompatible account %s without overwriting it", async (code, patch) => {
    state.db.seed(chart(code), { organizationId: "org", code, name: "Existing", active: true, systemManaged: true, currency: "NGN", ...patch });
    const before = new Map(state.db.rows);
    await expect(recordInternalTradePayment(actor, payment())).rejects.toThrow("reconciliation");
    expect(state.db.rows).toEqual(before);
  });
  it("does not promote a custom finance base role with omitted transfer permission", async () => {
    state.db.seed("roles/custom-finance", { organizationId: "org", baseRoleId: "finance_officer", permissionIds: ["banking.read"], status: "active" });
    const restricted = { ...actor, directRoleIds: [], customRoleIds: ["custom-finance"], effectivePermissions: ["banking.transfer"] as const };
    expect(await canRecordInternalTradePayment(restricted)).toBe(false);
    await expect(recordInternalTradePayment(restricted, payment())).rejects.toMatchObject({ code: "permission-denied" });
    expect(state.db.all("journalEntries")).toHaveLength(0);
  });
  it("rejects locked periods and overpayments without posting", async () => {
    await expect(recordInternalTradePayment(actor, payment({ amountMinor: 1001 }))).rejects.toThrow("remaining balance");
    state.db.seed(`accountingPeriods/${uniquenessDocumentId("org", "2026-01")}`, { periodKey: "2026-01", status: "closed" });
    await expect(recordInternalTradePayment(actor, payment())).rejects.toThrow("closed");
    expect(state.db.all("journalEntries")).toHaveLength(0);
  });
});
