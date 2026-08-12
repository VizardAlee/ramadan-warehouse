export interface TransferQuantities {
  approved: number;
  reserved: number;
  picked: number;
  packed: number;
  dispatched: number;
  received: number;
  damaged?: number;
  missing?: number;
}
export function assertTransferQuantityInvariant(
  value: TransferQuantities,
): void {
  const values = [
    value.approved,
    value.reserved,
    value.picked,
    value.packed,
    value.dispatched,
    value.received,
    value.damaged ?? 0,
    value.missing ?? 0,
  ];
  if (values.some((item) => !Number.isSafeInteger(item) || item < 0))
    throw new Error("Transfer quantities must be non-negative safe integers.");
  if (!(
    value.received <= value.dispatched &&
    value.dispatched <= value.packed &&
    value.packed <= value.picked &&
    value.picked <= value.reserved &&
    value.reserved <= value.approved
  ))
    throw new Error("Transfer quantity invariant violated.");
  if (value.received + (value.damaged ?? 0) > value.dispatched)
    throw new Error("Receipt disposition exceeds dispatched quantity.");
}
export function transferStatusFromTotals(value: TransferQuantities): string {
  assertTransferQuantityInvariant(value);
  if (value.received === value.approved) return "received";
  if (value.received > 0) return "partially_received";
  if (value.dispatched === value.approved) return "dispatched";
  if (value.dispatched > 0) return "partially_dispatched";
  if (value.packed === value.approved) return "packed";
  if (value.picked === value.approved) return "picked";
  if (value.picked > 0) return "partially_picked";
  if (value.reserved === value.approved) return "reserved";
  if (value.reserved > 0) return "partially_reserved";
  return "approved";
}
export function allocateMinorUnits(
  total: number,
  weights: readonly number[],
): number[] {
  if (
    !Number.isSafeInteger(total) ||
    total < 0 ||
    !weights.length ||
    weights.some((weight) => !Number.isFinite(weight) || weight < 0)
  )
    throw new Error("Invalid cost allocation input.");
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightTotal === 0)
    return weights.map((_, index) => (index === 0 ? total : 0));
  const base = weights.map((weight) =>
    Math.floor((total * weight) / weightTotal),
  );
  let residual = total - base.reduce((sum, value) => sum + value, 0);
  const order = weights
    .map((weight, index) => ({
      index,
      fraction: (total * weight) / weightTotal - base[index]!,
    }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let index = 0; residual > 0; index = (index + 1) % order.length) {
    base[order[index]!.index]!++;
    residual--;
  }
  return base;
}
