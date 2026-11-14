"use client";

import { getIdTokenResult, onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getFirebaseServices } from "@/lib/firebase/client";
import { detachBrowserPush } from "@/features/notifications/push-subscription";
import type { PermissionId, UserProfile } from "@/types/domain";
import {
  availableOperatingContexts,
  bindOperatingContextStorage,
  hasExplicitAllSelection,
  hasOrganizationWideOperatingAccess,
  isAvailableOperatingContext,
  narrowProfileToOperatingContext,
  readStoredOperatingContext,
  storeOperatingContext,
  type OperatingContext,
} from "./operating-context";

import { refreshPurchasingPermissions, safeOfflinePurchasingPermissions } from "./refresh-purchasing-permissions";
import { loadOperatingBranches } from "./operating-context-metadata";
import { IdleSessionBoundary } from "./idle-session-boundary";
import { idleSessionKey } from "./idle-session";

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  accessProfile: UserProfile | null;
  operatingContext: OperatingContext | null;
  setOperatingContext(context: OperatingContext | null): void;
  loading: boolean;
  error: string | null;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  refreshAuthorization(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const offlineProfileKey = (uid: string) => `abr-offline-access-profile:${uid}`;

function cacheAccessProfile(profile: UserProfile) {
  window.localStorage.setItem(offlineProfileKey(profile.uid), JSON.stringify(profile));
}

function readCachedAccessProfile(uid: string): UserProfile | null {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(offlineProfileKey(uid)) ?? "null",
    ) as UserProfile | null;
    return value &&
      value.uid === uid &&
      value.status === "active" &&
      value.authDisabled !== true &&
      typeof value.organizationId === "string" &&
      Array.isArray(value.branchIds) &&
      Array.isArray(value.warehouseIds)
      ? value
      : null;
  } catch {
    return null;
  }
}

