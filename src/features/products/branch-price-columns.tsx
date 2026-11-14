"use client";

import { useAuth } from "@/features/auth/auth-context";
import { useOperatingContextOptions } from "@/features/auth/use-operating-context-options";
import { useOrganizationCollection } from "@/features/administration/use-organization-collection";
import { FinancialValue } from "@/features/finance/financial-privacy";
import { formatNaira } from "@/features/inventory/format";
import type { BranchStockCostResult } from "./use-branch-stock-costs";
import { hasPermission } from "@/lib/permissions/roles";
import { resolveCatalogPrice, type CentralSalesPrice, type BranchSalesPrice, type PriceTier } from "../../../functions/src/sales/pricing";

export interface CatalogueMarginCost {
  unitCostMinor?: number;
  loading: boolean;
  error: string | null;
  service: boolean;
}

export function useBranchPriceColumns(stock?: BranchStockCostResult) {
  const { profile, operatingContext } = useAuth();
  const { options } = useOperatingContextOptions();
  const canRead = Boolean(profile && (hasPermission(profile, "sales.read.all") || hasPermission(profile, "sales.read.own_branch")));
  const canReadCost = Boolean(profile && hasPermission(profile, "inventory.cost.read"));
  const prices = useOrganizationCollection<BranchSalesPrice & { id: string; branchId: string; productId: string }>("branchSalesPrices", canRead);
  const branches = options.filter(option => option.type === "branch" && (!operatingContext || operatingContext.type === "branch" && option.id === operatingContext.id));
  function value(productId: string, central: CentralSalesPrice | null, tier: PriceTier, centralStatus?: "loading" | "error", cost?: CatalogueMarginCost) {
    if (cost && !canReadCost) return <FinancialValue>Restricted</FinancialValue>;
    if (!canRead) return <FinancialValue>Restricted</FinancialValue>;
    if (cost && stock?.status !== "ready") return <FinancialValue>{stockStatus()}</FinancialValue>;
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
          const position = stock?.costs[branch.id]?.[productId];
          const unitCost = position?.unitCostMinor;
          amount = !Number.isSafeInteger(resolved.unitPriceMinor) || resolved.unitPriceMinor <= 0 ? "Unknown" : cost.service ? "Not meaningful (service)" : position?.invalid ? "Unavailable" : !position || position.quantity === 0 ? "No stock" : unitCost === 0 ? "Not meaningful (zero cost)" : unitCost === undefined ? "Unavailable" : `${((resolved.unitPriceMinor - unitCost) / resolved.unitPriceMinor * 100).toFixed(1)}%`;
        } else {
          amount = formatNaira(resolved.unitPriceMinor);
        }
        source = resolved.priceSource === "branch" ? "Branch override" : "Central fallback";
      } catch { /* Missing or inactive prices are never represented as zero. */ }
      return <div key={branch.id}>{!operatingContext && <span className="block text-xs font-medium">{branch.name}</span>}<FinancialValue>{amount}</FinancialValue>{source && <span className="block text-xs text-[var(--muted)]">{source}</span>}</div>;
    })}</div>;
  }
  function stockStatus() {
    return !canReadCost || stock?.status === "restricted" ? "Restricted" : stock?.status === "loading" ? "Loading…" : stock?.status === "choose-branch" ? "Choose a branch" : "Unable to load stock costs";
  }
  return {
    exportLoading: canRead && prices.loading,
    exportError: canRead ? prices.error : null,
    exportPrices: (productId: string, central: CentralSalesPrice | null) => branches.map(branch => {
      const price = prices.data.find(item => item.productId === productId && item.branchId === branch.id) ?? {};
      const resolve = (tier: PriceTier) => {
        if (!canRead) return "Restricted";
        try { return resolveCatalogPrice(central, price, tier).unitPriceMinor / 100; }
        catch { return "Not configured"; }
      };
      const position = stock?.costs[branch.id]?.[productId];
      return { branch: branch.name, retail: resolve("retail"), wholesale: resolve("wholesale"),
        stockCost: !canReadCost ? "Restricted" : stock?.status !== "ready" || position?.invalid ? "Unavailable" : !position || position.quantity === 0 ? "No stock" : position.unitCostMinor === undefined ? "Unavailable" : position.unitCostMinor / 100 };
    }),
    stockCost: (productId: string, service: boolean) => {
      if (!canReadCost || stock?.status !== "ready") return <FinancialValue>{stockStatus()}</FinancialValue>;
      if (!branches.length) return <FinancialValue>Choose a branch</FinancialValue>;
      return <div className="space-y-2">{branches.map(branch => {
        const position = stock.costs[branch.id]?.[productId];
        const amount = service ? "Not meaningful (service)" : position?.invalid ? "Unavailable" : !position || position.quantity === 0 ? "No stock" : position.unitCostMinor === undefined ? "Unavailable" : formatNaira(position.unitCostMinor);
        return <div key={branch.id}>{!operatingContext && <span className="block text-xs font-medium">{branch.name}</span>}<FinancialValue>{amount}</FinancialValue></div>;
      })}</div>;
    },
    price: (productId: string, central: CentralSalesPrice | null, tier: PriceTier, centralStatus?: "loading" | "error") => value(productId, central, tier, centralStatus),
    margin: (productId: string, central: CentralSalesPrice | null, tier: PriceTier, cost: CatalogueMarginCost, centralStatus?: "loading" | "error") => value(productId, central, tier, centralStatus, cost),
  };
}
