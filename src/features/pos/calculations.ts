import { calculateSale } from "../../../functions/src/sales/calculations";
import type { HeldPosSale, PosCartLine, PosProduct } from "./types";

export interface PosCartTotals {
  subtotalAmountMinor: number;
  discountAmountMinor: number;
  netAmountMinor: number;
  vatAmountMinor: number;
  grossAmountMinor: number;
  totalQuantity: number;
  providerFundsMinor?: number;
  priorServicePaidMinor?: number;
  discountableSubtotalMinor?: number;
}

export interface ReconciledHeldCart {
  lines: PosCartLine[];
  adjustedProductCount: number;
  omittedProductCount: number;
  resetPriceCount: number;
}

export function posLineUnitPriceMinor(line: PosCartLine): number {
  return line.sellingPriceMinor ?? line.product.unitPriceMinor;
}

export function productForPriceTier(product: PosProduct, tier: "retail" | "wholesale"): PosProduct {
  if (tier === "retail") return product;
  if (!Number.isSafeInteger(product.wholesalePriceMinor) || Number(product.wholesalePriceMinor) <= 0 || !product.centralPriceVersion)
    throw new Error(`Wholesale price is not configured for ${product.name}.`);
  return { ...product, unitPriceMinor: Number(product.wholesalePriceMinor), priceVersion: product.centralPriceVersion, priceSource: "wholesale" };
}

export function reconcileHeldCart(
  heldLines: HeldPosSale["lines"],
  products: readonly PosProduct[],
  unavailableQuantityByProduct: ReadonlyMap<string, number> = new Map(),
): ReconciledHeldCart {
  const productById = new Map(products.map((product) => [product.id, product]));
  let adjustedProductCount = 0;
  let omittedProductCount = 0;
  let resetPriceCount = 0;
  const lines = heldLines.flatMap<PosCartLine>((heldLine) => {
    const catalogProduct = productById.get(heldLine.productId);
    if (!catalogProduct || !Number.isSafeInteger(heldLine.quantity) || heldLine.quantity <= 0) {
      omittedProductCount += 1;
      return [];
    }
    let product: PosProduct;
    try { product = productForPriceTier(catalogProduct, heldLine.priceTier ?? "retail"); }
    catch { omittedProductCount += 1; return []; }
    const available = Math.max(
      0,
      product.itemKind === "service" ? 100_000 : product.availableQuantity -
        (unavailableQuantityByProduct.get(product.id) ?? 0),
    );
    if (available === 0) {
      omittedProductCount += 1;
      return [];
    }
    const quantity = Math.min(heldLine.quantity, available);
    if (quantity !== heldLine.quantity) adjustedProductCount += 1;
    const keepPrice = heldLine.sellingPriceMinor !== undefined &&
      heldLine.catalogUnitPriceMinor === product.unitPriceMinor &&
      Number.isSafeInteger(heldLine.sellingPriceMinor) &&
      heldLine.sellingPriceMinor > 0 &&
      Boolean(heldLine.priceOverrideReason);
    if (heldLine.sellingPriceMinor !== undefined && !keepPrice) resetPriceCount += 1;
    return [{
      product,
      quantity,
      ...(heldLine.includedParts ? { includedParts: heldLine.includedParts } : {}),
      ...(heldLine.providerFunds ? { providerFunds: heldLine.providerFunds } : {}),
      ...(heldLine.serviceCase ? { serviceCase: heldLine.serviceCase, caseVerified: false } : {}),
      ...(product.trackingType === "serial" ? { serialNumbers: heldLine.serialNumbers?.slice(0, quantity) ?? [] } : {}),
      ...(heldLine.priceTier ? { priceTier: heldLine.priceTier } : {}),
      ...(keepPrice ? {
        sellingPriceMinor: heldLine.sellingPriceMinor,
        priceOverrideReason: heldLine.priceOverrideReason,
      } : {}),
    }];
  });
  return { lines, adjustedProductCount, omittedProductCount, resetPriceCount };
}

export function calculatePosCart(
  lines: readonly PosCartLine[],
  discountAmountMinor = 0,
): PosCartTotals {
  if (!lines.length) {
    if (discountAmountMinor !== 0) throw new Error("Discount cannot exceed the product subtotal.");
    return { subtotalAmountMinor: 0, discountAmountMinor: 0, netAmountMinor: 0, vatAmountMinor: 0, grossAmountMinor: 0, totalQuantity: 0 };
  }
  for (const line of lines) if (posLineUnitPriceMinor(line) <= 0) throw new Error("Sale prices must be positive whole amounts in kobo.");
  const result = (() => { try { return calculateSale(lines.map(line => ({ quantity: line.quantity, unitPriceMinor: posLineUnitPriceMinor(line), vatRateBasisPoints: line.product.vatRateBasisPoints, unitCostMinor: 0, ...(line.serviceCase ? { fixedGrossMinor: line.serviceCase.grossMinor, fixedVatMinor: line.serviceCase.vatMinor } : {}) })), discountAmountMinor); } catch (cause) { if (cause instanceof Error && cause.message.includes("safe integer") && !cause.message.startsWith("VAT rate")) throw new Error("Cart totals are too large. Reduce quantities or prices."); throw cause; } })();
  const providerFundsMinor = lines.reduce((sum, line) => sum + (line.providerFunds?.amountMinor ?? 0), 0), priorServicePaidMinor = lines.reduce((sum, line) => sum + (line.serviceCase?.paidMinor ?? 0), 0), grossAmountMinor = result.grossAmountMinor + providerFundsMinor;
  if (![providerFundsMinor, priorServicePaidMinor, grossAmountMinor].every(value => Number.isSafeInteger(value) && value >= 0) || priorServicePaidMinor > grossAmountMinor) throw new Error("The bill contains invalid provider or prior receipt amounts.");
  return { subtotalAmountMinor: result.subtotalAmountMinor, discountAmountMinor, netAmountMinor: result.netAmountMinor, vatAmountMinor: result.vatAmountMinor, grossAmountMinor, totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0), ...(providerFundsMinor ? { providerFundsMinor } : {}), ...(priorServicePaidMinor ? { priorServicePaidMinor } : {}), ...(lines.some(line => line.serviceCase) ? { discountableSubtotalMinor: lines.reduce((sum, line) => sum + (line.serviceCase ? 0 : line.quantity * posLineUnitPriceMinor(line)), 0) } : {}) };
}

export function provisionalReceiptReference(
  branchCode: string,
  now = new Date(),
  id = crypto.randomUUID(),
) {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `OFF-${branchCode}-${date}-${id.slice(0, 8).toUpperCase()}`;
}
