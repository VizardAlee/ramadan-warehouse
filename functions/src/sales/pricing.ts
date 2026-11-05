export type PriceTier = "retail" | "wholesale";
export interface CentralSalesPrice { basePriceMinor: number; version: number; wholesalePriceMinor?: number | null }
export interface BranchSalesPrice {
  active?: boolean; sellingPriceMinor?: number | null; wholesalePriceMinor?: number | null;
  version?: number; belowBaseApproved?: boolean; belowWholesaleApproved?: boolean; basePriceVersion?: number;
}
const positiveMoney = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;

/** Shared by workspace, order intake, checkout and quotations. Never uses inventory cost. */
export function resolveCatalogPrice(central: CentralSalesPrice, branch: BranchSalesPrice, tier: PriceTier = "retail") {
  const wholesale = tier === "wholesale";
  const base = wholesale ? central.wholesalePriceMinor : central.basePriceMinor;
  const override = wholesale ? branch.wholesalePriceMinor : branch.sellingPriceMinor;
  const approved = wholesale ? branch.belowWholesaleApproved : branch.belowBaseApproved;
  const branchActive = branch.active === true && positiveMoney(override) && positiveMoney(branch.version) &&
    ((positiveMoney(base) && override >= base) ||
      (approved === true && branch.basePriceVersion === central.version));
  if (branchActive) return { unitPriceMinor: override, priceVersion: branch.version!, priceSource: "branch" as const };
  if (!positiveMoney(base)) throw new Error(`${wholesale ? "Wholesale" : "Retail"} pricing is not configured for this product. Choose another level or ask a price administrator to configure it.`);
  return { unitPriceMinor: base, priceVersion: central.version, priceSource: wholesale ? "wholesale" as const : "central" as const };
}
