export type PriceTier = "retail" | "wholesale";
export interface CentralSalesPrice { basePriceMinor: number; version: number; wholesalePriceMinor?: number | null; vatRateBasisPoints?: number; active?: boolean }
export interface BranchSalesPrice {
  active?: boolean; sellingPriceMinor?: number | null; wholesalePriceMinor?: number | null;
  version?: number; belowBaseApproved?: boolean; belowWholesaleApproved?: boolean; basePriceVersion?: number; vatRateBasisPoints?: number;
}
const positiveMoney = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;

/** Shared by workspace, order intake, checkout and quotations. Never uses inventory cost. */
export function resolveCatalogPrice(central: CentralSalesPrice | null, branch: BranchSalesPrice, tier: PriceTier = "retail") {
  if (central?.active === false) throw new Error("Central pricing is inactive. Ask a price administrator to review it.");
  const wholesale = tier === "wholesale";
  const base = wholesale ? central?.wholesalePriceMinor : central?.basePriceMinor;
  const override = wholesale ? branch.wholesalePriceMinor : branch.sellingPriceMinor;
  const approved = wholesale ? branch.belowWholesaleApproved : branch.belowBaseApproved;
  const branchActive = branch.active === true && positiveMoney(override) && positiveMoney(branch.version) &&
    ((positiveMoney(base) && override >= base) ||
      (approved === true && branch.basePriceVersion === (central?.version ?? 0)));
  if (branchActive) return { unitPriceMinor: override, priceVersion: branch.version!, priceSource: "branch" as const };
  if (!positiveMoney(base)) throw new Error(`${wholesale ? "Wholesale" : "Retail"} pricing is not configured for this product. Choose another level or ask a price administrator to configure it.`);
  return { unitPriceMinor: base, priceVersion: central!.version, priceSource: wholesale ? "wholesale" as const : "central" as const };
}


export function centralSalesPrice(record: Record<string, unknown> | undefined): CentralSalesPrice | null {
  return record ? { basePriceMinor: Number(record.basePriceMinor), wholesalePriceMinor: record.wholesalePriceMinor as number | null | undefined,
    version: Number(record.version), vatRateBasisPoints: record.vatRateBasisPoints as number | undefined, active: record.active === true } : null;
}
export function resolveCatalogVatRate(central: CentralSalesPrice | null, branch: BranchSalesPrice): number {
  if (central?.active === false) throw new Error("Central pricing is inactive. Ask a price administrator to review it.");
  const rate = central ? central.vatRateBasisPoints : branch.active ? branch.vatRateBasisPoints : undefined;
  if (!Number.isInteger(rate) || Number(rate) < 0 || Number(rate) > 10000)
    throw new Error("Choose an explicit VAT rate before using branch-only pricing.");
  return Number(rate);
}
