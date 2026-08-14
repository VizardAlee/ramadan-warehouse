export function openingStockUnitCost(
  configuredUnitCostMinor: number | undefined,
  enteredUnitCostMinor: number | undefined,
): number | undefined {
  return configuredUnitCostMinor ?? enteredUnitCostMinor;
}
