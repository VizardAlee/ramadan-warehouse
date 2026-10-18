import type { DocumentSnapshot } from "firebase-admin/firestore";
import { stockReview } from "./stock-execution.js";

export interface LotAllocation { lotId: string; quantity: number }
export function exactLots(allocations: readonly LotAllocation[]) {
  const ids = new Set<string>();
  for (const lot of allocations) {
    if (!lot.lotId || !Number.isSafeInteger(lot.quantity) || lot.quantity <= 0 || ids.has(lot.lotId))
      stockReview("Lot allocations must have distinct identities and positive whole quantities.");
    ids.add(lot.lotId);
  }
  return allocations.map(lot => ({ ...lot }));
}
export function remainingLots(reservation: DocumentSnapshot): LotAllocation[] {
  const stored = reservation.get("remainingLotAllocations") as LotAllocation[] | undefined;
  const allocations = (reservation.get("lotAllocations") ?? []) as LotAllocation[];
  if (Number(reservation.get("remainingQuantity") ?? 0) === 0) return [];
  if (!stored && allocations.length && (Number(reservation.get("consumedQuantity") ?? 0) || Number(reservation.get("releasedQuantity") ?? 0)))
    stockReview("This legacy lot reservation has no exact remaining-lot ownership after consumption or release.");
  const remaining = exactLots(stored ?? allocations);
  if (allocations.length && remaining.reduce((sum, lot) => sum + lot.quantity, 0) !== Number(reservation.get("remainingQuantity") ?? 0))
    stockReview("Remaining lot ownership does not match the reservation remainder.");
  return remaining;
}
export function subtractLots(available: readonly LotAllocation[], used: readonly LotAllocation[]) {
  const remaining = new Map(available.map(lot => [lot.lotId, lot.quantity]));
  for (const lot of exactLots(used)) {
    const quantity = (remaining.get(lot.lotId) ?? 0) - lot.quantity;
    if (quantity < 0) stockReview("The selected lot exceeds this transfer's exact reservation remainder.");
    remaining.set(lot.lotId, quantity);
  }
  return [...remaining].filter(([, quantity]) => quantity > 0).map(([lotId, quantity]) => ({ lotId, quantity }));
}
export function addLots(before: readonly LotAllocation[], added: readonly LotAllocation[]) {
  const quantities = new Map(before.map(lot => [lot.lotId, lot.quantity]));
  for (const lot of exactLots(added)) quantities.set(lot.lotId, (quantities.get(lot.lotId) ?? 0) + lot.quantity);
  return [...quantities].map(([lotId, quantity]) => ({ lotId, quantity }));
}

export function ownedRequestAllocation(item: DocumentSnapshot) {
  const value = item.get("requestAllocatedQuantity");
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    stockReview("This request-linked transfer lacks explicit ownership of its remaining request allocation.");
  return Number(value);
}
