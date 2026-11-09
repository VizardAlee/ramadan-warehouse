"use client";

import { useAuth } from "@/features/auth/auth-context";
import { useOperatingContextOptions } from "@/features/auth/use-operating-context-options";
import { useOrganizationCollection } from "@/features/administration/use-organization-collection";
import { FinancialValue } from "@/features/finance/financial-privacy";
import { formatNaira } from "@/features/inventory/format";
import { catalogueGrossMarginPercent } from "./catalogue-gross-margin";
import { hasPermission } from "@/lib/permissions/roles";
import { resolveCatalogPrice, type CentralSalesPrice, type BranchSalesPrice, type PriceTier } from "../../../functions/src/sales/pricing";

export interface CatalogueMarginCost {
  unitCostMinor?: number;
  loading: boolean;
  error: string | null;
  service: boolean;
}

export function useBranchPriceColumns() {
  const { profile, operatingContext } = useAuth();
  const { options } = useOperatingContextOptions();
  const canRead = Boolean(profile && (hasPermission(profile, "sales.read.all") || hasPermission(profile, "sales.read.own_branch")));
  const canReadCost = Boolean(profile && hasPermission(profile, "inventory.cost.read"));
  const prices = useOrganizationCollection<BranchSalesPrice & { id: string; branchId: string; productId: string }>("branchSalesPrices", canRead);
  const branches = options.filter(option => option.type === "branch" && (!operatingContext || operatingContext.type === "branch" && option.id === operatingContext.id));
  function value(productId: string, central: CentralSalesPrice | null, tier: PriceTier, centralStatus?: "loading" | "error", cost?: CatalogueMarginCost) {
    if (cost && !canReadCost) return <FinancialValue>Restricted</FinancialValue>;
    if (!canRead) return <FinancialValue>Restricted</FinancialValue>;
    if (cost?.loading) return <FinancialValue>Loading…</FinancialValue>;
    if (cost?.error) return <FinancialValue>Unable to load</FinancialValue>;
    if (centralStatus === "error") return <FinancialValue>Unable to verify central fallback</FinancialValue>;
    if (centralStatus === "loading") return <FinancialValue>Loading…</FinancialValue>;
    if (prices.error) return <FinancialValue>Unable to load branch prices</FinancialValue>;
    if (prices.loading) return <FinancialValue>Loading…</FinancialValue>;
    if (!branches.length) return <FinancialValue>Choose a branch</FinancialValue>;
    return <div className="space-y-2">{branches.map(branch => {
      let amount = cost ? "Unknown" : "Not configured", source = "";
      try {
        const resolved = resolveCatalogPrice(central, prices.data.find(price => price.productId === productId && price.branchId === branch.id) ?? {}, tier);
        if (cost) {
          const percent = catalogueGrossMarginPercent(cost.unitCostMinor, resolved.unitPriceMinor);
          amount = cost.service || cost.unitCostMinor === 0 ? "Not meaningful" : percent === null ? "Unknown" : `${percent.toFixed(1)}%`;
        } else {
          amount = formatNaira(resolved.unitPriceMinor);
        }
        source = resolved.priceSource === "branch" ? "Branch override" : "Central fallback";
      } catch { /* Missing or inactive prices are never represented as zero. */ }
      return <div key={branch.id}>{!operatingContext && <span className="block text-xs font-medium">{branch.name}</span>}<FinancialValue>{amount}</FinancialValue>{source && <span className="block text-xs text-[var(--muted)]">{source}</span>}</div>;
    })}</div>;
  }
  return {
    price: (productId: string, central: CentralSalesPrice | null, tier: PriceTier, centralStatus?: "loading" | "error") => value(productId, central, tier, centralStatus),
    margin: (productId: string, central: CentralSalesPrice | null, tier: PriceTier, cost: CatalogueMarginCost, centralStatus?: "loading" | "error") => value(productId, central, tier, centralStatus, cost),
  };
}
