import { describe, expect, it } from "vitest";
import { inventoryLocationLabel, summarizeInventoryMovements } from "../src/features/inventory/movement-presentation";
import type { InventoryEntry } from "../src/types/domain";

function line(overrides: Partial<InventoryEntry>): InventoryEntry {
  return {
    id: "entry-1", organizationId: "org", transactionId: "sale-1",
    transactionNumber: "INV-2026-000015", transactionType: "branch_sale",
    productId: "product-1", sku: "BAT-10", quantityDelta: -1,
    unitCostMinor: 80000000, valueDeltaMinor: -80000000, currency: "NGN",
    balanceBefore: 2, balanceAfter: 1, effectiveAt: "2026-09-28T18:23:00.000Z",
    postedBy: "user-1", reason: "Branch POS sale", createdAt: "2026-09-28T18:23:00.000Z",
    ...overrides,
  };
}

const locations = { "branch-stock": "Igbo Road Branch Stock", "hq-stock": "Head Office Stock" };

describe("inventory movement presentation", () => {
  it("shows a sale as one event instead of two balancing ledger lines", () => {
    const events = summarizeInventoryMovements([
      line({ locationId: "branch-stock" }),
      line({ id: "entry-2", locationId: undefined, externalAccount: "customer_sales", quantityDelta: 1, balanceAfter: 0 }),
    ], locations);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ title: "Sold to customer", quantity: 1, balanceAfter: 1, description: "Sold 1 from Igbo Road Branch Stock." });
    expect(events[0]?.entries).toHaveLength(2);
  });

  it("describes a transfer by its source and destination without inventing a net stock change", () => {
    const events = summarizeInventoryMovements([
      line({ transactionId: "transfer-1", transactionType: "location_transfer", locationId: "branch-stock", quantityDelta: -3 }),
      line({ id: "entry-2", transactionId: "transfer-1", transactionType: "location_transfer", locationId: "hq-stock", quantityDelta: 3 }),
    ], locations);
    expect(events[0]).toMatchObject({ title: "Stock moved", quantity: 3, description: "Moved 3 from Igbo Road Branch Stock to Head Office Stock." });
    expect(events[0]?.balanceAfter).toBeUndefined();
  });

  it("shows a purchase receipt once rather than showing the supplier offset as stock removed", () => {
    const events = summarizeInventoryMovements([
      line({ transactionId: "receipt-1", transactionType: "inventory_receipt", locationId: "hq-stock", quantityDelta: 20, balanceAfter: 20 }),
      line({ id: "entry-2", transactionId: "receipt-1", transactionType: "inventory_receipt", locationId: undefined, externalAccount: "supplier:abc123", quantityDelta: -20, balanceAfter: 0 }),
    ], locations);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ title: "Stock received", description: "Received 20 into Head Office Stock.", balanceAfter: 20 });
  });

  it("labels external balancing entries without exposing opaque references", () => {
    expect(inventoryLocationLabel(line({ locationId: undefined, externalAccount: "supplier:abc123" }), locations)).toBe("Supplier");
    expect(inventoryLocationLabel(line({ locationId: "unknown-location" }), locations)).toBe("Stock location");
  });
});
