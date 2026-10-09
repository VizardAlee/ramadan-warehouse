import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { commitSaleInput } from "../functions/src/validation/sales";
import { queueOfflineSale } from "../src/features/pos/offline-store";
import type { QueuedPosSale } from "../src/features/pos/types";
import { customerHistoryLabel, customerHistoryTone } from "../src/features/customers/history-presentation";

const sale = { branchId: "branch", shiftId: "shift", deviceId: "device", recordedAt: new Date().toISOString(), customerId: "customer", lines: [{ productId: "product", quantity: 1 }], payments: [{ method: "customer_advance", amountMinor: 1000 }], idempotencyKey: "f2e0312b-e592-4fd8-a937-c174f5904523" };

describe("POS customer advances", () => {
  it("supports full and split advance tenders without inventing a new bank receipt", () => {
    expect(commitSaleInput.safeParse(sale).success).toBe(true);
    expect(commitSaleInput.safeParse({ ...sale, creditAmountMinor: 100, payments: [...sale.payments, { method: "cash", amountMinor: 100 }] }).success).toBe(true);
    for (const invalid of [
      { ...sale, customerId: undefined }, { ...sale, offline: true },
      { ...sale, payments: [...sale.payments, ...sale.payments] },
      { ...sale, payments: [{ ...sale.payments[0], bankAccountId: "bank" }] },
      { ...sale, payments: [{ ...sale.payments[0], reference: "not-a-bank-receipt" }] },
    ]) expect(commitSaleInput.safeParse(invalid).success).toBe(false);
  });

  it("rejects advance tenders before opening offline device storage", async () => {
    await expect(queueOfflineSale({ payload: sale } as unknown as QueuedPosSale)).rejects.toThrow("cannot be queued offline");
  });

  it("explains advance use in history and exposes online balance checks in POS", () => {
    expect(customerHistoryLabel("account", "advance_sale")).toBe("Advance used for sale");
    expect(customerHistoryTone("account", "advance_sale")).toBe("balance");
    const page = readFileSync("src/app/(protected)/pos/page.tsx", "utf8");
    expect(page).toContain('value="customer_advance"');
    expect(page).toContain("Unused advance on this customer account");
    expect(page).toContain("!advanceValid");
    expect(page).toContain("requestedAdvanceMinor <= availableAdvanceMinor");
  });
});
