export function openingStockCostOverride(
  configuredUnitCostMinor: number | undefined,
  enteredUnitCostMinor: number | undefined,
): number | undefined {
  return configuredUnitCostMinor === undefined
    ? enteredUnitCostMinor
    : undefined;
}
