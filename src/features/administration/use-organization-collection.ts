"use client";

import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { useAuth } from "@/features/auth/auth-context";
import { getFirebaseServices } from "@/lib/firebase/client";

export function useOrganizationCollection<T extends { id: string }>(name: string) {
  const { profile } = useAuth(); const [data, setData] = useState<T[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!profile) return;
    return onSnapshot(query(collection(getFirebaseServices().db, name), where("organizationId", "==", profile.organizationId)), (snapshot) => {
      setData(snapshot.docs.map((document) => ({ id: document.id, ...document.data() } as T))); setLoading(false); setError(null);
    }, () => { setError(`Unable to load ${name}.`); setLoading(false); });
  }, [name, profile]);
  return { data, loading, error };
}
