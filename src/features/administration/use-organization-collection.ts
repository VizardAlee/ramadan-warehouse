"use client";

import { collection, documentId, onSnapshot, and, or, query, where, type QueryFilterConstraint } from "firebase/firestore";
import { useEffect, useState } from "react";
import { useAuth } from "@/features/auth/auth-context";
import { hasOrganizationWideOperatingAccess } from "@/features/auth/operating-context";
import { getFirebaseServices } from "@/lib/firebase/client";

const branchOwned = new Set(["branchSalesPrices", "branchRequests", "stockCounts", "inventoryLocations"]);

export function useOrganizationCollection<T extends { id: string }>(
  name: string,
  enabled = true,
  scope?: { field: "branchId" | "warehouseId"; id: string },
  visibility: "view" | "authority" = "view",
) {
  const { profile, accessProfile, operatingContext } = useAuth();
  const [result, setResult] = useState<{ key: string; data: T[]; error: string | null } | null>(null);
  const context = visibility === "view" ? operatingContext : null;
  const staffBranchIds = visibility === "view" && name === "users" && context?.type === "branch" ? context.id : undefined;
  const scopeField = scope?.field ?? (context && branchOwned.has(name) ? context.type === "branch" ? "branchId" : "warehouseId" : undefined);
  const scopeId = scope?.id ?? (scopeField ? context?.id : undefined);
  const assignedWarehouses = accessProfile && !hasOrganizationWideOperatingAccess(accessProfile) ? accessProfile.warehouseIds : null;
  const assigned = accessProfile && !hasOrganizationWideOperatingAccess(accessProfile) ? accessProfile.branchIds : null;
  const key = JSON.stringify([name, enabled, accessProfile?.organizationId, accessProfile?.uid, accessProfile?.authorizationVersion, accessProfile?.roleIds, accessProfile?.effectivePermissions, context, scopeField, scopeId, staffBranchIds, assigned, assignedWarehouses, visibility]);
  useEffect(() => {
    if (!profile || !enabled) return;
    let active = true;
    const base: QueryFilterConstraint[] = [where("organizationId", "==", profile.organizationId)];
    const filters: QueryFilterConstraint[] = [];
    if (staffBranchIds) filters.push(where("branchIds", "array-contains", staffBranchIds));
    if (scopeField && scopeId) filters.push(where(scopeField, "==", scopeId));
    else if (branchOwned.has(name) && assigned) {
      // OR equality filters support any assignment count without silently
      // truncating to Firestore's IN limit. Split independent subscriptions.
      if (!assigned.length && (!(name === "inventoryLocations" || name === "stockCounts") || !assignedWarehouses?.length)) { queueMicrotask(() => { if (active) setResult({ key, data: [], error: null }); }); return; }
    }
    const ids = visibility === "view" && (name === "branches" || name === "warehouses")
      ? context ? (name === "warehouses" && context.type === "warehouse" || name === "branches" && context.type === "branch" ? [context.id] : []) : name === "branches" ? assigned : accessProfile && !hasOrganizationWideOperatingAccess(accessProfile) ? accessProfile.warehouseIds : null
      : null;
    if (ids?.length === 0) { queueMicrotask(() => { if (active) setResult({ key, data: [], error: null }); }); return; }
    const union = ids ? ids.map(id => ({ field: documentId(), id })) : !scopeField && branchOwned.has(name) && assigned ? [
      ...assigned.map(id => ({ field: "branchId", id })),
      ...(name === "inventoryLocations" || name === "stockCounts" ? (assignedWarehouses ?? []).map(id => ({ field: "warehouseId", id })) : []),
    ] : null;
    const groups = union ? Array.from({ length: Math.ceil(union.length / 30) }, (_, index) => union.slice(index * 30, (index + 1) * 30)) : [null];
    const pages = new Map<number, T[]>();
    let failed = false;
    const stop = groups.map((group, index) => {
      const constraints: QueryFilterConstraint[] = [...base];
      if (group) constraints.push(or(...group.map(item => where(item.field, "==", item.id))));
      else constraints.push(...filters);
      return onSnapshot(query(collection(getFirebaseServices().db, name), and(...constraints)), snapshot => {
        if (!active || failed) return;
        pages.set(index, snapshot.docs.map(document => ({ id: document.id, ...document.data() } as T)));
        if (pages.size === groups.length) setResult({ key, data: [...new Map([...pages.values()].flat().map(item => [item.id, item])).values()], error: null });
      }, () => { failed = true; if (active) setResult({ key, data: [], error: `Unable to load ${name}.` }); });
    });
    return () => { active = false; stop.forEach(unsubscribe => unsubscribe()); };
  // The serialized key includes every authority and view input above.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!enabled || !profile) return { data: [] as T[], loading: false, error: null };
  return result?.key === key ? { data: result.data, loading: false, error: result.error } : { data: [] as T[], loading: true, error: null };
}
