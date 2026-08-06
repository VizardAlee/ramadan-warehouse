"use client";

import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
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
          if (!snapshot.exists()) throw new Error("Your account has not been provisioned for warehouse access.");
          setProfile({ id: snapshot.id, ...snapshot.data() } as UserProfile);
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
  const value = useMemo(() => ({ user, profile, loading, error, login, logout }), [user, profile, loading, error, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
