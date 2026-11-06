"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@/features/auth/auth-context";
import { callAdministration } from "@/features/administration/api";
import type { Customer } from "@/types/domain";
export type CustomerSearchField = "name" | "number" | "phone" | "email";
interface Page { rows: Customer[]; nextCursor: string | null }
export function useCustomerRegister() {
  const { profile, operatingContext } = useAuth();
  const scope = JSON.stringify([profile?.uid, profile?.organizationId, profile?.authorizationVersion, profile?.branchIds, profile?.effectivePermissions, operatingContext]);
  const [pageSize, setPageSize] = useState(25), [searchField, setSearchField] = useState<CustomerSearchField>("name"), [search, setSearch] = useState("");
  const [navigation, setNavigation] = useState<{ scope: string; starts: Array<string | null> }>({ scope, starts: [null] });
  const starts = navigation.scope === scope ? navigation.starts : [null], cursor = starts.at(-1);
  const key = JSON.stringify([scope, pageSize, searchField, search, cursor]);
  const [response, setResponse] = useState<{ key: string; data?: Page; error?: string }>();
  useEffect(() => {
    if (!profile) return;
    let active = true;
    void callAdministration<object, Page>("getCustomerHistory", { action: "list_customers", searchField, search, limit: pageSize, cursor: cursor || undefined })
      .then(data => { if (active) setResponse({ key, data }); }).catch(error => { if (active) setResponse({ key, error: error instanceof Error ? error.message : "Customers could not be loaded." }); });
    return () => { active = false; };
  // key binds the request to current identity, grants, scope and page controls.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const current = response?.key === key ? response : undefined;
  const reset = () => setNavigation({ scope, starts: [null] });
  return {
    data: current?.data?.rows ?? [], loading: Boolean(profile && !current), error: current?.error ?? null,
    page: starts.length, pageSize, searchField, hasNextPage: Boolean(current?.data?.nextCursor),
    updateSearch(value: string, field = searchField) { setSearch(value.trim()); setSearchField(field); reset(); },
    updatePageSize(value: number) { setPageSize(value); reset(); },
    nextPage() { if (current?.data?.nextCursor) setNavigation({ scope, starts: [...starts, current.data.nextCursor] }); },
    previousPage() { setNavigation({ scope, starts: starts.length > 1 ? starts.slice(0, -1) : starts }); },
  };
}
