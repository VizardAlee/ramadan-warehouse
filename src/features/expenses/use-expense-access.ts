"use client";

import { useEffect, useState } from "react";
import { callAdministration } from "@/features/administration/api";
import { useAuth } from "@/features/auth/auth-context";
import { hasPermission } from "@/lib/permissions/roles";
import type { ExpenseAccess } from "./expense-access";

export function useExpenseAccess() {
  const { profile, operatingContext } = useAuth();
  const identity = JSON.stringify([profile?.organizationId, profile?.uid, profile?.authorizationVersion, profile?.effectivePermissions, operatingContext]);
  const enabled = Boolean(profile && hasPermission(profile, "expenses.read"));
  const [response, setResponse] = useState<{ identity: string; data?: ExpenseAccess; error?: string }>();
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void callAdministration<object, ExpenseAccess>("getExpenseWorkspace", { view: "access" })
      .then(data => {
        if (![data.permissions, data.organizationPermissions, data.branchIds, data.warehouseIds].every(Array.isArray))
          throw new Error("Expense access is unavailable. Refresh after the service finishes updating.");
        if (active) setResponse({ identity, data });
      })
      .catch(error => { if (active) setResponse({ identity, error: error instanceof Error ? error.message : "Expense access could not be checked." }); });
    return () => { active = false; };
  }, [identity, enabled]);
  const current = response?.identity === identity ? response : undefined;
  return { identity, access: current?.data, error: current?.error, loading: enabled && !current };
}
