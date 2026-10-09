import { describe, expect, it, vi } from "vitest";
import type { DocumentSnapshot, Transaction } from "firebase-admin/firestore";
import { readSaleSerials, changeSaleSerials, serialCost, writeSaleSerialEntries } from "../functions/src/sales/serials";

const scope = { organizationId: "org", locationId: "store", saleId: "sale" };
const line = { productId: "product", trackingType: "serial", quantity: 1, serialNumbers: ["SN"], saleItemId: "item" };
function snapshot(overrides: Record<string, unknown> = {}) {
  const data = { organizationId: "org", productId: "product", currentLocationId: "store", serialNumber: "SN", currentUnitCostMinor: 7, active: true, status: "at_branch", ...overrides };
  return { id: "serial", ref: { path: "serializedItems/serial" }, exists: true, get: (key: string) => data[key as keyof typeof data] } as unknown as DocumentSnapshot;
}
function transaction(serial = snapshot()) {
  return { getAll: vi.fn(async () => [serial]), update: vi.fn<(ref: unknown, data: Record<string, unknown>) => void>(), create: vi.fn<(ref: unknown, data: Record<string, unknown>) => void>() };
}
describe("sale serial ownership", () => {
  it("rejects wrong scope, inactive, sold, held and transfer-reserved units before writing", async () => {
    for (const overrides of [{ organizationId: "other" }, { productId: "other" }, { currentLocationId: "other" }, { active: false }, { status: "sold" }, { status: "returned_held" }, { reservedTransferId: "transfer" }, { reservedSaleId: "other-sale" }, { currentUnitCostMinor: -1 }]) {
      const tx = transaction(snapshot(overrides));
      await expect(readSaleSerials(tx as unknown as Transaction, scope, [line], "reserve")).rejects.toMatchObject({ code: "failed-precondition" });
      expect(tx.update).not.toHaveBeenCalled();
    }
  });
  it("requires the exact owning invoice and line for collection and return", async () => {
    const reserved = transaction(snapshot({ status: "reserved", reservedSaleId: "sale", reservedSaleItemId: "item" }));
    await expect(readSaleSerials(reserved as unknown as Transaction, scope, [line], "collect")).resolves.toHaveLength(1);
    await expect(readSaleSerials(reserved as unknown as Transaction, { ...scope, saleId: "other" }, [line], "cancel")).rejects.toMatchObject({ code: "failed-precondition" });
    const sold = transaction(snapshot({ status: "sold", active: false, currentLocationId: null, saleId: "sale", saleItemId: "item" }));
    await expect(readSaleSerials(sold as unknown as Transaction, scope, [line], "return")).resolves.toHaveLength(1);
    await expect(readSaleSerials(sold as unknown as Transaction, scope, [{ ...line, saleItemId: "other" }], "return")).rejects.toMatchObject({ code: "failed-precondition" });
  });
  it("rejects normalized duplicates and quantity mismatches before reading", async () => {
    const tx = transaction();
    await expect(readSaleSerials(tx as unknown as Transaction, scope, [{ ...line, quantity: 2, serialNumbers: ["SN", " sn "] }], "sell")).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(readSaleSerials(tx as unknown as Transaction, scope, [{ ...line, quantity: 2 }], "sell")).rejects.toMatchObject({ code: "invalid-argument" });
    expect(tx.getAll).not.toHaveBeenCalled();
  });
  it("posts per-unit exact costs, running balances, and held return ownership", () => {
    const tx = transaction(), serials = [snapshot(), snapshot({ serialNumber: "SECOND", currentUnitCostMinor: 8 })];
    expect(serialCost(serials)).toBe(15);
    writeSaleSerialEntries(tx as unknown as Transaction, serials, { transactionId: "movement" }, { locationId: "store", branchId: "branch", balanceBefore: 2, direction: -1, reservedDirection: -1, externalAccount: "customer_sales" });
    expect(tx.create.mock.calls.map(call => call[1])).toEqual([
      expect.objectContaining({ serialNumber: "SN", quantityDelta: -1, valueDeltaMinor: -7, balanceBefore: 2, balanceAfter: 1 }),
      expect.objectContaining({ valueDeltaMinor: 7, quantityDelta: 1 }),
      expect.objectContaining({ serialNumber: "SECOND", valueDeltaMinor: -8, balanceBefore: 1, balanceAfter: 0 }),
      expect.objectContaining({ valueDeltaMinor: 8, quantityDelta: 1 }),
    ]);
    changeSaleSerials(tx as unknown as Transaction, [serials[0]!], "return", { saleId: "sale", saleItemId: "item", locationId: "store", branchId: "branch", userId: "user", returnId: "return", resellable: false });
    expect(tx.update).toHaveBeenCalledWith(serials[0]!.ref, expect.objectContaining({ status: "returned_held", active: false, currentLocationId: null, saleId: "sale", lastSaleReturnId: "return" }));
  });
});
