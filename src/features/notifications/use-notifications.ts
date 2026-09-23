"use client";

import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Timestamp,
} from "firebase/firestore";
import { useEffect, useState } from "react";
import { useAuth } from "@/features/auth/auth-context";
import { getFirebaseServices } from "@/lib/firebase/client";

export interface UserNotification {
  id: string;
  entityId: string;
  entityType: string;
  eventType: string;
  title: string;
  body: string;
  href: string;
  actionRequired: boolean;
  occurredAt: Timestamp;
  readAt: Timestamp | null;
}

export function useNotifications() {
  const { user, profile } = useAuth();
  const [state, setState] = useState<{
    ownerId: string | null;
    rows: UserNotification[];
    error: string | null;
  }>({ ownerId: null, rows: [], error: null });

  useEffect(() => {
    if (!user || !profile) return;
    const inbox = query(
      collection(getFirebaseServices().db, "users", user.uid, "notifications"),
      where("organizationId", "==", profile.organizationId),
      orderBy("occurredAt", "desc"),
      limit(50),
    );
    return onSnapshot(inbox, (snapshot) => {
      setState({
        ownerId: user.uid,
        rows: snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as UserNotification),
        error: null,
      });
    }, () => {
      setState({ ownerId: user.uid, rows: [], error: "Notifications could not be loaded. Try again when connected." });
    });
  }, [user, profile]);

  const active = Boolean(user && profile);
  const current = active && state.ownerId === user?.uid;
  const rows = current ? state.rows : [];

  const markRead = async (id: string) => {
    if (!user) return;
    await updateDoc(doc(getFirebaseServices().db, "users", user.uid, "notifications", id), {
      readAt: serverTimestamp(),
    });
  };
  return {
    rows,
    loading: active && !current,
    error: current ? state.error : null,
    unreadCount: rows.filter((row) => !row.readAt).length,
    markRead,
  };
}
