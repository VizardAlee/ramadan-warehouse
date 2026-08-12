export interface TransferClosureFacts {
  activeReservations: number;
  transitQuantity: number;
  openDiscrepancies: number;
  undisposedDamagedQuantity: number;
  openReturns: number;
  unresolvedTransitLosses: number;
  unreconciledMandatoryCosts: number;
  itemTotalsConsistent: boolean;
  requestFulfilmentConsistent: boolean;
  orphanDispatches: number;
  orphanReceipts: number;
  serialLocationsValid: boolean;
  lotBalancesValid: boolean;
}

export function transferClosureBlockers(facts: TransferClosureFacts): string[] {
  const blockers: string[] = [];
  if (facts.activeReservations) blockers.push("ACTIVE_RESERVATION");
  if (facts.transitQuantity) blockers.push("UNRECEIVED_TRANSIT_STOCK");
  if (facts.openDiscrepancies) blockers.push("OPEN_DISCREPANCY");
  if (facts.undisposedDamagedQuantity) blockers.push("UNDISPOSED_DAMAGE");
  if (facts.openReturns) blockers.push("OPEN_RETURN");
  if (facts.unresolvedTransitLosses) blockers.push("UNRESOLVED_TRANSIT_LOSS");
  if (facts.unreconciledMandatoryCosts) blockers.push("UNRECONCILED_COST");
  if (!facts.itemTotalsConsistent) blockers.push("INCONSISTENT_ITEM_TOTALS");
  if (!facts.requestFulfilmentConsistent) blockers.push("REQUEST_FULFILMENT_MISMATCH");
  if (facts.orphanDispatches) blockers.push("ORPHAN_DISPATCH");
  if (facts.orphanReceipts) blockers.push("ORPHAN_RECEIPT");
  if (!facts.serialLocationsValid) blockers.push("INVALID_SERIAL_LOCATION");
  if (!facts.lotBalancesValid) blockers.push("INVALID_LOT_BALANCE");
  return blockers;
}
