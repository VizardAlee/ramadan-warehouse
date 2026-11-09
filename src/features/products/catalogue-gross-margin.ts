/** Estimate only: protected catalogue cost and the effective selling price, both before VAT. */
export function catalogueGrossMarginPercent(unitCostMinor: number | undefined, sellingPriceMinor: number | undefined): number | null {
  if (!Number.isSafeInteger(unitCostMinor) || !Number.isSafeInteger(sellingPriceMinor) || unitCostMinor! <= 0 || sellingPriceMinor! <= 0) return null;
  return (sellingPriceMinor! - unitCostMinor!) / sellingPriceMinor! * 100;
}
