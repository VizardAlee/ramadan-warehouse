"use client";

import { useEffect, useMemo, useState } from "react";
import { callAdministration } from "@/features/administration/api";
import { useAuth } from "@/features/auth/auth-context";
import { hasOrganizationWideOperatingAccess } from "@/features/auth/operating-context";
import type { InventoryBalance, InventoryLocation } from "@/types/domain";

interface Locations {
  data: InventoryLocation[];
  loading: boolean;
  error: string | null;
}
export interface InventoryPositionSummary {
  count: number;
  onHandQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  valueMinor?: number;
}
interface PositionPage {
  rows: InventoryBalance[];
  nextCursor: string | null;
  summary: InventoryPositionSummary | null;
}
const emptySummary: InventoryPositionSummary = { count: 0, onHandQuantity: 0, reservedQuantity: 0, availableQuantity: 0 };
const emptyIds = new Set<string>();

/** Branch/warehouse IDs resolve to inventory-location IDs; they are never merged. */
export function useLocationInventoryScope(locations: Locations) {
  const { profile, accessProfile, operatingContext } = useAuth();
  const authority = accessProfile ?? profile;
  const canSelectAll = Boolean(authority && hasOrganizationWideOperatingAccess(authority));
  const locationIds = [...new Set(locations.data.filter((location) =>
    operatingContext?.type === "branch" ? location.branchId === operatingContext.id
      : operatingContext?.type === "warehouse" && location.warehouseId === operatingContext.id,
  ).map((location) => location.id))].sort();
  const locationKey = JSON.stringify(locationIds);
  const error = profile && !operatingContext && !canSelectAll ? "Choose a Store/Warehouse to view inventory."
    : operatingContext ? locations.error : null;
  const waiting = !profile || Boolean(operatingContext && locations.loading);
  const empty = Boolean(operatingContext && !waiting && !error && locationIds.length === 0);
  const key = JSON.stringify([
    profile?.organizationId, profile?.uid, profile?.authorizationVersion,
    profile?.roleId, profile?.roleIds, profile?.branchIds, profile?.warehouseIds,
    operatingContext?.type, operatingContext?.id, operatingContext ? locationKey : "all", waiting, error,
  ]);
  return { key, locationKey, selected: Boolean(operatingContext), waiting, error, empty };
}

/** One bounded positions page, plus one whole-scope summary on the first load. */
export function useLocationInventory(locations: Locations, cursor?: string, limit = 25) {
  const scope = useLocationInventoryScope(locations);
  const { key: selectedScopeKey, locationKey, selected, waiting, error: scopeError, empty } = scope;
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision((value) => value + 1);
  const scopeKey = JSON.stringify([selectedScopeKey, revision]);
  const key = JSON.stringify([scopeKey, cursor, limit]);
  const [result, setResult] = useState<{
    key: string; scopeKey: string; rows: InventoryBalance[]; nextCursor: string | null;
    summary: InventoryPositionSummary | null; loading: boolean; error: string | null;
  }>({ key, scopeKey, rows: [], nextCursor: null, summary: null, loading: true, error: null });
  if (result.key !== key) setResult({ key, scopeKey, rows: [], nextCursor: null,
    summary: result.scopeKey === scopeKey ? result.summary : null, loading: true, error: null });
  useEffect(() => {
    if (waiting || scopeError || empty || result.key !== key || !result.loading) return;
    let active = true;
    const savedSummary = result.scopeKey === scopeKey ? result.summary : null;
    callAdministration<object, PositionPage>("generateStockPositionReport", {
      locationIds: selected ? JSON.parse(locationKey) as string[] : undefined,
      cursor, limit, includeCosts: true, withSummary: !savedSummary, view: "positions",
    }).then((page) => {
      if (active) setResult({ key, scopeKey, rows: page.rows, nextCursor: page.nextCursor,
        summary: page.summary ?? savedSummary, loading: false, error: null });
    }).catch((cause) => {
      if (active) setResult({ key, scopeKey, rows: [], nextCursor: null, summary: savedSummary,
        loading: false, error: cause instanceof Error ? cause.message : "Unable to load inventory position." });
    });
    return () => { active = false; };
  }, [key, scopeKey, waiting, scopeError, empty, selected, locationKey, cursor, limit, result.key, result.scopeKey, result.loading, result.summary]);
  if (scopeError) return { rows: [], nextCursor: null, summary: null, loading: false, error: scopeError, refresh };
  if (empty) return { rows: [], nextCursor: null, summary: emptySummary, loading: false, error: null, refresh };
  if (waiting || result.key !== key) return { rows: [], nextCursor: null, summary: null, loading: true, error: null, refresh };
  return { ...result, refresh };
}

/** Catalogue filtering needs membership, not every balance/cost field. Pages are
 * projected IDs only (500 max), with no repeated aggregate totals. */
export function useLocationProductMembership(locations: Locations, enabled = true) {
  const { key: scopeKey, locationKey, selected, waiting, error: scopeError, empty } = useLocationInventoryScope(locations);
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision((value) => value + 1);
  const key = JSON.stringify([scopeKey, enabled, revision]);
  const [result, setResult] = useState<{ key: string; ids: string[]; loading: boolean; error: string | null }>(
    { key, ids: [], loading: true, error: null },
  );
  if (result.key !== key) setResult({ key, ids: [], loading: true, error: null });
  useEffect(() => {
    if (!enabled || waiting || scopeError || empty || result.key !== key || !result.loading) return;
    let active = true;
    async function load() {
      const ids = new Set<string>();
      const seenCursors = new Set<string>();
      let cursor: string | null = null;
      do {
        const page: { rows: { productId?: string }[]; nextCursor: string | null } = await callAdministration("generateStockPositionReport", {
          locationIds: selected ? JSON.parse(locationKey) as string[] : undefined,
          cursor: cursor ?? undefined, limit: 500, includeCosts: false, withSummary: false, view: "membership",
        });
        if (!active) return;
        for (const row of page.rows) if (typeof row.productId === "string" && row.productId) ids.add(row.productId);
        cursor = page.nextCursor;
        if (cursor && seenCursors.has(cursor)) throw new Error("Inventory pagination did not advance. Please retry.");
        if (cursor) seenCursors.add(cursor);
      } while (cursor);
      if (active) setResult({ key, ids: [...ids], loading: false, error: null });
    }
    void load().catch((cause) => {
      if (active) setResult({ key, ids: [], loading: false, error: cause instanceof Error ? cause.message : "Unable to load local product membership." });
    });
    return () => { active = false; };
  }, [key, enabled, waiting, scopeError, empty, selected, locationKey, result.key, result.loading]);
  const productIds = useMemo(() => new Set(result.ids), [result.ids]);
  if (!enabled || empty) return { productIds: emptyIds, loading: false, error: null, refresh };
  if (scopeError) return { productIds: emptyIds, loading: false, error: scopeError, refresh };
  if (waiting || result.key !== key) return { productIds: emptyIds, loading: true, error: null, refresh };
  return { productIds, loading: result.loading, error: result.error, refresh };
}
