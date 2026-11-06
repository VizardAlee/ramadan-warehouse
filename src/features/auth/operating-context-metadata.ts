import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { getFirebaseServices } from "@/lib/firebase/client";
import { hasPermission, roleIdsForProfile } from "@/lib/permissions/roles";
import type { UserProfile } from "@/types/domain";
import { availableOperatingContexts, hasOrganizationWideOperatingAccess } from "./operating-context";

export interface OperatingBranch { type?: "branch" | "warehouse"; id: string; name: string; branchType?: "head_office" | "store" }
/** Existing metadata authorities only. Finance uses its existing close-location projection. */
export async function loadOperatingBranches(profile: UserProfile): Promise<OperatingBranch[]> {
  const { db, functions } = getFirebaseServices();
  const legacy = availableOperatingContexts(profile).filter(context => context.type === "warehouse");
  if (legacy.length) {
    const documents = await Promise.all(legacy.map(context => getDoc(doc(db, "warehouses", context.id))));
    return documents.filter(item => item.exists() && item.get("organizationId") === profile.organizationId && item.get("status") === "active").map(item => ({ type: "warehouse", id: item.id, name: String(item.get("name") || item.id) }));
  }
  const roles = roleIdsForProfile(profile);
  const rawOrganizationRead = ((roles.includes("system_administrator") || roles.includes("operations_administrator")) && hasPermission(profile, "user.manage")) || roles.includes("auditor") && hasPermission(profile, "audit.read");
  if (hasOrganizationWideOperatingAccess(profile) && !rawOrganizationRead && hasPermission(profile, "daily.close.read")) {
    const rows: OperatingBranch[] = [], seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const response = await httpsCallable<object, { rows: OperatingBranch[]; nextCursor: string | null }>(functions, "getDailyCloseWorkspace")({ action: "locations", ...(cursor ? { cursor } : {}), operatingContext: { type: "all" } });
      rows.push(...response.data.rows);
      cursor = response.data.nextCursor ?? undefined;
      if (cursor && (seen.has(cursor) || rows.length > 10000)) throw new Error("The complete operating location list could not be loaded.");
      if (cursor) seen.add(cursor);
    } while (cursor);
    return rows;
  }
  const documents = rawOrganizationRead
    ? (await getDocs(query(collection(db, "branches"), where("organizationId", "==", profile.organizationId)))).docs
    : await Promise.all([...new Set(profile.branchIds)].map(id => getDoc(doc(db, "branches", id))));
  return documents.filter(branch => branch.exists() && branch.get("organizationId") === profile.organizationId && branch.get("status") === "active").map(branch => ({ id: branch.id, name: String(branch.get("name") || branch.get("code") || branch.id), branchType: branch.get("branchType") === "head_office" ? "head_office" : "store" }));
}
