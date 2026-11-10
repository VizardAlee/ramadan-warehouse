"use client";

import { useEffect, useRef, useState } from "react";
import { callAdministration } from "@/features/administration/api";

export type HandoverChoice = "now" | "later";
interface PendingConfirmation {
  orderId: string;
  choice: HandoverChoice;
  idempotencyKey: string;
}
export interface ConfirmedPosSale {
  saleId: string;
  orderNumber: string;
  receiptNumber: string;
}

/** Payment confirmation can finish even if its response is lost. Retain its exact reference. */
export function usePosPaymentConfirmation(scope: string) {
  const storageKey = `abr-pos-payment-confirmation:${scope}`;
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const [loadedKey, setLoadedKey] = useState("");
  const [error, setError] = useState("");
  const flight = useRef(false);
  const currentKey = useRef(storageKey);
  useEffect(() => {
    currentKey.current = storageKey;
    const timer = window.setTimeout(() => {
      try {
        const raw = sessionStorage.getItem(storageKey);
        const value = raw ? JSON.parse(raw) : null;
        if (value && (typeof value.orderId !== "string" || !["now", "later"].includes(value.choice) || typeof value.idempotencyKey !== "string" || !/^[0-9a-f-]{36}$/i.test(value.idempotencyKey))) throw new Error("Invalid saved confirmation");
        setPending(value); setLoadedKey(storageKey); setError("");
      } catch { setError("Saved payment confirmation could not be read. Check the invoice history and restore browser storage before confirming another payment."); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey]);

  async function run(orderId: string, choice: HandoverChoice) {
    if (loadedKey !== storageKey || flight.current) throw new Error("Wait for the pending payment confirmation check.");
    if (pending && pending.orderId !== orderId) throw new Error("Retry the pending payment confirmation before starting another one.");
    const saved = pending ?? { orderId, choice, idempotencyKey: crypto.randomUUID() };
    const wasPending = Boolean(pending);
    flight.current = true;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(saved)); setPending(saved);
      const result = await callAdministration<object, ConfirmedPosSale>("confirmPosSaleOrder", { orderId: saved.orderId, idempotencyKey: saved.idempotencyKey, deferCollection: true });
      sessionStorage.removeItem(storageKey); if (currentKey.current === storageKey) setPending(null);
      return { ...result, choice: saved.choice };
    } catch (cause) {
      const diagnostic = cause as { diagnosticCode?: string; code?: string };
      if (!wasPending && ["functions/invalid-argument", "functions/permission-denied", "functions/failed-precondition", "functions/not-found"].includes(diagnostic?.diagnosticCode ?? diagnostic?.code ?? "")) {
        try { sessionStorage.removeItem(storageKey); if (currentKey.current === storageKey) setPending(null); } catch { /* Preserve the original reference if storage is unavailable. */ }
      }
      throw cause;
    } finally { flight.current = false; }
  }
  return { pending: loadedKey === storageKey ? pending : null, ready: loadedKey === storageKey, error, run };
}