async function initialOperatingContext(profile: UserProfile): Promise<OperatingContext | null> {
  bindOperatingContextStorage(profile);
  const stored = readStoredOperatingContext();
  const contexts = availableOperatingContexts(profile);
  if (hasExplicitAllSelection() && (hasOrganizationWideOperatingAccess(profile) || contexts.length > 1 || contexts.some(context => context.type === "warehouse"))) return null;
  if (!navigator.onLine) return isAvailableOperatingContext(stored, profile) ? stored : contexts[0] ?? null;
  const branches = await loadOperatingBranches(profile);
  if (stored && branches.some(branch => branch.id === stored.id && (branch.type ?? "branch") === stored.type)) return stored;
  if (branches.length) return { type: branches[0]!.type ?? "branch", id: branches[0]!.id };
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accessProfile, setAccessProfile] = useState<UserProfile | null>(null);
  const [operatingContext, setOperatingContextState] =
    useState<OperatingContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const { auth, db } = getFirebaseServices();
      return onAuthStateChanged(auth, async (nextUser) => {
        setLoading(true);
        setError(null);
        setUser(nextUser);
        if (!nextUser) {
          setAccessProfile(null);
          setOperatingContextState(null);
          setLoading(false);
          return;
        }
        try {
          let nextProfile: UserProfile;
          let loadedOffline = false;
          try {
            const snapshot = await getDoc(doc(db, "users", nextUser.uid));
            if (!snapshot.exists()) {
              window.localStorage.removeItem(offlineProfileKey(nextUser.uid));
              await signOut(auth);
              throw new Error("Application access has been revoked. Contact an administrator.");
            }
            nextProfile = { id: snapshot.id, ...snapshot.data() } as UserProfile;
            cacheAccessProfile(nextProfile);
          } catch (cause) {
            const cached = navigator.onLine
              ? null
              : readCachedAccessProfile(nextUser.uid);
            if (!cached) throw cause;
            nextProfile = safeOfflinePurchasingPermissions(cached);
            loadedOffline = true;
            setError(
              "Offline access uses the last verified role and branch assignment. Server authorization is checked again during synchronization.",
            );
          }
          if (nextProfile.status !== "active" || nextProfile.authDisabled) {
            window.localStorage.removeItem(offlineProfileKey(nextUser.uid));
            await signOut(auth);
            throw new Error("Application access has been disabled. Contact an administrator.");
          }
          if (!loadedOffline) {
            const token = await getIdTokenResult(nextUser);
            const tokenVersion = token.claims.authorizationVersion;
            const tokenOrganization = token.claims.organizationId;
            if (
              (typeof tokenVersion === "number" && tokenVersion !== nextProfile.authorizationVersion) ||
              (typeof tokenOrganization === "string" && tokenOrganization !== nextProfile.organizationId)
            ) {
              await nextUser.getIdToken(true);
            }
            nextProfile = await refreshPurchasingPermissions(nextProfile, async () => (await httpsCallable<object, { permissions: PermissionId[] }>(getFirebaseServices().functions, "getMyAccessContext")({ action: "purchasing_access", operatingContext: { type: "all" } })).data);
            cacheAccessProfile(nextProfile);
            if (["pending", "expired"].includes(String(nextProfile.invitationStatus))) {
              void httpsCallable(getFirebaseServices().functions, "getMyAccessContext")({}).catch(() => undefined);
            }
          }
          const nextContext = await initialOperatingContext(nextProfile);
          storeOperatingContext(nextContext);
          setOperatingContextState(nextContext);
          setAccessProfile(nextProfile);
        } catch (cause) {
          setAccessProfile(null);
          setError(cause instanceof Error ? cause.message : "Unable to load your access profile.");
        } finally {
          setLoading(false);
        }
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Firebase is not configured.";
      queueMicrotask(() => {
        setError(message);
        setLoading(false);
      });
      return undefined;
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    await signInWithEmailAndPassword(getFirebaseServices().auth, email, password);
  }, []);
  const logout = useCallback(async () => {
    const current = getFirebaseServices().auth.currentUser;
    if (current) window.localStorage.removeItem(offlineProfileKey(current.uid));
    try { await detachBrowserPush(); } catch { /* Sign-out must remain available offline. */ }
    return signOut(getFirebaseServices().auth);
  }, []);
  const expireIdleSession = useCallback(async () => {
    const auth = getFirebaseServices().auth;
    const current = auth.currentUser;
    if (current) {
      try { window.localStorage.removeItem(offlineProfileKey(current.uid)); } catch { /* Still sign out. */ }
    }
    // Never wait for a network/push unsubscribe before closing an idle session.
    void detachBrowserPush().catch(() => undefined);
    await signOut(auth);
  }, []);
  const refreshAuthorization = useCallback(async () => {
    const current = getFirebaseServices().auth.currentUser;
    if (!current) return;
    await current.getIdToken(true);
    const snapshot = await getDoc(doc(getFirebaseServices().db, "users", current.uid));
    if (!snapshot.exists()) {
      window.localStorage.removeItem(offlineProfileKey(current.uid));
      await signOut(getFirebaseServices().auth);
      setAccessProfile(null);
      setError("Application access has been revoked. Contact an administrator.");
      return;
    }
    let nextProfile = { id: snapshot.id, ...snapshot.data() } as UserProfile;
    if (nextProfile.status !== "active" || nextProfile.authDisabled) {
      window.localStorage.removeItem(offlineProfileKey(current.uid));
      await signOut(getFirebaseServices().auth);
      setAccessProfile(null);
      setError("Application access has been disabled. Contact an administrator.");
      return;
    }
    nextProfile = await refreshPurchasingPermissions(nextProfile, async () => (await httpsCallable<object, { permissions: PermissionId[] }>(getFirebaseServices().functions, "getMyAccessContext")({ action: "purchasing_access", operatingContext: { type: "all" } })).data);
    cacheAccessProfile(nextProfile);
    const nextContext = await initialOperatingContext(nextProfile);
    storeOperatingContext(nextContext);
    setOperatingContextState(nextContext);
    setAccessProfile(nextProfile);
  }, []);
  const profile = useMemo(
    () =>
      accessProfile
        ? narrowProfileToOperatingContext(accessProfile, operatingContext)
        : null,
    [accessProfile, operatingContext],
  );
  const setOperatingContext = useCallback(
    (context: OperatingContext | null) => {
      if (!accessProfile) return;
      if (!context) {
        if (!hasOrganizationWideOperatingAccess(accessProfile) && availableOperatingContexts(accessProfile).length < 2 && !availableOperatingContexts(accessProfile).some(context => context.type === "warehouse")) return;
        storeOperatingContext(null);
        setOperatingContextState(null);
        return;
      }
      if (!isAvailableOperatingContext(context, accessProfile))
        return;
      storeOperatingContext(context);
      setOperatingContextState(context);
    },
    [accessProfile],
  );
  const value = useMemo(
    () => ({
      user,
      profile,
      accessProfile,
      operatingContext,
      setOperatingContext,
      loading,
      error,
      login,
      logout,
      refreshAuthorization,
    }),
    [
      user,
      profile,
      accessProfile,
      operatingContext,
      setOperatingContext,
      loading,
      error,
      login,
      logout,
      refreshAuthorization,
    ],
  );
  return <AuthContext.Provider value={value}>{user ? (
    <IdleSessionBoundary
      key={idleSessionKey(user.uid, user.metadata.lastSignInTime ?? "unknown")}
      sessionKey={idleSessionKey(user.uid, user.metadata.lastSignInTime ?? "unknown")}
      onExpire={expireIdleSession}
    >{children}</IdleSessionBoundary>
  ) : children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
