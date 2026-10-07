export type PriceTier = "retail" | "wholesale";

/** One resolver for checkout and order intake; branch overrides apply to retail only. */
export function resolveCatalogPrice(
  central: { basePriceMinor: number; version: number; wholesalePriceMinor?: number | null },
  branch: { active?: boolean; sellingPriceMinor?: number; version?: number; belowBaseApproved?: boolean; basePriceVersion?: number },
  tier: PriceTier = "retail",
) {
  if (tier === "wholesale") {
    if (!Number.isSafeInteger(central.wholesalePriceMinor) || Number(central.wholesalePriceMinor) <= 0)
      throw new Error("Wholesale pricing is not configured for this product. Choose retail or ask a price administrator to configure it.");
    return { unitPriceMinor: Number(central.wholesalePriceMinor), priceVersion: central.version, priceSource: "wholesale" as const };
  }
  const branchActive = branch.active === true &&
    (Number(branch.sellingPriceMinor) >= central.basePriceMinor ||
      (branch.belowBaseApproved === true && branch.basePriceVersion === central.version));
  return {
    unitPriceMinor: branchActive ? Number(branch.sellingPriceMinor) : central.basePriceMinor,
    priceVersion: branchActive ? Number(branch.version) : central.version,
    priceSource: branchActive ? "branch" as const : "central" as const,
  };
}
