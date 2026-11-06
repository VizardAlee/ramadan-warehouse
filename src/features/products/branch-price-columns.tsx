"use client";

import { useAuth } from "@/features/auth/auth-context";
import { useOperatingContextOptions } from "@/features/auth/use-operating-context-options";
import { useOrganizationCollection } from "@/features/administration/use-organization-collection";
import { FinancialValue } from "@/features/finance/financial-privacy";
import { formatNaira } from "@/features/inventory/format";
import { hasPermission } from "@/lib/permissions/roles";
import { resolveCatalogPrice, type CentralSalesPrice, type BranchSalesPrice, type PriceTier } from "../../../functions/src/sales/pricing";

export function useBranchPriceColumns() {
  const { profile, operatingContext } = useAuth();
  const { options } = useOperatingContextOptions();
  const canRead = Boolean(profile && (hasPermission(profile, "sales.read.all") || hasPermission(profile, "sales.read.own_branch")));
  const prices = useOrganizationCollection<BranchSalesPrice & { id: string; branchId: string; productId: string }>("branchSalesPrices", canRead);
  const branches = options.filter(option => option.type === "branch" && (!operatingContext || operatingContext.type === "branch" && option.id === operatingContext.id));
  function value(productId: string, central: CentralSalesPrice | null, tier: PriceTier, centralStatus?: "loading" | "error") {
    if (!canRead) return <FinancialValue>Restricted</FinancialValue>;
    if (centralStatus === "error") return <FinancialValue>Unable to verify central fallback</FinancialValue>;
    if (centralStatus === "loading") return <FinancialValue>Loading…</FinancialValue>;
    if (prices.error) return <FinancialValue>Unable to load branch prices</FinancialValue>;
    if (prices.loading) return <FinancialValue>Loading…</FinancialValue>;
    if (!branches.length) return <FinancialValue>Choose a branch</FinancialValue>;
    return <div className="space-y-2">{branches.map(branch => {
      let amount = "Not configured", source = "";
      try {
        const resolved = resolveCatalogPrice(central, prices.data.find(price => price.productId === productId && price.branchId === branch.id) ?? {}, tier);
        amount = formatNaira(resolved.unitPriceMinor);
        source = resolved.priceSource === "branch" ? "Branch override" : "Central fallback";
      } catch { /* Missing or inactive prices are never represented as zero. */ }
      return <div key={branch.id}>{!operatingContext && <span className="block text-xs font-medium">{branch.name}</span>}<FinancialValue>{amount}</FinancialValue>{source && <span className="block text-xs text-[var(--muted)]">{source}</span>}</div>;
    })}</div>;
  }
  return value;
}
