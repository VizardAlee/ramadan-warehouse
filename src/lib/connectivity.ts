"use client";

import { useEffect, useState } from "react";

export function sensitiveActionDisabled(online: boolean, pending = false): boolean {
  return !online || pending;
}

export function useConnectivity() {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  useEffect(() => {
    const connected = () => setOnline(true);
    const disconnected = () => setOnline(false);
    window.addEventListener("online", connected);
    window.addEventListener("offline", disconnected);
    return () => {
      window.removeEventListener("online", connected);
      window.removeEventListener("offline", disconnected);
    };
  }, []);
  return { online, dataMayBeStale: !online };
}
