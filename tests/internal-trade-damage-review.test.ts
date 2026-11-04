import { beforeEach, describe, expect, it, vi } from "vitest";
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
import { canReviewInternalTradeDamage, internalTradeDamageReviewInput, reviewInternalTradeDamage } from "../functions/src/branch-trading/damage-review";
const actor: AccessProfile = { organizationId: "org", userId: "admin", roleId: "operations_administrator", roleIds: ["operations_administrator"], directRoleIds: ["operations_administrator"], effectivePermissions: ["transfers.cost.create"], branchIds: [], warehouseIds: [], authorizationVersion: 1 };
const balancePath = `internalTradeBalances/${internalTradeBalanceId("org", "hq", "branch")}`;
const input = (decision: "charge" | "no_charge" = "charge", quantity = 1) => ({ action: "review_damage" as const, invoiceId: "invoice", version: 1, decision, lines: [{ id: "line", quantity }], note: "Inspected damage and established responsibility", idempotencyKey: crypto.randomUUID() });
beforeEach(() => {
  state.db = new TransferFirestoreFixture();
  state.db.seed("internalTradeInvoices/invoice", { organizationId: "org", branchId: "branch", headOfficeBranchId: "hq", totalMinor: 600, paidMinor: 0, returnedMinor: 0, balanceMinor: 600, version: 1,
    lines: [{ id: "line", productId: "product", productName: "Panel", sku: "PV", trackingType: "quantity", unitPriceMinor: 200, receivedQuantity: 3, returnedQuantity: 0, serialItemIds: [], returnedSerialItemIds: [], damagedQuantity: 3, pendingDamagedQuantity: 3, chargedDamagedQuantity: 0, waivedDamagedQuantity: 0 }] });
  state.db.seed(balancePath, { organizationId: "org", branchId: "branch", headOfficeBranchId: "hq", invoicedMinor: 600, paidMinor: 0, returnedMinor: 0, balanceMinor: 600, version: 1 });
});
describe("held internal-trade damage charging", () => {
  it("requires direct administrator and existing price permission, including on replay", async () => {
    expect(canReviewInternalTradeDamage(actor)).toBe(true);
    const custom = { ...actor, directRoleIds: [] };
    expect(canReviewInternalTradeDamage(custom)).toBe(false);
    await expect(reviewInternalTradeDamage(custom, input())).rejects.toMatchObject({ code: "permission-denied" });
    const request = input(); await reviewInternalTradeDamage(actor, request);
    await expect(reviewInternalTradeDamage({ ...actor, effectivePermissions: [] }, request)).rejects.toMatchObject({ code: "permission-denied" });
  });
  it("charges only reviewed pending damage at immutable price, without any stock or external entries", async () => {
    const result = await reviewInternalTradeDamage(actor, input("charge", 2));
    expect(result).toMatchObject({ amountMinor: 400, repeated: false, entryId: "invoice_000000000002" });
    expect(state.db.row("internalTradeInvoices/invoice")).toMatchObject({ totalMinor: 1000, balanceMinor: 1000, version: 2, lines: [expect.objectContaining({ receivedQuantity: 3, pendingDamagedQuantity: 1, chargedDamagedQuantity: 2, waivedDamagedQuantity: 0 })] });
    expect(state.db.row(balancePath)).toMatchObject({ invoicedMinor: 1000, balanceMinor: 1000, version: 2 });
    expect(state.db.row("internalTradeEntries/invoice_000000000002")).toMatchObject({ kind: "damage_charge", amountMinor: 400, signedAmountMinor: 400, invoiceVersion: 2, lines: [{ id: "line", productId: "product", quantity: 2, unitPriceMinor: 200, reviewedValueMinor: 400, amountMinor: 400 }] });
    for (const collection of ["inventoryBalances", "inventoryTransactions", "inventoryEntries", "journalEntries", "journalLines", "supplierAccountEntries"]) expect(state.db.all(collection)).toHaveLength(0);
  });
  it("waives pending damage without charging or changing balance", async () => {
    const initial = { ...state.db.row(balancePath) };
    const result = await reviewInternalTradeDamage(actor, input("no_charge", 2));
    expect(result.amountMinor).toBe(0);
    expect(state.db.row(balancePath)).toEqual(initial);
    expect(state.db.row("internalTradeInvoices/invoice")).toMatchObject({ totalMinor: 600, balanceMinor: 600, lines: [expect.objectContaining({ pendingDamagedQuantity: 1, waivedDamagedQuantity: 2, chargedDamagedQuantity: 0 })] });
    expect(state.db.row(`internalTradeEntries/${result.entryId}`)).toMatchObject({ kind: "damage_waiver", amountMinor: 0, signedAmountMinor: 0, reviewedValueMinor: 400 });
  });
  it("enforces accounting locks on charges but permits nonfinancial waiver", async () => {
    state.db.seed(`accountingPeriods/${uniquenessDocumentId("org", new Date().toISOString().slice(0, 7))}`, { status: "closed" });
    await expect(reviewInternalTradeDamage(actor, input())).rejects.toMatchObject({ code: "failed-precondition" });
    expect(state.db.row("internalTradeInvoices/invoice")).toMatchObject({ version: 1, totalMinor: 600 });
    await reviewInternalTradeDamage(actor, input("no_charge"));
    expect(state.db.row("internalTradeInvoices/invoice")).toMatchObject({ version: 2, totalMinor: 600 });
  });
  it("replays exact actor and payload once, rejects changed or stolen retry keys", async () => {
    const request = input(), result = await reviewInternalTradeDamage(actor, request);
    expect(await reviewInternalTradeDamage(actor, request)).toEqual({ ...result, repeated: true });
    await expect(reviewInternalTradeDamage(actor, { ...request, decision: "no_charge" })).rejects.toMatchObject({ code: "already-exists" });
    await expect(reviewInternalTradeDamage({ ...actor, userId: "other-admin" }, request)).rejects.toMatchObject({ code: "already-exists" });
    expect(state.db.all("internalTradeEntries")).toHaveLength(1);
    expect(state.db.all("internalTradeDamageReviews")).toHaveLength(1);
  });
  it("rejects stale versions, over-review and mismatched damage history atomically", async () => {
    await expect(reviewInternalTradeDamage(actor, { ...input(), version: 0 })).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(reviewInternalTradeDamage(actor, input("charge", 4))).rejects.toMatchObject({ code: "failed-precondition" });
    const invoice = state.db.row("internalTradeInvoices/invoice");
    state.db.seed("internalTradeInvoices/invoice", { ...invoice, lines: [{ ...(invoice.lines as object[])[0], damagedQuantity: 4 }] });
    await expect(reviewInternalTradeDamage(actor, input())).rejects.toThrow(/quantity history/);
    state.db.seed("internalTradeInvoices/invoice", { ...invoice, lines: [(invoice.lines as object[])[0], { ...(invoice.lines as object[])[0] }] });
    await expect(reviewInternalTradeDamage(actor, input())).rejects.toMatchObject({ code: "failed-precondition" });
    expect(state.db.all("internalTradeDamageReviews")).toHaveLength(0);
    expect(state.db.row(balancePath)).toMatchObject({ invoicedMinor: 600 });
  });
  it("sequences charge and waiver reviews and cannot review resolved quantity again", async () => {
    await reviewInternalTradeDamage(actor, input("charge", 2));
    await reviewInternalTradeDamage(actor, { ...input("no_charge"), version: 2 });
    await expect(reviewInternalTradeDamage(actor, { ...input(), version: 3 })).rejects.toThrow(/still awaiting/);
    expect(state.db.all("internalTradeEntries").map(row => row.entryId)).toEqual(["invoice_000000000002", "invoice_000000000003"]);
    expect(state.db.row("internalTradeInvoices/invoice")).toMatchObject({ totalMinor: 1000, lines: [expect.objectContaining({ pendingDamagedQuantity: 0, chargedDamagedQuantity: 2, waivedDamagedQuantity: 1 })] });
  });
  it("rolls back failed commit and reruns transaction without duplicate charge", async () => {
    state.db.failNextCommitFor = "internalTradeDamageReviews/";
    await expect(reviewInternalTradeDamage(actor, input())).rejects.toThrow(/Injected/);
    expect(state.db.row("internalTradeInvoices/invoice")).toMatchObject({ version: 1, totalMinor: 600 });
    state.db.retryNext = true;
    await reviewInternalTradeDamage(actor, input());
    expect(state.db.row("internalTradeInvoices/invoice")).toMatchObject({ version: 2, totalMinor: 800 });
    expect(state.db.all("internalTradeEntries")).toHaveLength(1);
  });
  it("rejects client price injection and duplicate line quantities", async () => {
    expect(internalTradeDamageReviewInput.safeParse({ ...input(), unitPriceMinor: 1 }).success).toBe(false);
    expect(internalTradeDamageReviewInput.safeParse({ ...input(), lines: [{ id: "line", quantity: 1, unitPriceMinor: 1 }] }).success).toBe(false);
    await expect(reviewInternalTradeDamage(actor, { ...input(), lines: [{ id: "line", quantity: 1 }, { id: "line", quantity: 1 }] })).rejects.toMatchObject({ code: "invalid-argument" });
  });
});
