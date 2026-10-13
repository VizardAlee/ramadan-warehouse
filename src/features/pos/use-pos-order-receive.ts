"use client";
import { useEffect, useRef, useState } from "react";
import { callAdministration } from "@/features/administration/api";
import type { PosSalePayload } from "./types";
/** Preserve an uncertain online order across reload; retry its exact existing key, never a new payment proposal. */
export function usePosOrderReceive(ownerKey: string) {
  const key = `abr-pending-pos-order:${ownerKey}`;
  const [pending, setPending] = useState<PosSalePayload | null>(null), [ready, setReady] = useState(false), [loadedKey, setLoadedKey] = useState(""), [error, setError] = useState("");
  const flight = useRef(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const raw = sessionStorage.getItem(key), value = raw ? JSON.parse(raw) : null;
        if (value && (typeof value.branchId !== "string" || typeof value.shiftId !== "string" || typeof value.deviceId !== "string" || !Array.isArray(value.lines) || !Array.isArray(value.payments) || typeof value.idempotencyKey !== "string" || !/^[0-9a-f-]{36}$/i.test(value.idempotencyKey)))
          throw new Error("Invalid saved order");
        setPending(value); setLoadedKey(key); setReady(true); setError("");
      } catch { setReady(false); setError("Saved order instructions could not be read. Check order history and restore browser storage before receiving another order."); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [key]);
  async function run<T>(input: PosSalePayload): Promise<T> {
    if (!ready || loadedKey !== key || flight.current) throw new Error("Wait for the saved order check before receiving another order.");
    flight.current = true; const retry = pending, saved = retry ?? input;
    try {
      sessionStorage.setItem(key, JSON.stringify(saved)); setPending(saved);
      const result = await callAdministration<PosSalePayload, T>("createPosSaleOrder", saved);
      sessionStorage.removeItem(key); setPending(null); return result;
    } catch (cause) {
      const diagnostic = cause as { diagnosticCode?: string; code?: string }, code = diagnostic?.diagnosticCode ?? diagnostic?.code ?? "";
      if (!retry && ["functions/invalid-argument", "functions/permission-denied", "functions/failed-precondition", "functions/not-found"].includes(code)) {
        try { sessionStorage.removeItem(key); setPending(null); } catch { /* Keep the exact instructions when storage is unavailable. */ }
      }
      throw cause;
    } finally { flight.current = false; }
  }
  return { pending: loadedKey === key ? pending : null, ready: ready && loadedKey === key, error, run };
}

