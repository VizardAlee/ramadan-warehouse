export function openingStockUnitCost(
  configuredUnitCostMinor: number | undefined,
  enteredUnitCostMinor: number | undefined,
  useEnteredCost = false,
): number | undefined {
  return useEnteredCost ? enteredUnitCostMinor : configuredUnitCostMinor ?? enteredUnitCostMinor;
}
