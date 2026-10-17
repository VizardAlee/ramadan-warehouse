"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/features/auth/auth-context";
import { callAdministration } from "@/features/administration/api";
import { getFirebaseServices } from "@/lib/firebase/client";
import { loadFinancialBranches, type FinancialBranch, type FinancialBranchAccess } from "./financial-branches";

export function useFinancialBranches(access: FinancialBranchAccess | undefined, identity?: string) {
  const { profile } = useAuth();
  const key = JSON.stringify([identity, profile?.organizationId, profile?.uid, profile?.authorizationVersion, access]);
  const [response, setResponse] = useState<{ key: string; data?: FinancialBranch[]; error?: string }>();
  useEffect(() => {
    if (!profile || !access) return;
    let active = true;
    void loadFinancialBranches(getFirebaseServices().db, profile, access,
      cursor => callAdministration("getDailyCloseWorkspace", { action: "locations", cursor }))
      .then(data => { if (active) setResponse({ key, data }); })
      .catch(cause => { if (active) setResponse({ key, error: cause instanceof Error ? cause.message : "Authorized store names could not be loaded." }); });
    return () => { active = false; };
  // The serialized authority key also hides data while identity or assignments change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const current = response?.key === key ? response : undefined;
  return { data: current?.data ?? [], error: current?.error, loading: Boolean(profile && access && !current) };
}
