"use client";

import { getIdTokenResult, onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getFirebaseServices } from "@/lib/firebase/client";
import type { UserProfile } from "@/types/domain";

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  error: string | null;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  refreshAuthorization(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
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
          setProfile(null);
          setLoading(false);
          return;
        }
        try {
          const snapshot = await getDoc(doc(db, "users", nextUser.uid));
          if (!snapshot.exists()) {
            await signOut(auth);
            throw new Error("Warehouse access has been revoked. Contact an administrator.");
          }
          const nextProfile = { id: snapshot.id, ...snapshot.data() } as UserProfile;
          if (nextProfile.status !== "active" || nextProfile.authDisabled) {
            await signOut(auth);
            throw new Error("Warehouse access has been disabled. Contact an administrator.");
          }
          const token = await getIdTokenResult(nextUser);
          const tokenVersion = token.claims.authorizationVersion;
          const tokenOrganization = token.claims.organizationId;
          if (
            (typeof tokenVersion === "number" && tokenVersion !== nextProfile.authorizationVersion) ||
            (typeof tokenOrganization === "string" && tokenOrganization !== nextProfile.organizationId)
          ) {
            await nextUser.getIdToken(true);
          }
          setProfile(nextProfile);
        } catch (cause) {
          setProfile(null);
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
  const logout = useCallback(() => signOut(getFirebaseServices().auth), []);
  const refreshAuthorization = useCallback(async () => {
    const current = getFirebaseServices().auth.currentUser;
    if (!current) return;
    await current.getIdToken(true);
    const snapshot = await getDoc(doc(getFirebaseServices().db, "users", current.uid));
    if (!snapshot.exists()) {
      await signOut(getFirebaseServices().auth);
      setProfile(null);
      setError("Warehouse access has been revoked. Contact an administrator.");
      return;
    }
    const nextProfile = { id: snapshot.id, ...snapshot.data() } as UserProfile;
    if (nextProfile.status !== "active" || nextProfile.authDisabled) {
      await signOut(getFirebaseServices().auth);
      setProfile(null);
      setError("Warehouse access has been disabled. Contact an administrator.");
      return;
    }
    setProfile(nextProfile);
  }, []);
  const value = useMemo(() => ({ user, profile, loading, error, login, logout, refreshAuthorization }), [user, profile, loading, error, login, logout, refreshAuthorization]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
