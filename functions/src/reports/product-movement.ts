/** Canonical local inventory legs only. Collection headers/external legs are never added. */
export interface MovementRow {
  productId: string; sku: string; productName: string; unitOfMeasure: string;
  handedOverQuantity: number; restockedQuantity: number; includedPartsQuantity: number;
  netCustomerQuantity: number; unknownEntryCount: number; entryCount: number;
  currentOnHandQuantity: number | null; activeLocalGoods: boolean;
}
export type MovementEvidence = Record<string, unknown> & { id: string };
export const customerMovementTypes = ["branch_sale", "customer_collection", "sale_return", "held_return_restock"];
export function emptyMovementRow(productId: string, name: string, sku = "", unit = "Unit not recorded"): MovementRow {
  return { productId, productName: name, sku, unitOfMeasure: unit, handedOverQuantity: 0, restockedQuantity: 0, includedPartsQuantity: 0, netCustomerQuantity: 0, unknownEntryCount: 0, entryCount: 0, currentOnHandQuantity: null, activeLocalGoods: false };
}
export function addMovementEntry(row: MovementRow, entry: MovementEvidence, parent?: MovementEvidence, original?: MovementEvidence, originalQuantity?: number) {
  if (!entry.locationId || entry.externalAccount || !entry.branchId) return;
  const reversal = entry.transactionType === "reversal";
  const kind = reversal ? original?.transactionType : entry.transactionType;
  if (!reversal && !customerMovementTypes.includes(String(kind))) return;
  if (reversal && original && !customerMovementTypes.includes(String(kind))) return;
  const delta = entry.quantityDelta;
  const reference = kind === "branch_sale" ? "sale" : kind === "customer_collection" ? "saleCollection" : kind === "sale_return" ? "saleReturn" : "aftersalesCase";
  const evidence = reversal ? original : parent;
  const parentValid = parent && ["posted", "reversed"].includes(String(parent.status)) && parent.transactionType === entry.transactionType;
  const scoped = (record: MovementEvidence) => [record.sourceBranchId, record.destinationBranchId, record.branchId].includes(entry.branchId);
  const originValid = evidence && scoped(evidence) && evidence.referenceType === reference && typeof evidence.referenceId === "string" && evidence.referenceId.length > 0 && ["posted", "reversed"].includes(String(evidence.status));
  const quantityValid = typeof delta === "number" && Number.isSafeInteger(delta) && delta !== 0;
  const direction = ["branch_sale", "customer_collection"].includes(String(kind)) ? -1 : 1;
  if (!parentValid || !parent || !scoped(parent) || !originValid || !quantityValid || Math.sign(delta as number) !== direction * (reversal ? -1 : 1) || (reversal && (parent.reversalOfTransactionId !== original?.id || originalQuantity !== -(delta as number)))) {
    row.unknownEntryCount++; return;
  }
  const quantity = Math.abs(delta as number) * (reversal ? -1 : 1);
  if (kind === "branch_sale" && entry.partsMode === "included") {
    if (typeof entry.serviceSaleItemId !== "string" || !entry.serviceSaleItemId) { row.unknownEntryCount++; return; }
    row.includedPartsQuantity += quantity;
  } else if (direction === -1) row.handedOverQuantity += quantity;
  else row.restockedQuantity += quantity;
  row.netCustomerQuantity = row.handedOverQuantity - row.restockedQuantity;
  row.entryCount++;
  for (const value of [row.handedOverQuantity, row.restockedQuantity, row.includedPartsQuantity, row.netCustomerQuantity, row.entryCount]) if (!Number.isSafeInteger(value)) throw new Error("Movement totals exceed safe integer quantities; no partial report was returned.");
}
