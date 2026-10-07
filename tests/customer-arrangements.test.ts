import { describe, expect, it } from "vitest";
import { changeArrangementBalance, customerArrangements, selectedArrangement, upsertArrangement } from "../functions/src/sales/customer-arrangements";
import { customerPaymentInput, commitSaleInput } from "../functions/src/validation/sales";

const id = "11111111-1111-4111-8111-111111111111";
const data = { outstandingBalanceMinor: 300, arrangements: [{ id, name: "Installation", active: true, outstandingBalanceMinor: 200 }] };
describe("customer account arrangements", () => {
  it("keeps historical debt in general without inventing allocations", () => {
    expect(customerArrangements({ outstandingBalanceMinor: 300 })).toEqual([{ id: "general", name: "General account", active: true, outstandingBalanceMinor: 300 }]);
    expect(customerArrangements(data)[0]!.outstandingBalanceMinor).toBe(100);
  });
  it("isolates debits and repayments and leaves input snapshots unchanged", () => {
    expect(changeArrangementBalance(data, [{ accountId: id, amountMinor: -50 }])[0]!.outstandingBalanceMinor).toBe(150);
    expect(data.arrangements[0]!.outstandingBalanceMinor).toBe(200);
    expect(() => changeArrangementBalance(data, [{ accountId: "general", amountMinor: -101 }])).toThrow(/exceeds/);
    expect(() => changeArrangementBalance(data, [{ accountId: id, amountMinor: -201 }])).toThrow(/exceeds/);
  });
  it("rejects inconsistent projections, unknown accounts and inactive sales accounts", () => {
    expect(() => customerArrangements({ ...data, outstandingBalanceMinor: 199 })).toThrow(/do not match/);
    expect(() => selectedArrangement(data, "unknown")).toThrow(/active account/);
    expect(() => selectedArrangement({ ...data, arrangements: [{ ...data.arrangements[0]!, active: false }] }, id)).toThrow(/active account/);
  });
  it("cannot deactivate debt or duplicate a name, but preserves balances on rename", () => {
    expect(() => upsertArrangement(data, { id, name: "Project", active: false })).toThrow(/Settle/);
    expect(() => upsertArrangement(data, { id: crypto.randomUUID(), name: "installation", active: true })).toThrow(/unique/);
    expect(upsertArrangement(data, { id, name: "Project", active: true })[0]).toMatchObject({ name: "Project", outstandingBalanceMinor: 200 });
  });
  it("validates exact, unique payment allocations and account/customer pairing", () => {
    const payment = { customerId: "customer", branchId: "branch", method: "cash", amountMinor: 100, idempotencyKey: crypto.randomUUID() };
    expect(customerPaymentInput.safeParse({ ...payment, allocations: [{ accountId: id, amountMinor: 100 }] }).success).toBe(true);
    expect(customerPaymentInput.safeParse({ ...payment, allocations: [{ accountId: id, amountMinor: 99 }] }).success).toBe(false);
    expect(customerPaymentInput.safeParse({ ...payment, allocations: [{ accountId: id, amountMinor: 50 }, { accountId: id, amountMinor: 50 }] }).success).toBe(false);
    expect(commitSaleInput.safeParse({ branchId: "branch", shiftId: "shift", deviceId: "device", recordedAt: new Date().toISOString(), lines: [{ productId: "product", quantity: 1 }], payments: [{ method: "cash", amountMinor: 100 }], customerAccountId: id, idempotencyKey: crypto.randomUUID() }).success).toBe(false);
  });
});
