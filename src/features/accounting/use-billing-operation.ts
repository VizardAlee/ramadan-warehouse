"use client";
import { useEffect, useRef, useState } from "react";
import { callAdministration } from "@/features/administration/api";
type Instruction = { name: "billingControls" | "providerFunds" | "billingReceiptCorrections"; input: Record<string, unknown> };
export function useBillingOperation(ownerKey: string) {
  const key = `warehouse-billing-operation:${ownerKey}`, [pending, setPending] = useState<Instruction | null>(null), [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), flight = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; const timer = window.setTimeout(() => { try { const saved = sessionStorage.getItem(key), value = saved ? JSON.parse(saved) : null; if (value && (!["billingControls", "providerFunds", "billingReceiptCorrections"].includes(value.name) || typeof value.input !== "object" || !value.input.idempotencyKey)) throw new Error(); setPending(value); setReady(true); } catch { setError("Saved billing instructions could not be read. Restore browser storage before another operation."); } }, 0); return () => { mounted.current = false; window.clearTimeout(timer); }; }, [key]);
  async function run(name: Instruction["name"], input: Record<string, unknown>) {
    if (flight.current || !ready) return false;
    flight.current = true; setBusy(true); setError("");
    const instruction = pending ?? { name, input: { ...input, idempotencyKey: crypto.randomUUID() } };
    try { sessionStorage.setItem(key, JSON.stringify(instruction)); setPending(instruction); await callAdministration(instruction.name, instruction.input); sessionStorage.removeItem(key); if (mounted.current) setPending(null); return true; }
    catch (cause) { const diagnostic = cause as { diagnosticCode?: string; code?: string }; const code = diagnostic?.diagnosticCode ?? diagnostic?.code ?? ""; if (!pending && ["functions/invalid-argument", "functions/failed-precondition", "functions/permission-denied", "functions/not-found", "functions/already-exists"].includes(code)) { try { sessionStorage.removeItem(key); if (mounted.current) setPending(null); } catch { /* Retain instructions if storage remains unavailable. */ } } if (mounted.current) setError(cause instanceof Error ? cause.message : "Billing operation failed. Retry the saved instructions."); return false; }
    finally { flight.current = false; if (mounted.current) setBusy(false); }
  }
  return { run, pending, ready, busy, error };
}
