import type { PosCartLine } from "./types";

export interface PosCartTotals {
  subtotalAmountMinor: number;
  discountAmountMinor: number;
  netAmountMinor: number;
  vatAmountMinor: number;
  grossAmountMinor: number;
  totalQuantity: number;
}

export function calculatePosCart(
  lines: readonly PosCartLine[],
  discountAmountMinor = 0,
): PosCartTotals {
  if (!Number.isSafeInteger(discountAmountMinor) || discountAmountMinor < 0)
    throw new Error("Discount must be a non-negative amount in kobo.");
  const subtotalAmountMinor = lines.reduce((sum, line) => {
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0)
      throw new Error("Cart quantities must be positive whole numbers.");
    return sum + line.quantity * line.product.unitPriceMinor;
  }, 0);
  if (discountAmountMinor > subtotalAmountMinor)
    throw new Error("Discount cannot exceed the product subtotal.");
  let allocatedDiscountMinor = 0;
  let lineIndex = 0;
  return lines.reduce<PosCartTotals>(
    (totals, line) => {
      if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0)
        throw new Error("Cart quantities must be positive whole numbers.");
      const subtotal = line.quantity * line.product.unitPriceMinor;
      const lineDiscount =
        discountAmountMinor === 0
          ? 0
          : lineIndex === lines.length - 1
          ? discountAmountMinor - allocatedDiscountMinor
          : Math.floor(
              (discountAmountMinor * subtotal) / subtotalAmountMinor,
            );
      allocatedDiscountMinor += lineDiscount;
      lineIndex += 1;
      const net = subtotal - lineDiscount;
      const vat = Math.round(
        (net * line.product.vatRateBasisPoints) / 10_000,
      );
      const gross = net + vat;
      if (![net, vat, gross].every(Number.isSafeInteger))
        throw new Error("The cart total is too large.");
      return {
        subtotalAmountMinor,
        discountAmountMinor,
        netAmountMinor: totals.netAmountMinor + net,
        vatAmountMinor: totals.vatAmountMinor + vat,
        grossAmountMinor: totals.grossAmountMinor + gross,
        totalQuantity: totals.totalQuantity + line.quantity,
      };
    },
    {
      subtotalAmountMinor,
      discountAmountMinor,
      netAmountMinor: 0,
      vatAmountMinor: 0,
      grossAmountMinor: 0,
      totalQuantity: 0,
    },
  );
}

export function provisionalReceiptReference(
  branchCode: string,
  now = new Date(),
  id = crypto.randomUUID(),
) {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `OFF-${branchCode}-${date}-${id.slice(0, 8).toUpperCase()}`;
}
