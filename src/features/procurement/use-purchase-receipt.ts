"use client";
import { useEffect, useRef, useState } from "react";
import { callAdministration } from "@/features/administration/api";
import type { receivePurchaseOrderItemInput } from "../../../functions/src/validation/procurement";

export type PurchaseReceiptInput = ReturnType<typeof receivePurchaseOrderItemInput.parse>;
export function usePurchaseReceipt(owner: string) {
  const key = `abr-pending-purchase-receipt:${owner}`;
  const [saved, setSaved] = useState<{ key: string; input: PurchaseReceiptInput | null } | null>(null);
  const [error, setError] = useState("");
  const flight = useRef(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const raw = sessionStorage.getItem(key), input = raw ? JSON.parse(raw) : null;
        if (input && (typeof input.purchaseOrderId !== "string" || typeof input.purchaseOrderItemId !== "string" ||
          !Number.isSafeInteger(input.quantity) || input.quantity <= 0 || !Array.isArray(input.serialNumbers) ||
          typeof input.receivedAt !== "string" || !Number.isFinite(Date.parse(input.receivedAt)) ||
          typeof input.idempotencyKey !== "string" || !/^[0-9a-f-]{36}$/i.test(input.idempotencyKey)))
          throw new Error("Invalid saved receipt");
        setSaved({ key, input }); setError("");
      } catch { setError("Saved receiving instructions could not be read. Check receiving history and restore browser storage before receiving more goods."); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [key]);
  const ready = saved?.key === key && !error;
  const pending = saved?.key === key ? saved.input : null;
  async function run(input?: PurchaseReceiptInput) {
    if (!ready || flight.current || (!pending && !input))
      throw new Error("Wait for the saved receipt check before receiving goods.");
    flight.current = true;
    const instruction = pending ?? input!;
    try {
      // A storage failure aborts before the network request, preserving recovery.
      try { sessionStorage.setItem(key, JSON.stringify(instruction)); }
      catch { throw new Error("Browser storage is unavailable. Restore it before receiving goods."); }
      setSaved({ key, input: instruction });
      const result = await callAdministration<PurchaseReceiptInput, { receiptId: string; posted: boolean }>("receivePurchaseOrderItem", instruction);
      sessionStorage.removeItem(key); setSaved({ key, input: null });
      return result;
    } catch (cause) {
      const value = cause as { diagnosticCode?: string; code?: string };
      const code = value?.diagnosticCode ?? value?.code;
      // An uncertain retry stays locked even if current permissions/scope change.
      if (!pending && ["functions/invalid-argument", "functions/permission-denied", "functions/failed-precondition", "functions/not-found"].includes(code ?? "")) {
        try { sessionStorage.removeItem(key); setSaved({ key, input: null }); } catch { /* Keep exact instructions if cleanup fails. */ }
      }
      throw cause;
    } finally { flight.current = false; }
  }
  return { ready: Boolean(ready), pending, error, run };
}
