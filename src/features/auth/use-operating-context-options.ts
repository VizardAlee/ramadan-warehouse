"use client";

import { useEffect, useState } from "react";
import { useAuth } from "./auth-context";
import { hasOrganizationWideOperatingAccess, operatingContextTypeLabel, type OperatingContext } from "./operating-context";
import { loadOperatingBranches, type OperatingBranch } from "./operating-context-metadata";

export type OperatingContextOption = OperatingContext & { value: string; name: string; typeLabel: string };

export function useOperatingContextOptions() {
  const { accessProfile, operatingContext, setOperatingContext } = useAuth();
  const organizationWide = Boolean(accessProfile && hasOrganizationWideOperatingAccess(accessProfile));
  const key = JSON.stringify([accessProfile?.uid, accessProfile?.organizationId, accessProfile?.authorizationVersion, accessProfile?.roleIds, accessProfile?.effectivePermissions, accessProfile?.branchIds]);
  const [response, setResponse] = useState<{ key: string; branches: OperatingBranch[]; error?: string }>();
  useEffect(() => {
    if (!accessProfile) return;
    let active = true;
    void loadOperatingBranches(accessProfile).then(branches => { if (active) setResponse({ key, branches }); }).catch(() => { if (active) setResponse({ key, branches: [], error: "Operating locations could not be loaded." }); });
    return () => { active = false; };
  // key includes the immutable authority used to discover options, not the selected view.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const options: OperatingContextOption[] = response?.key === key ? response.branches.map(branch => ({ type: branch.type ?? "branch", id: branch.id, value: `${branch.type ?? "branch"}:${branch.id}`, name: branch.name, typeLabel: operatingContextTypeLabel({ type: branch.type ?? "branch", id: branch.id }, branch.branchType) })) : [];
  const activeValue = operatingContext ? `${operatingContext.type}:${operatingContext.id}` : "";
  const canSelectAll = organizationWide || options.length > 1 || options.some(option => option.type === "warehouse");
  function selectValue(value: string) {
    if (!value && canSelectAll) { setOperatingContext(null); return; }
    const selected = options.find(option => option.value === value);
    if (selected) setOperatingContext({ type: selected.type, id: selected.id });
  }
  return { options, activeValue, activeOption: options.find(option => option.value === activeValue), canSelectAll, selectValue, error: response?.key === key ? response.error : undefined };
}
