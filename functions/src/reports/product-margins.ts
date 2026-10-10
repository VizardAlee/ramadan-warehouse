export interface MarginItem {
  itemKind?: "goods" | "service"; providerOriginalMinor?: number; providerCreditedMinor?: number;
  id: string; productId: string; sku: string; productName: string;
  quantity: number; netAmountMinor: number; costAmountMinor?: number;
  costEvidenceComplete?: boolean; collectionTracked?: boolean; collectedQuantity?: number; cancelledQuantity?: number;
}
export interface MarginReturn { saleItemId: string; quantity: number; netAmountMinor: number; costAmountMinor?: number; restockable: boolean; cancellation: boolean }
export interface ProductMargin {
  itemKind: "goods" | "service" | "mixed_history";
  productId: string; sku: string; productName: string; invoicedQuantity: number; reversedQuantity: number;
  invoicedNetMinor: number; reversedNetMinor: number; netSalesMinor: number;
  recordedCostMinor: number; restockCreditMinor: number; netRecordedCostMinor: number;
  providerOriginalMinor: number; providerCreditedMinor: number; providerNetMinor: number;
  unknownCostLines: number; grossMarginMinor: number | null;
}
function amount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Invalid recorded product amounts. Reconcile the invoice before reporting margins.");
  return value;
}
export function addProductMargin(totals: Map<string, ProductMargin>, item: MarginItem, returns: MarginReturn[]) {
  const quantity = amount(item.quantity), net = amount(item.netAmountMinor);
  if (!quantity || !item.productId) throw new Error("An invoice line has no product or quantity evidence.");
  const result = totals.get(item.productId) ?? { itemKind: item.itemKind ?? "goods", productId: item.productId, sku: item.sku, productName: item.productName, invoicedQuantity: 0, reversedQuantity: 0, invoicedNetMinor: 0, reversedNetMinor: 0, netSalesMinor: 0, recordedCostMinor: 0, restockCreditMinor: 0, netRecordedCostMinor: 0, providerOriginalMinor: 0, providerCreditedMinor: 0, providerNetMinor: 0, unknownCostLines: 0, grossMarginMinor: null };
  if (result.itemKind !== (item.itemKind ?? "goods")) result.itemKind = "mixed_history";
  let reversedQuantity = 0, reversedNet = 0, creditedCost = 0, unknown = item.costAmountMinor === undefined || item.costEvidenceComplete === false;
  for (const line of returns) {
    reversedQuantity += amount(line.quantity); reversedNet += amount(line.netAmountMinor);
    if (line.restockable && !line.cancellation) {
      if (line.costAmountMinor === undefined) unknown = true;
      else creditedCost += amount(line.costAmountMinor);
    }
  }
  const cost = item.costAmountMinor === undefined ? 0 : amount(item.costAmountMinor);
  if (reversedQuantity > quantity || reversedNet > net || creditedCost > cost) throw new Error("Returns exceed the original invoice evidence. Reconcile the product before reporting margins.");
  if (item.collectionTracked === true) {
    const collected = amount(item.collectedQuantity), cancelled = amount(item.cancelledQuantity ?? 0);
    if (collected + cancelled > quantity) throw new Error("Collection quantities exceed the original invoice.");
    if (collected + cancelled < quantity) unknown = true;
  }
  const providerOriginal = amount(item.providerOriginalMinor ?? 0), providerCredit = amount(item.providerCreditedMinor ?? 0);
  if (providerCredit > providerOriginal) throw new Error("Provider credits exceed original charges.");
  result.providerOriginalMinor += providerOriginal; result.providerCreditedMinor += providerCredit; result.providerNetMinor = result.providerOriginalMinor - result.providerCreditedMinor;
  result.invoicedQuantity += quantity; result.reversedQuantity += reversedQuantity;
  result.invoicedNetMinor += net; result.reversedNetMinor += reversedNet;
  result.netSalesMinor = result.invoicedNetMinor - result.reversedNetMinor;
  result.recordedCostMinor += cost; result.restockCreditMinor += creditedCost;
  result.netRecordedCostMinor = result.recordedCostMinor - result.restockCreditMinor;
  result.unknownCostLines += unknown ? 1 : 0;
  for (const value of [result.providerOriginalMinor, result.providerCreditedMinor, result.providerNetMinor, result.invoicedQuantity, result.reversedQuantity, result.invoicedNetMinor, result.reversedNetMinor, result.recordedCostMinor, result.restockCreditMinor, result.netSalesMinor, result.netRecordedCostMinor])
    if (!Number.isSafeInteger(value)) throw new Error("Product totals exceed safe minor-unit arithmetic.");
  result.grossMarginMinor = result.unknownCostLines ? null : result.netSalesMinor - result.netRecordedCostMinor;
  if (result.grossMarginMinor !== null && !Number.isSafeInteger(result.grossMarginMinor)) throw new Error("Product margin exceeds safe minor-unit arithmetic.");
  totals.set(item.productId, result);
}
