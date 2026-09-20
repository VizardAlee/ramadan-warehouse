import type { HeldPosSale, PosCartLine, PosProduct } from "./types";

export interface PosCartTotals {
  subtotalAmountMinor: number;
  discountAmountMinor: number;
  netAmountMinor: number;
  vatAmountMinor: number;
  grossAmountMinor: number;
  totalQuantity: number;
}

export interface ReconciledHeldCart {
  lines: PosCartLine[];
  adjustedProductCount: number;
  omittedProductCount: number;
}

export function reconcileHeldCart(
  heldLines: HeldPosSale["lines"],
  products: readonly PosProduct[],
  unavailableQuantityByProduct: ReadonlyMap<string, number> = new Map(),
): ReconciledHeldCart {
  const productById = new Map(products.map((product) => [product.id, product]));
  let adjustedProductCount = 0;
  let omittedProductCount = 0;
  const lines = heldLines.flatMap<PosCartLine>((heldLine) => {
    const product = productById.get(heldLine.productId);
    if (!product || !Number.isSafeInteger(heldLine.quantity) || heldLine.quantity <= 0) {
      omittedProductCount += 1;
      return [];
    }
    const available = Math.max(
      0,
      product.availableQuantity -
        (unavailableQuantityByProduct.get(product.id) ?? 0),
    );
    if (available === 0) {
      omittedProductCount += 1;
      return [];
    }
    const quantity = Math.min(heldLine.quantity, available);
    if (quantity !== heldLine.quantity) adjustedProductCount += 1;
    return [{ product, quantity }];
  });
  return { lines, adjustedProductCount, omittedProductCount };
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
