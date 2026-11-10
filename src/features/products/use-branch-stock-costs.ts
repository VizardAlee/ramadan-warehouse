"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/features/auth/auth-context";
import { callAdministration } from "@/features/administration/api";
import { hasPermission } from "@/lib/permissions/roles";

export interface StockCostPosition {
  id: string;
  branchId?: string;
  productId: string;
  onHandQuantity: number;
  totalValueMinor?: number;
}
export interface BranchStockCost { quantity: number; valueMinor: number; unitCostMinor?: number; invalid: boolean }
export type BranchStockCosts = Record<string, Record<string, BranchStockCost>>;
export interface BranchStockCostResult {
  costs: BranchStockCosts;
  status: "ready" | "loading" | "error" | "restricted" | "choose-branch";
  loadedAt?: number;
  refresh: () => void;
}

/** Sum values and quantities, never average location/lot averages. Keep fractional
 * minor-unit averages for the estimate; currency formatting alone rounds them. */
export function aggregateBranchStockCosts(rows: StockCostPosition[]): BranchStockCosts {
  const costs: BranchStockCosts = Object.create(null);
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) throw new Error("Stock position changed during pagination. Refresh stock costs.");
    seen.add(row.id);
    if (!row.branchId) continue; // Warehouse-only stock is not a branch's cost.
    const products = costs[row.branchId] ??= Object.create(null);
    const total = products[row.productId] ??= { quantity: 0, valueMinor: 0, invalid: false };
    if (!Number.isSafeInteger(row.onHandQuantity) || row.onHandQuantity < 0 ||
      !Number.isSafeInteger(row.totalValueMinor) || row.totalValueMinor! < 0 ||
      (row.onHandQuantity === 0 && row.totalValueMinor !== 0)) { total.invalid = true; continue; }
    total.quantity += row.onHandQuantity;
    total.valueMinor += row.totalValueMinor!;
    if (!Number.isSafeInteger(total.quantity) || !Number.isSafeInteger(total.valueMinor)) total.invalid = true;
  }
  for (const products of Object.values(costs)) for (const total of Object.values(products)) {
    if (!total.invalid && total.quantity > 0) total.unitCostMinor = total.valueMinor / total.quantity;
  }
  return costs;
}

export function useBranchStockCosts(): BranchStockCostResult {
  const { profile, accessProfile, operatingContext } = useAuth();
  const allowed = Boolean(profile && hasPermission(profile, "inventory.cost.read") && hasPermission(profile, "inventory.read"));
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision(value => value + 1);
  const key = JSON.stringify([profile, accessProfile, operatingContext, allowed, revision]);
  const [result, setResult] = useState<{ key: string; costs: BranchStockCosts; status: "ready" | "error"; loadedAt?: number }>();
  useEffect(() => {
    if (!allowed || operatingContext?.type === "warehouse") return;
    let active = true;
    async function load() {
      const rows: StockCostPosition[] = [];
      const cursors = new Set<string>();
      let cursor: string | null = null;
      do {
        const page: { rows: StockCostPosition[]; includeCosts: boolean; nextCursor: string | null } = await callAdministration("generateStockPositionReport", {
          cursor: cursor ?? undefined, limit: 100, includeCosts: true, withSummary: false, view: "positions",
        });
        if (!active) return;
        if (page.includeCosts !== true) throw new Error("Stock costs unavailable.");
        rows.push(...page.rows);
        cursor = page.nextCursor;
        if (cursor && cursors.has(cursor)) throw new Error("Stock pagination did not advance.");
        if (cursor) cursors.add(cursor);
      } while (cursor);
      const costs = aggregateBranchStockCosts(rows);
      if (active) setResult({ key, costs, status: "ready", loadedAt: Date.now() });
    }
    void load().catch(() => { if (active) setResult({ key, costs: {}, status: "error" }); });
    return () => { active = false; };
  // The key includes authority, all permissions, selected view, and refresh revision.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!allowed) return { costs: {}, status: "restricted", refresh };
  if (operatingContext?.type === "warehouse") return { costs: {}, status: "choose-branch", refresh };
  if (result?.key !== key) return { costs: {}, status: "loading", refresh };
  return { ...result, refresh };
}
