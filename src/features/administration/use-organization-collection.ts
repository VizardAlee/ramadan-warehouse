"use client";

import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { useAuth } from "@/features/auth/auth-context";
import { getFirebaseServices } from "@/lib/firebase/client";

export function useOrganizationCollection<T extends { id: string }>(
  name: string,
  enabled = true,
) {
  const { profile } = useAuth(); const [data, setData] = useState<T[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!profile || !enabled) return;
    return onSnapshot(query(collection(getFirebaseServices().db, name), where("organizationId", "==", profile.organizationId)), (snapshot) => {
      setData(snapshot.docs.map((document) => ({ id: document.id, ...document.data() } as T))); setLoading(false); setError(null);
    }, () => { setError(`Unable to load ${name}.`); setLoading(false); });
  }, [enabled, name, profile]);
  return enabled
    ? { data, loading, error }
    : { data: [] as T[], loading: false, error: null };
}
