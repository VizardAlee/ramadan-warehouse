/** Pure, side-effect-free arithmetic for the future landed-cost receipt path.
 * NOT enabled in live receipts until both branch and company valuation consumers
 * are integrated. All monetary values are integer minor units (kobo).
 */
export interface CostWeight { id: string; weight: number }
function natural(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer.`);
  return value;
}
function safe(value: bigint): number {
  const result = Number(value);
  return natural(result, "Calculated amount");
}
/** Largest-remainder allocation; lexical IDs make ties independent of UI order.
 * BigInt products avoid losing kobo for valid large integer monetary inputs.
 */
export function allocateTransport(totalMinor: number, weights: readonly CostWeight[], manual?: Readonly<Record<string, number>>): Record<string, number> {
  natural(totalMinor, "Transport total");
  if (!weights.length || weights.some(row => !row.id) || new Set(weights.map(row => row.id)).size !== weights.length) throw new Error("Allocation needs unique non-empty line IDs.");
  const sumWeight = weights.reduce((sum, row) => sum + BigInt(natural(row.weight, "Allocation weight")), 0n);
  if (manual) {
    if (Object.keys(manual).length !== weights.length || weights.some(row => !Object.prototype.hasOwnProperty.call(manual, row.id))) throw new Error("Manual allocation must include every line exactly once.");
    const sum = weights.reduce((value, row) => value + BigInt(natural(manual[row.id]!, "Manual allocation")), 0n);
    if (sum !== BigInt(totalMinor)) throw new Error("Manual allocation must equal the transport total.");
    return Object.fromEntries(weights.map(row => [row.id, manual[row.id]!]));
  }
  if (!sumWeight && totalMinor) throw new Error("Zero-value goods require an explicit manual transport allocation.");
  if (!sumWeight) return Object.fromEntries(weights.map(row => [row.id, 0]));
  const rows = weights.map(row => {
    const numerator = BigInt(totalMinor) * BigInt(row.weight);
    return {id:row.id, allocated: numerator / sumWeight, remainder: numerator % sumWeight};
  });
  let remainder = BigInt(totalMinor) - rows.reduce((sum, row) => sum + row.allocated, 0n);
  rows.sort((a,b) => a.remainder === b.remainder ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.remainder > b.remainder ? -1 : 1);
  for (const row of rows) if (remainder > 0n) { row.allocated++; remainder--; }
  return Object.fromEntries(rows.map(row => [row.id, safe(row.allocated)]));
}
/** Cumulative allocations telescope: a final receipt consumes the exact remainder.
 * Quantities are integral quantity ticks (e.g. metres multiplied by an agreed
 * scale), not floats. Allocation basis and quantity must be immutable at receipt.
 */
export function receiptTransportShare(totalMinor: number, plannedTicks: number, alreadyReceivedTicks: number, receiptTicks: number): number {
  natural(totalMinor, "Line transport"); natural(plannedTicks, "Planned quantity");
  natural(alreadyReceivedTicks, "Prior receipts"); natural(receiptTicks, "Receipt quantity");
  if (!plannedTicks || BigInt(alreadyReceivedTicks) + BigInt(receiptTicks) > BigInt(plannedTicks)) throw new Error("Receipt exceeds the fixed allocation quantity.");
  const cumulative = (ticks: bigint) => BigInt(totalMinor) * ticks / BigInt(plannedTicks);
  return safe(cumulative(BigInt(alreadyReceivedTicks) + BigInt(receiptTicks)) - cumulative(BigInt(alreadyReceivedTicks)));
}
export interface ReceiptCostBasis {
  companyCarryingMinor: number;
  agreedTransferMinor: number;
  externalTransportMinor: number;
  transportPayer: "source" | "destination";
}
/** Recording these amounts is not a bank transfer or expense payment.
 * Only capitalisable external transport is an input to this helper.
 */
export function receiptCostBasis(input: ReceiptCostBasis) {
  const carrying = BigInt(natural(input.companyCarryingMinor, "Company carrying cost"));
  const agreed = BigInt(natural(input.agreedTransferMinor, "Transfer amount"));
  const transport = BigInt(natural(input.externalTransportMinor, "External transport"));
  if (!["source", "destination"].includes(input.transportPayer)) throw new Error("Identify the branch responsible for external transport.");
  return {
    companyLandedMinor: safe(carrying + transport),
    branchLandedMinor: safe(agreed + transport),
    supplierLiabilityMinor: safe(agreed + (input.transportPayer === "source" ? transport : 0n)),
    directTransportLiabilityMinor: input.transportPayer === "destination" ? safe(transport) : 0,
    // Signed: a discounted internal transfer may be below carrying cost.
    internalMarkupMinor: Number(agreed - carrying),
  };
}
