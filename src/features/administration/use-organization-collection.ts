"use client";

import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { useAuth } from "@/features/auth/auth-context";
import { getFirebaseServices } from "@/lib/firebase/client";

export function useOrganizationCollection<T extends { id: string }>(
  name: string,
  enabled = true,
  scope?: { field: "branchId" | "warehouseId"; id: string },
) {
  const { profile } = useAuth(); const [data, setData] = useState<T[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  const scopeField = scope?.field; const scopeId = scope?.id;
  const scopeKey = scope ? JSON.stringify([name, profile?.organizationId, profile?.uid, scope.field, scope.id]) : null;
  const [loadedScopeKey, setLoadedScopeKey] = useState<string | null>(null);
  useEffect(() => {
    if (!profile || !enabled) return;
    const constraints = [where("organizationId", "==", profile.organizationId)];
    if (scopeField !== undefined && scopeId !== undefined) constraints.push(where(scopeField, "==", scopeId));
    return onSnapshot(query(collection(getFirebaseServices().db, name), ...constraints), (snapshot) => {
      setData(snapshot.docs.map((document) => ({ id: document.id, ...document.data() } as T))); setLoading(false); setError(null); setLoadedScopeKey(scopeKey);
    }, () => { setError(`Unable to load ${name}.`); setLoading(false); setLoadedScopeKey(scopeKey); });
  }, [enabled, name, profile, scopeField, scopeId, scopeKey]);
  if (enabled && scopeKey !== null && loadedScopeKey !== scopeKey) return { data: [] as T[], loading: true, error: null };
  return enabled
    ? { data, loading, error }
    : { data: [] as T[], loading: false, error: null };
}
