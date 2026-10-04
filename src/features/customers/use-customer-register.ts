"use client";

import {
  collection,
  endAt,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  startAt,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
  type QueryConstraint,
} from "firebase/firestore";
import { useEffect, useState } from "react";
import { useAuth } from "@/features/auth/auth-context";
import { getFirebaseServices } from "@/lib/firebase/client";
import type { Customer } from "@/types/domain";

export type CustomerSearchField = "name" | "number" | "phone" | "email";

const searchFields: Record<CustomerSearchField, string> = {
  name: "normalizedName",
  number: "customerNumber",
  phone: "phone",
  email: "email",
};

export function useCustomerRegister() {
  const { profile } = useAuth();
  const organizationId = profile?.organizationId;
  const [data, setData] = useState<Customer[]>([]);
  const [pageSize, setPageSize] = useState(25);
  const [pageStarts, setPageStarts] = useState<(QueryDocumentSnapshot<DocumentData> | null)[]>([null]);
  const [nextCursor, setNextCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [searchField, setSearchField] = useState<CustomerSearchField>("name");
  const [search, setSearch] = useState("");
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const start = pageStarts.at(-1) ?? null;
  const queryKey = JSON.stringify([organizationId, pageSize, searchField, search, start?.id]);
  const loading = loadedKey !== queryKey;

  useEffect(() => {
    if (!organizationId) return;
    const field = search ? searchFields[searchField] : "customerNumber";
    const term = searchField === "name" || searchField === "email" ? search.toLowerCase() : search;
    const constraints: QueryConstraint[] = [
      where("organizationId", "==", organizationId),
      orderBy(field),
      ...(start ? [startAfter(start)] : term ? [startAt(term)] : []),
      ...(term ? [endAt(`${term}\uf8ff`)] : []),
      limit(pageSize + 1),
    ];
    return onSnapshot(query(collection(getFirebaseServices().db, "customers"), ...constraints), (snapshot) => {
      const page = snapshot.docs.slice(0, pageSize);
      setData(page.map((document) => ({ id: document.id, ...document.data() } as Customer)));
      setNextCursor(snapshot.docs.length > pageSize ? page.at(-1) ?? null : null);
      setError(null);
      setLoadedKey(queryKey);
    }, () => {
      setData([]);
      setNextCursor(null);
      setError("Unable to load customers. Check your connection and try again.");
      setLoadedKey(queryKey);
    });
  }, [organizationId, pageSize, queryKey, search, searchField, start]);

  function updateSearch(value: string, field = searchField) {
    setSearch(value.trim());
    setSearchField(field);
    setPageStarts([null]);
  }
  function updatePageSize(value: number) {
    setPageSize(value);
    setPageStarts([null]);
  }
  function nextPage() {
    if (nextCursor) setPageStarts((current) => [...current, nextCursor]);
  }
  function previousPage() {
    setPageStarts((current) => current.length > 1 ? current.slice(0, -1) : current);
  }

  return {
    data: loading ? [] : data,
    loading,
    error: loading ? null : error,
    page: pageStarts.length,
    pageSize,
    hasNextPage: !loading && Boolean(nextCursor),
    searchField,
    updateSearch,
    updatePageSize,
    nextPage,
    previousPage,
  };
}
