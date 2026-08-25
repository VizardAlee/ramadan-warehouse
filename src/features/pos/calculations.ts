import type { PosCartLine } from "./types";

export interface PosCartTotals {
  netAmountMinor: number;
  vatAmountMinor: number;
  grossAmountMinor: number;
  totalQuantity: number;
}

export function calculatePosCart(lines: readonly PosCartLine[]): PosCartTotals {
  return lines.reduce<PosCartTotals>(
    (totals, line) => {
      if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0)
        throw new Error("Cart quantities must be positive whole numbers.");
      const net = line.quantity * line.product.unitPriceMinor;
      const vat = Math.round(
        (net * line.product.vatRateBasisPoints) / 10_000,
      );
      const gross = net + vat;
      if (![net, vat, gross].every(Number.isSafeInteger))
        throw new Error("The cart total is too large.");
      return {
        netAmountMinor: totals.netAmountMinor + net,
        vatAmountMinor: totals.vatAmountMinor + vat,
        grossAmountMinor: totals.grossAmountMinor + gross,
        totalQuantity: totals.totalQuantity + line.quantity,
      };
    },
    {
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
