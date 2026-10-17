"use client";

import { useEffect, useState } from "react";
import { callAdministration } from "@/features/administration/api";
import { useAuth } from "@/features/auth/auth-context";
import { hasPermission } from "@/lib/permissions/roles";
import type { PermissionId } from "@/types/domain";

interface FinancialAccess { branchIds: string[]; organizationPermissions: PermissionId[]; permissions: PermissionId[] }
/** Server resolves current custom grants; a role base or sales permission cannot imply financial scope. */
export function useFinancialAccess() {
  const { profile, operatingContext } = useAuth();
  const key = JSON.stringify([profile?.organizationId, profile?.uid, profile?.authorizationVersion, profile?.effectivePermissions, operatingContext]);
  const enabled = Boolean(profile && hasPermission(profile, "finance.journal.read"));
  const [response, setResponse] = useState<{ key: string; data?: FinancialAccess; error?: string }>();
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void callAdministration<object, FinancialAccess>("accountingJournals", { action: "access" })
      .then(data => { if (active) setResponse({ key, data }); })
      .catch(error => { if (active) setResponse({ key, error: error instanceof Error ? error.message : "Financial access could not be checked." }); });
    return () => { active = false; };
  }, [enabled, key]);
  const current = response?.key === key ? response : undefined;
  return { identity: key, access: current?.data, error: current?.error, loading: enabled && !current };
}
