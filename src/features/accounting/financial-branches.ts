import { collection, doc, getDoc, getDocs, query, where, type Firestore } from "firebase/firestore";
import { hasPermission, roleIdsForProfile } from "@/lib/permissions/roles";
import type { UserProfile } from "@/types/domain";

export interface FinancialBranch { id: string; name: string }
export interface FinancialBranchAccess {
  branchIds: string[]; permissions: string[]; organizationPermissions: string[];
}
interface LocationPage { rows: FinancialBranch[]; nextCursor: string | null }

/** Reuse existing metadata authority; financial access alone never grants branch visibility. */
export async function loadFinancialBranches(
  db: Firestore, profile: UserProfile, access: FinancialBranchAccess,
  locations: (cursor?: string) => Promise<LocationPage>,
): Promise<FinancialBranch[]> {
  const rows: FinancialBranch[] = [];
  if (access.permissions.includes("daily.close.read")) {
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const page = await locations(cursor);
      if (!Array.isArray(page.rows) || !page.rows.every(row => typeof row.id === "string" && typeof row.name === "string"))
        throw new Error("Store names could not be verified. Refresh after the service finishes updating.");
      rows.push(...page.rows);
      if (rows.length > 10000 || page.nextCursor && (seen.has(page.nextCursor) || rows.length === 10000))
        throw new Error("The authorized store list could not be loaded completely. Ask an administrator to review its paging.");
      cursor = page.nextCursor || undefined;
      if (cursor) seen.add(cursor);
    } while (cursor);
  } else {
    // Match the existing raw branch rules. Custom role bases do not imply user.manage/audit.read.
    const roles = roleIdsForProfile(profile);
    const canReadOrganization = ((roles.includes("system_administrator") || roles.includes("operations_administrator")) && hasPermission(profile, "user.manage")) ||
      (roles.includes("auditor") && hasPermission(profile, "audit.read"));
    const snapshots = canReadOrganization
      ? (await getDocs(query(collection(db, "branches"), where("organizationId", "==", profile.organizationId)))).docs
      : await Promise.all([...new Set(access.branchIds)].map(id => getDoc(doc(db, "branches", id))));
    for (const branch of snapshots) if (branch.exists() && branch.get("organizationId") === profile.organizationId && branch.get("status") === "active")
      rows.push({ id: branch.id, name: String(branch.get("name") || branch.id) });
  }
  const globalRead = access.organizationPermissions.includes("finance.journal.read");
  return [...new Map(rows.filter(row => globalRead || access.branchIds.includes(row.id)).map(row => [row.id, row])).values()]
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function financialScopeLabel(branchId: string, branches: FinancialBranch[]) {
  return branchId ? branches.find(branch => branch.id === branchId)?.name || `Store ${branchId}` : "Entire organization";
}
