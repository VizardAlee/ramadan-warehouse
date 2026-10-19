export interface ProfitRow {
  providerOriginalMinor?: number; providerCreditedMinor?: number; providerNetMinor?: number;
  itemKind?: "goods" | "service" | "mixed_history"; productId: string; sku: string; productName: string;
  invoicedQuantity: number; reversedQuantity: number; invoicedNetMinor: number; reversedNetMinor: number;
  netSalesMinor: number; recordedCostMinor: number; restockCreditMinor: number; netRecordedCostMinor: number;
  unknownCostLines: number; grossMarginMinor: number | null;
}
export type ProfitOrder = "product" | "highest" | "lowest" | "margin-high" | "margin-low" | "unknown";
const tie = (a: { sku: string; productId: string }, b: { sku: string; productId: string }) => a.sku.localeCompare(b.sku) || a.productId.localeCompare(b.productId);
export function rankProfit(rows: ProfitRow[], order: ProfitOrder) {
  const ranked = rows.filter(row => order === "unknown" ? row.grossMarginMinor === null : order === "product" || (row.grossMarginMinor !== null && (!order.startsWith("margin") || row.netSalesMinor > 0)));
  return ranked.toSorted((a, b) => {
    if (order === "product" || order === "unknown") return tie(a, b);
    let difference: bigint;
    if (order.startsWith("margin")) difference = BigInt(a.grossMarginMinor!) * BigInt(b.netSalesMinor) - BigInt(b.grossMarginMinor!) * BigInt(a.netSalesMinor);
    else difference = BigInt(a.grossMarginMinor!) - BigInt(b.grossMarginMinor!);
    const sign = difference < 0n ? -1 : difference > 0n ? 1 : 0;
    return sign * (["highest", "margin-high"].includes(order) ? -1 : 1) || tie(a, b);
  });
}
export function marginPercent(row: ProfitRow) {
  if (row.grossMarginMinor === null || row.netSalesMinor <= 0) return null;
  const numerator = BigInt(row.grossMarginMinor) * 10000n, divisor = BigInt(row.netSalesMinor);
  const rounded = (numerator < 0n ? -1n : 1n) * ((numerator < 0n ? -numerator : numerator) + divisor / 2n) / divisor;
  return `${rounded < 0n ? "-" : ""}${(rounded < 0n ? -rounded : rounded) / 100n}.${((rounded < 0n ? -rounded : rounded) % 100n).toString().padStart(2, "0")}%`;
}
export interface QuantityRow {
  productId: string; sku: string; productName: string; unitOfMeasure: string;
  handedOverQuantity: number; restockedQuantity: number; includedPartsQuantity: number;
  netCustomerQuantity: number; unknownEntryCount: number; entryCount: number;
  currentOnHandQuantity: number | null; activeLocalGoods: boolean;
}
export type MovementOrder = "fast" | "slow" | "zero" | "returns" | "unknown" | "product";
export function rankMovement(rows: QuantityRow[], order: MovementOrder) {
  const ranked = rows.filter(row => order === "product" || (order === "unknown" ? row.unknownEntryCount > 0 : row.unknownEntryCount === 0 && (order === "zero" ? row.handedOverQuantity === 0 && row.restockedQuantity === 0 && row.activeLocalGoods : order === "returns" ? row.netCustomerQuantity < 0 : row.netCustomerQuantity > 0)));
  return ranked.toSorted((a, b) => ["fast", "slow", "returns"].includes(order) ? (order === "fast" ? b.netCustomerQuantity - a.netCustomerQuantity : a.netCustomerQuantity - b.netCustomerQuantity) || tie(a, b) : tie(a, b));
}
