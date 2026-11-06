"use client";

import { and, collection, doc, getDocs, limit, onSnapshot, or, orderBy, query, serverTimestamp, startAfter, updateDoc, where, writeBatch, type DocumentData, type QueryDocumentSnapshot, type QueryFilterConstraint, type Timestamp } from "firebase/firestore";
import { useEffect, useState } from "react";
import { useAuth } from "@/features/auth/auth-context";
import { hasOrganizationWideOperatingAccess } from "@/features/auth/operating-context";
import { getFirebaseServices } from "@/lib/firebase/client";

export interface UserNotification {
  id: string; entityId: string; entityType: string; eventType: string;
  branchId?: string | null; sourceBranchId?: string | null; destinationBranchId?: string | null; warehouseId?: string | null;
  title: string; body: string; href: string; actionRequired: boolean;
  occurredAt: Timestamp; readAt: Timestamp | null;
}
interface NotificationScope { kind: "branch" | "warehouse"; ids: string[] }
function scopeFilter(scope: NotificationScope | null): QueryFilterConstraint[] {
  if (!scope) return [];
  const fields = scope.kind === "branch" ? ["branchId", "sourceBranchId", "destinationBranchId"] : ["warehouseId"];
  return [or(...fields.map(field => where(field, "in", scope.ids)))];
}
export function useNotifications() {
  const { user, profile, accessProfile, operatingContext } = useAuth();
  const authority = accessProfile ?? profile;
  const scopes: Array<NotificationScope | null> = [];
  if (operatingContext) scopes.push({ kind: operatingContext.type, ids: [operatingContext.id] });
  else if (authority && hasOrganizationWideOperatingAccess(authority)) scopes.push(null);
  else if (authority) {
    for (const [kind, ids] of [["branch", authority.branchIds], ["warehouse", authority.warehouseIds]] as const) {
      for (let offset = 0; offset < ids.length; offset += 10) scopes.push({ kind, ids: ids.slice(offset, offset + 10) });
    }
  }
  const key = JSON.stringify([user?.uid, profile?.organizationId, profile?.authorizationVersion, scopes]);
  const [state, setState] = useState<{ key: string; rows: UserNotification[]; error: string | null }>();
  useEffect(() => {
    if (!user || !profile) return;
    let active = true, failed = false;
    const pages = new Map<number, UserNotification[]>();
    const unsubscribe = scopes.map((scope, index) => onSnapshot(query(
      collection(getFirebaseServices().db, "users", user.uid, "notifications"),
      and(where("organizationId", "==", profile.organizationId), ...scopeFilter(scope)), orderBy("occurredAt", "desc"), limit(50),
    ), snapshot => {
      if (!active || failed) return;
      pages.set(index, snapshot.docs.map(item => ({ id: item.id, ...item.data() }) as UserNotification));
      if (pages.size === scopes.length) {
        const unique = [...new Map([...pages.values()].flat().map(row => [row.id, row])).values()];
        unique.sort((a, b) => b.occurredAt.toMillis() - a.occurredAt.toMillis() || a.id.localeCompare(b.id));
        setState({ key, rows: unique.slice(0, 50), error: null });
      }
    }, () => { failed = true; if (active) setState({ key, rows: [], error: "Notifications could not be loaded. Try again when connected." }); }));
    return () => { active = false; unsubscribe.forEach(stop => stop()); };
  // key binds every subscription to its account, authority and selected scope.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const current = state?.key === key ? state : undefined;
  const rows = current?.rows ?? [];
  async function markRead(id: string) {
    if (!user || !rows.some(row => row.id === id)) return;
    await updateDoc(doc(getFirebaseServices().db, "users", user.uid, "notifications", id), { readAt: serverTimestamp() });
  }
  async function clearAll() {
    if (!user || !profile) return;
    const db = getFirebaseServices().db;
    for (const scope of scopes) {
      let last: QueryDocumentSnapshot<DocumentData> | undefined;
      do {
        const page = await getDocs(query(collection(db, "users", user.uid, "notifications"), and(where("organizationId", "==", profile.organizationId), ...scopeFilter(scope)), orderBy("occurredAt", "desc"), ...(last ? [startAfter(last)] : []), limit(400)));
        if (page.empty) break;
        const unread = page.docs.filter(item => !item.data().readAt);
        if (unread.length) { const batch = writeBatch(db); unread.forEach(item => batch.update(item.ref, { readAt: serverTimestamp() })); await batch.commit(); }
        last = page.docs.at(-1);
        if (page.size < 400) break;
      } while (last);
    }
  }
  return { rows, loading: Boolean(user && profile && scopes.length && !current), error: current?.error ?? null, unreadCount: rows.filter(row => !row.readAt).length, markRead, clearAll };
}
