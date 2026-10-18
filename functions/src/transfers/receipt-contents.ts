import type { DocumentSnapshot, Transaction } from "firebase-admin/firestore";
import type { AccessProfile } from "../auth/authorize.js";
import type { PostingRequest } from "../inventory/post-inventory-transaction.js";
import { db } from "../admin.js";
import { readDispatchContents } from "./dispatch-contents.js";
import { addLots, exactLots, subtractLots, type LotAllocation } from "./reservation-ownership.js";
import { stockMovementChunks, stockReview } from "./stock-execution.js";

interface ReceiptLine {
  transferItemId: string; receivedQuantity: number; damagedQuantity: number; rejectedQuantity: number; missingQuantity: number;
  serialItemIds: string[]; damagedSerialItemIds: string[];
  lotAllocations: { lotId: string; quantity: number; disposition: "received" | "damaged" }[];
}
export interface ReceiptClaimChange {
  itemId: string; before: number; claimedQuantity: number; claimedSerialItemIds: string[]; claimedLotAllocations: LotAllocation[];
}
export async function buildReceiptMovements(
  reader: Pick<Transaction, "get" | "getAll">, actor: AccessProfile, transfer: DocumentSnapshot, receipt: DocumentSnapshot,
  dispatchId: string, lines: ReceiptLine[], correlationId: string,
) {
  const requestWrites = transfer.get("sourceType") === "branch_request" && lines.some(line => line.receivedQuantity) ? 2 * lines.length : 0;
  const estimatedFinalWrites = 24 + 4 * lines.length + requestWrites + 2 * lines.filter(line => line.missingQuantity + line.damagedQuantity > 0).length;
  if (estimatedFinalWrites > 450) stockReview("Split this receipt into smaller documents before posting; its finalization exceeds the safe write budget.");
  const dispatch = await reader.get(db.doc(`transferDispatches/${dispatchId}`));
  if (!dispatch.exists || dispatch.get("transferId") !== transfer.id || !["in_transit", "partially_received"].includes(String(dispatch.get("status")))) stockReview("The selected dispatch is not awaiting receipt.");
  const contents = await readDispatchContents(reader, transfer, dispatch);
  const resolutions = await reader.get(db.collection("transferDiscrepancies").where("dispatchId", "==", dispatchId));
  if (resolutions.docs.some(doc => doc.get("status") === "resolved" && ["delivered_later", "returned_to_warehouse", "written_off", "accepted_as_damaged"].includes(String(doc.get("resolutionType"))) && !["damaged_quantity", "delivery_refused"].includes(String(doc.get("type")))))
    stockReview("This dispatch has a discrepancy disposition without updated dispatch-specific receipt ownership. Review its disposition evidence before another receipt.");
  const byId = new Map(contents.map(line => [line.itemId, line]));
  if (new Set(lines.map(line => line.transferItemId)).size !== lines.length || lines.some(line => !byId.has(line.transferItemId))) stockReview("Receipt lines must identify distinct items from this dispatch.");
  const allSerials = lines.flatMap(line => [...line.serialItemIds, ...line.damagedSerialItemIds]);
  if (new Set(allSerials).size !== allSerials.length) stockReview("A serial cannot have more than one receipt disposition.");
  const claims = await reader.getAll(...lines.map(line => db.doc(`dispatchReceiptBalances/${dispatchId}__${line.transferItemId}`)));
  const items = await reader.getAll(...lines.map(line => db.doc(`transferItems/${line.transferItemId}`)));
  const movements: PostingRequest[] = [];
  const claimChanges: ReceiptClaimChange[] = [];
  for (const [index, line] of lines.entries()) {
    const source = byId.get(line.transferItemId)!;
    const claim = claims[index]!;
    const before = Number(claim.get("claimedQuantity") ?? 0);
    if (!Number.isSafeInteger(before) || before < 0) stockReview("Dispatch receipt quantity evidence is inconsistent.");
    if (before && claim.get("allocationVersion") !== 2) stockReview("This legacy dispatch has previous receipt claims without exact disposition ownership.");
    const received = line.receivedQuantity, damaged = line.damagedQuantity, rejected = line.rejectedQuantity;
    const item = items[index]!;
    const disposed = ["receivedQuantity", "damagedQuantity", "returnedQuantity", "writtenOffQuantity", "cancelledQuantity"].reduce((sum, field) => sum + Number(item.get(field) ?? 0), 0);
    if (disposed + received + damaged > Number(item.get("approvedQuantity"))) stockReview("Receipt exceeds the transfer item's remaining approved disposition.");
    const disposition = received + damaged + rejected;
    if (disposition + line.missingQuantity <= 0 || before + disposition + line.missingQuantity > source.quantity) stockReview("Receipt quantities exceed the outstanding contents of this specific dispatch.");
    const serialIds = [...line.serialItemIds, ...line.damagedSerialItemIds];
    const priorSerials = (claim.get("claimedSerialItemIds") ?? []) as string[];
    const priorLots = (claim.get("claimedLotAllocations") ?? []) as LotAllocation[];
    if ((source.trackingType === "serial" && (new Set(priorSerials).size !== before || priorSerials.some(id => !source.serialItemIds.includes(id))))
      || (source.trackingType === "batch" && priorLots.reduce((sum, lot) => sum + lot.quantity, 0) !== before))
      stockReview("Prior receipt identities do not reconcile to this dispatch's claimed quantity.");
    if (source.trackingType === "serial") {
      if (rejected || line.serialItemIds.length !== received || line.damagedSerialItemIds.length !== damaged || serialIds.some(id => !source.serialItemIds.includes(id) || priorSerials.includes(id)))
        stockReview("Select the distinct, unreceived serials belonging to this dispatch. Rejected tracked units require discrepancy review.");
    } else if (serialIds.length) stockReview("This dispatch product does not use serial identities.");
    const goodLots = line.lotAllocations.filter(lot => lot.disposition === "received").map(({ lotId, quantity }) => ({ lotId, quantity }));
    const badLots = line.lotAllocations.filter(lot => lot.disposition === "damaged").map(({ lotId, quantity }) => ({ lotId, quantity }));
    const usedLots = addLots(exactLots(goodLots), exactLots(badLots));
    if (source.trackingType === "batch") {
      if (rejected || goodLots.reduce((sum, lot) => sum + lot.quantity, 0) !== received || badLots.reduce((sum, lot) => sum + lot.quantity, 0) !== damaged)
        stockReview("Received and damaged lot quantities must match their exact dispositions. Rejected tracked units require discrepancy review.");
      subtractLots(subtractLots(source.lotAllocations, priorLots), usedLots);
    } else if (usedLots.length) stockReview("This dispatch product does not use lot identities.");
    claimChanges.push({ itemId: line.transferItemId, before, claimedQuantity: before + disposition, claimedSerialItemIds: [...priorSerials, ...serialIds], claimedLotAllocations: addLots(priorLots, usedLots) });
    for (const [quantity, damagedStock, ids, lots] of [[received, false, line.serialItemIds, goodLots], [damaged, true, line.damagedSerialItemIds, badLots]] as const) {
      if (!quantity) continue;
      const serials = ids.length ? await reader.getAll(...ids.map(id => db.doc(`serializedItems/${id}`))) : [];
      if (serials.some(serial => !serial.exists || serial.get("organizationId") !== actor.organizationId || serial.get("productId") !== source.productId)) stockReview("Receipt serial ownership is inconsistent.");
      for (const lot of lots.length ? lots : [{ quantity, lotId: undefined }])
      for (const chunk of stockMovementChunks(lot.quantity, serials.map(serial => String(serial.get("serialNumber"))))) movements.push({
        transactionType: "transfer_receipt", productId: source.productId, quantity: chunk.quantity,
        sourceLocationId: String(transfer.get("transitLocationId")), destinationLocationId: String(transfer.get(damagedStock ? "damagedLocationId" : "destinationLocationId")),
        serialNumbers: chunk.serialNumbers, lotId: lot.lotId, effectiveAt: "", reason: damagedStock ? "Confirmed damaged branch transfer receipt" : "Confirmed branch transfer receipt",
        referenceType: damagedStock ? "transfer_receipt_damage" : "transfer_receipt", referenceId: receipt.id, referenceNumber: String(receipt.get("receiptNumber")),
        idempotencyKey: "", correlationId, sourceFunction: "confirmTransferReceipt", transferContext: { transferId: transfer.id },
      });
    }
  }
  return { movements, details: { claimChanges } };
}

export async function prepareReceiptClaims(tx: Transaction, actor: AccessProfile, transferId: string, dispatchId: string, receiptId: string, changes: ReceiptClaimChange[]) {
  const refs = changes.map(change => db.doc(`dispatchReceiptBalances/${dispatchId}__${change.itemId}`));
  const previous = await tx.getAll(...refs);
  if (previous.some((claim, index) => Number(claim.get("claimedQuantity") ?? 0) !== changes[index]!.before)) stockReview("Dispatch receipt ownership changed while stock was being confirmed.");
  return () => changes.forEach((change, index) => {
    tx.set(refs[index]!, { organizationId: actor.organizationId, transferId, dispatchId, transferItemId: change.itemId, allocationVersion: 2, claimedQuantity: change.claimedQuantity, claimedSerialItemIds: change.claimedSerialItemIds, claimedLotAllocations: change.claimedLotAllocations }, { merge: true });
    tx.create(db.doc(`transferReceiptClaims/${receiptId}__${change.itemId}`), { organizationId: actor.organizationId, transferId, dispatchId, receiptId, transferItemId: change.itemId, quantity: change.claimedQuantity - change.before });
  });
}
