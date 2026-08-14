import { createHash } from "node:crypto";

export interface CostedBalance {
  readonly quantity: number;
  readonly totalValueMinor: number;
  readonly averageUnitCostMinor: number;
}

export function normalizeInventoryIdentifier(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}
export function generateCategoryCode(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
  if (slug.length >= 2 && slug.length <= 40) return slug;
  const digest = createHash("sha256")
    .update(normalizeInventoryIdentifier(name))
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();
  return `${(slug || "CATEGORY").slice(0, 31)}-${digest}`;
}
export function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value))
    throw new Error(`${label} must be a safe integer.`);
}
export function receiptCost(
  balance: CostedBalance,
  quantity: number,
  unitCostMinor: number,
): CostedBalance {
  assertSafeInteger(quantity, "Quantity");
  assertSafeInteger(unitCostMinor, "Unit cost");
  const nextQuantity = balance.quantity + quantity;
  const nextValue = balance.totalValueMinor + quantity * unitCostMinor;
  assertSafeInteger(nextValue, "Inventory value");
  return {
    quantity: nextQuantity,
    totalValueMinor: nextValue,
    averageUnitCostMinor:
      nextQuantity === 0 ? 0 : Math.round(nextValue / nextQuantity),
  };
}
export function issueCost(
  balance: CostedBalance,
  quantity: number,
  explicitValueMinor?: number,
): {
  balance: CostedBalance;
  movementValueMinor: number;
  unitCostMinor: number;
} {
  if (quantity <= 0 || quantity > balance.quantity)
    throw new Error("Insufficient stock.");
  const unitCostMinor =
    balance.quantity === 0
      ? 0
      : Math.round(balance.totalValueMinor / balance.quantity);
  const movementValueMinor = explicitValueMinor ?? quantity * unitCostMinor;
  const nextQuantity = balance.quantity - quantity;
  const nextValue =
    nextQuantity === 0 ? 0 : balance.totalValueMinor - movementValueMinor;
  if (nextValue < 0) throw new Error("Inventory value cannot become negative.");
  return {
    balance: {
      quantity: nextQuantity,
      totalValueMinor: nextValue,
      averageUnitCostMinor:
        nextQuantity === 0 ? 0 : Math.round(nextValue / nextQuantity),
    },
    movementValueMinor,
    unitCostMinor:
      quantity === 0 ? 0 : Math.round(movementValueMinor / quantity),
  };
}
export function balanceDocumentId(
  organizationId: string,
  productId: string,
  locationId: string,
  lotId?: string,
): string {
  return [organizationId, productId, locationId, lotId ?? "base"]
    .map(encodeURIComponent)
    .join("__");
}
export function uniquenessDocumentId(...values: string[]): string {
  return values
    .map((value) => encodeURIComponent(normalizeInventoryIdentifier(value)))
    .join("__");
}
export function parseSerialNumbers(values: readonly string[]): {
  normalized: string[];
  duplicates: string[];
} {
  const normalized = values.map(normalizeInventoryIdentifier).filter(Boolean);
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of normalized) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return { normalized, duplicates: [...duplicates] };
}
