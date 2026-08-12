export interface TransferItemQuantities {
  approved: number;
  reserved: number;
  releasedReservation: number;
  picked: number;
  packed: number;
  dispatched: number;
  received: number;
  damaged: number;
  missing: number;
  returned: number;
  writtenOff: number;
  cancelledUndispatched: number;
  outstanding: number;
}

export interface TransferQuantityEvaluation {
  terminalDisposed: number;
  undispatched: number;
  inTransit: number;
  expectedOutstanding: number;
  violations: string[];
}

export function evaluateTransferItemQuantities(
  value: TransferItemQuantities,
): TransferQuantityEvaluation {
  const terminalDisposed =
    value.received + value.damaged + value.returned + value.writtenOff;
  const undispatched = Math.max(
    0,
    value.approved - value.dispatched - value.cancelledUndispatched,
  );
  const inTransit = Math.max(0, value.dispatched - terminalDisposed);
  const expectedOutstanding = undispatched + inTransit;
  const violations: string[] = [];
  for (const [name, quantity] of Object.entries(value)) {
    if (!Number.isFinite(quantity) || quantity < 0)
      violations.push(`${name.toUpperCase()}_NON_NEGATIVE`);
  }
  if (value.reserved > value.approved)
    violations.push("RESERVED_WITHIN_APPROVED");
  if (value.picked > value.reserved + value.releasedReservation)
    violations.push("PICKED_WITHIN_RESERVATION_HISTORY");
  if (value.packed > value.picked)
    violations.push("PACKED_WITHIN_PICKED");
  if (value.dispatched > value.packed)
    violations.push("DISPATCHED_WITHIN_PACKED");
  if (terminalDisposed + value.missing > value.dispatched)
    violations.push("DISPOSITION_AND_MISSING_WITHIN_DISPATCHED");
  if (value.cancelledUndispatched > value.approved - value.dispatched)
    violations.push("CANCELLATION_WITHIN_UNDISPATCHED");
  if (value.outstanding !== expectedOutstanding)
    violations.push("OUTSTANDING_MATCHES_DERIVED");
  return {
    terminalDisposed,
    undispatched,
    inTransit,
    expectedOutstanding,
    violations,
  };
}
