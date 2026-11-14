"use client";

import { useEffect } from "react";

// Refresh only while online and visible. No writes, queued-sale changes or new
// Firestore permissions: the caller uses the existing scoped workspace endpoint.
export function useBankOptionsRefresh<T>(
  enabled: boolean,
  fetchOptions: () => Promise<T>,
  applyOptions: (value: T) => void,
) {
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let inFlight = false;
    let lastAttempt = -Infinity;
    const refresh = async () => {
      if (disposed || inFlight || document.visibilityState === "hidden" || Date.now() - lastAttempt < 15000) return;
      inFlight = true;
      lastAttempt = Date.now();
      try {
        const options = await fetchOptions();
        if (!disposed) applyOptions(options);
      } catch {
        // Do not discard offline drafts or treat a failed read as an empty list.
        // Payment submission still performs authoritative server validation.
      } finally { inFlight = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60000);
    const resume = () => void refresh();
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [enabled, fetchOptions, applyOptions]);
}

export function retainAvailableBank(id: string, accounts: readonly { id: string }[]): string {
  return accounts.some(account => account.id === id) ? id : "";
}
