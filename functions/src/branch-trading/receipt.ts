import { internalTradeBalanceId } from "./identity.js";
import { type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import { accountingPeriodReference, assertAccountingPeriodOpen } from "../accounting/period-lock.js";
import type { AccessProfile } from "../auth/authorize.js";
import type { StockTransfer } from "../transfers/simple-model.js";
import type { InternalTradeInvoice, InternalTradeInvoiceLine } from "./model.js";

export interface ReceiptInventoryEvidence {lineId:string; transactionId:string; received:number; damaged:number; companyReceivedValueMinor:number; companyDamagedValueMinor:number; serialItemIds:string[]; damagedSerialItemIds:string[]}
export function safeTradeAmount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new HttpsError("failed-precondition", "Internal trading amount is out of range.");
  return value;
}
function safeSignedTradeAmount(value:number):number {
  if (!Number.isSafeInteger(value)) throw new HttpsError("failed-precondition", "Internal trading balance is out of range.");
  return value;
}
// Read first, return a write-only closure: the existing stock receipt remains the
// sole inventory movement. No external revenue, payable, VAT or cost is posted.
export async function prepareInternalTradeReceipt(tx: Transaction, actor: AccessProfile, transfer: StockTransfer,
  receipts: {id:string; received:number; damaged:number; serialItemIds:string[]; damagedSerialItemIds:string[]}[], now: string, key: string): Promise<(evidence:ReceiptInventoryEvidence[])=>void> {
  const agreement = transfer.tradeAgreement;
  if (!agreement) return () => {};
  if (agreement.version !== 1 || agreement.pricingStatus !== "priced") throw new HttpsError("failed-precondition", "An administrator must price this interbranch supply before approval.");
  const total = safeTradeAmount(receipts.reduce((sum, line) => sum + safeTradeAmount(line.received * safeTradeAmount(agreement.pricesByLineId[line.id]!)), 0));
  // Held damage remains financial evidence even when nothing is charged yet.
  safeTradeAmount(receipts.reduce((sum,line)=>sum+safeTradeAmount(line.damaged*safeTradeAmount(agreement.pricesByLineId[line.id]!)),0));
  if (!receipts.some(line => line.received || line.damaged)) return () => {};
  const invoiceRef = db.doc(`internalTradeInvoices/${transfer.id}`);
  const balanceRef = db.doc(`internalTradeBalances/${internalTradeBalanceId(actor.organizationId,agreement.headOfficeBranchId,transfer.destinationBranchId)}`);
  const [invoice, balance, period] = await tx.getAll(invoiceRef, balanceRef, accountingPeriodReference(actor.organizationId, now));
  if (total > 0) assertAccountingPeriodOpen(period!);
  if (invoice!.exists && (!balance!.exists || invoice!.get("id") !== transfer.id || invoice!.get("transferId") !== transfer.id ||
    invoice!.get("organizationId") !== actor.organizationId || invoice!.get("branchId") !== transfer.destinationBranchId ||
    invoice!.get("headOfficeBranchId") !== agreement.headOfficeBranchId || invoice!.get("sourceLocationId") !== transfer.sourceLocationId ||
    invoice!.get("destinationLocationId") !== transfer.destinationLocationId || invoice!.get("sourceBranchId") !== transfer.sourceBranchId ||
    invoice!.get("sourceWarehouseId") !== transfer.sourceWarehouseId || invoice!.get("currency") !== "NGN"))
    throw new HttpsError("failed-precondition", "Internal invoice identity or missing supplier balance needs review.");
  if (balance!.exists && (balance!.get("organizationId") !== actor.organizationId || balance!.get("branchId") !== transfer.destinationBranchId || balance!.get("headOfficeBranchId") !== agreement.headOfficeBranchId)) throw new HttpsError("failed-precondition", "Supplier balance identity needs review.");
  if (!invoice!.exists && transfer.items.some(line=>line.received || line.damaged)) throw new HttpsError("failed-precondition","The original receipt invoice is missing; reconcile its evidence before receiving more stock.");
  const old = invoice!.data() as InternalTradeInvoice | undefined;
  const invoiceVersion = safeTradeAmount(safeTradeAmount(old ? old.version : 0) + 1);
  const balanceVersion = safeTradeAmount(safeTradeAmount(balance!.exists ? balance!.get("version") : 0) + 1);
  const currentInvoiceBalance = safeSignedTradeAmount(old ? old.balanceMinor : 0);
  const currentBranchBalance = safeSignedTradeAmount(balance!.exists ? balance!.get("balanceMinor") : 0);
  const nextBranchBalance = safeSignedTradeAmount(currentBranchBalance + total);
  if (old && (!Array.isArray(old.lines) || old.lines.length!==transfer.items.length || new Set(old.lines.map(line=>line.id)).size!==old.lines.length)) throw new HttpsError("failed-precondition","Original invoice line evidence needs review.");
  if (old && (safeTradeAmount(old.totalMinor)-safeTradeAmount(old.paidMinor)-safeTradeAmount(old.returnedMinor)!==currentInvoiceBalance || old.returnedMinor>old.totalMinor)) throw new HttpsError("failed-precondition","Internal invoice balance requires reconciliation.");
  if (balance!.exists && (safeTradeAmount(Number(balance!.get("invoicedMinor")))-safeTradeAmount(Number(balance!.get("paidMinor")))-safeTradeAmount(Number(balance!.get("returnedMinor")))!==currentBranchBalance || Number(balance!.get("returnedMinor"))>Number(balance!.get("invoicedMinor")))) throw new HttpsError("failed-precondition","Supplier balance requires reconciliation.");
  const lines: InternalTradeInvoiceLine[] = transfer.items.map(line => {
    const prior = old?.lines.find(item => item.id === line.id);
    const receipt = receipts.find(item => item.id === line.id)!;
    if (old && (!prior || prior.productId!==line.productId || prior.trackingType!==line.trackingType || prior.lotId!==line.lotId || prior.unitPriceMinor!==agreement.pricesByLineId[line.id] || prior.receivedQuantity!==line.received || (prior.damagedQuantity ?? 0)!==line.damaged)) throw new HttpsError("failed-precondition","Original invoice line evidence needs review.");
    return { id: line.id, productId: line.productId, productName: line.productName, sku: line.sku, trackingType: line.trackingType,
      ...(line.lotId ? {lotId:line.lotId}:{}), unitPriceMinor: safeTradeAmount(agreement.pricesByLineId[line.id]!),
      damagedQuantity:(prior?.damagedQuantity ?? 0)+receipt.damaged,pendingDamagedQuantity:(prior?.pendingDamagedQuantity ?? 0)+receipt.damaged,
      chargedDamagedQuantity:prior?.chargedDamagedQuantity ?? 0,waivedDamagedQuantity:prior?.waivedDamagedQuantity ?? 0,damagedSerialItemIds:[...(prior?.damagedSerialItemIds ?? []),...receipt.damagedSerialItemIds],
      receivedQuantity:(prior?.receivedQuantity ?? 0)+receipt.received, returnedQuantity:prior?.returnedQuantity ?? 0,
      serialItemIds:[...(prior?.serialItemIds ?? []), ...receipt.serialItemIds], returnedSerialItemIds:prior?.returnedSerialItemIds ?? [], ...(line.serialNumbers?{serialNumbers:line.serialNumbers}:{}) };
  });
  const totalMinor = safeTradeAmount((old?.totalMinor ?? 0) + total);
  const paidMinor = old?.paidMinor ?? 0, returnedMinor = old?.returnedMinor ?? 0;
  const updated: InternalTradeInvoice = {id: transfer.id, transferId: transfer.id, number:`IT-${transfer.number}`, organizationId:actor.organizationId,
    branchId:transfer.destinationBranchId, branchName:transfer.destinationName, headOfficeBranchId:agreement.headOfficeBranchId,...(agreement.headOfficeBranchName?{headOfficeBranchName:agreement.headOfficeBranchName}:{}),
    sourceLocationId:transfer.sourceLocationId,destinationLocationId:transfer.destinationLocationId,
    ...(transfer.sourceWarehouseId?{sourceWarehouseId:transfer.sourceWarehouseId}:{}), ...(transfer.sourceBranchId?{sourceBranchId:transfer.sourceBranchId}:{}),
    totalMinor,paidMinor,returnedMinor,balanceMinor:safeSignedTradeAmount(totalMinor-paidMinor-returnedMinor),version:invoiceVersion,currency:"NGN",lines,createdAt:old?.createdAt ?? now,updatedAt:now};
  return (evidence) => {
    const chargedReceipts=receipts.filter(line=>line.received || line.damaged);
    if (evidence.length!==chargedReceipts.length || evidence.some(item=>!chargedReceipts.some(line=>line.id===item.lineId && line.received===item.received && line.damaged===item.damaged))) throw new HttpsError("internal","Internal invoice is missing its stock receipt evidence.");
    const receiptLines=chargedReceipts.map(line=>({lineId:line.id,productId:transfer.items.find(item=>item.id===line.id)!.productId,quantity:line.received,damagedQuantity:line.damaged,pendingDamageValueMinor:safeTradeAmount(line.damaged*agreement.pricesByLineId[line.id]!),unitPriceMinor:agreement.pricesByLineId[line.id],amountMinor:line.received*agreement.pricesByLineId[line.id]!,serialItemIds:line.serialItemIds,...evidence.find(item=>item.lineId===line.id)}));
    tx.set(invoiceRef, updated);
    tx.set(balanceRef, {organizationId:actor.organizationId,branchId:transfer.destinationBranchId,headOfficeBranchId:agreement.headOfficeBranchId,
      invoicedMinor:safeTradeAmount(Number(balance!.get("invoicedMinor") ?? 0)+total),paidMinor:Number(balance!.get("paidMinor") ?? 0),returnedMinor:Number(balance!.get("returnedMinor") ?? 0),
      balanceMinor:nextBranchBalance,version:balanceVersion,updatedAt:now});
    tx.create(db.collection("internalTradeEntries").doc(`${transfer.id}_${String(updated.version).padStart(12,"0")}`), {organizationId:actor.organizationId,branchId:transfer.destinationBranchId,headOfficeBranchId:agreement.headOfficeBranchId,
      invoiceId:transfer.id,transferId:transfer.id,kind:total || receipts.some(line=>line.received) ? "invoice" : "damage_hold",receiptLines,inventoryTransactionIds:evidence.map(item=>item.transactionId),amountMinor:total,signedAmountMinor:total,actorUserId:actor.userId,createdAt:now,idempotencyKey:key});
  };
}
