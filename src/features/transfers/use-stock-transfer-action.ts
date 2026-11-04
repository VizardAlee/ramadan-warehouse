"use client";

import { useEffect, useRef, useState } from "react";
import { callAdministration } from "@/features/administration/api";

export interface StockTransferAction extends Record<string, unknown> {
  action: string;
  idempotencyKey: string;
}
interface SavedAction {
  scope: string;
  input: StockTransferAction;
}
const actions = new Set(["approve", "receive", "report_problem", "resolve", "price", "record_payment", "return_goods", "review_damage"]);
const definiteRejection = new Set(["functions/invalid-argument", "functions/permission-denied", "functions/failed-precondition", "functions/not-found", "ACCOUNTING_PERIOD_LOCKED"]);

/** Keep the exact financial/stock instruction when a response is interrupted. */
export function useStockTransferAction(owner: string, scope: string) {
  const key = `abr-pending-stock-transfer:${owner}`;
  const [saved, setSaved] = useState<{ key: string; value: SavedAction | null } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const flight = useRef(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const raw = sessionStorage.getItem(key);
        const value = raw ? JSON.parse(raw) as SavedAction : null;
        if (value && (typeof value.scope !== "string" || !value.input ||
          !actions.has(value.input.action) || typeof value.input.idempotencyKey !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.input.idempotencyKey)))
          throw new Error("Invalid saved transfer instructions");
        setSaved({ key, value });
        setError("");
      } catch {
        setError("Saved transfer instructions could not be read. Check the original transfer or payment history and restore browser storage before posting again.");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [key]);
  const ready = saved?.key === key && !error;
  const pending = saved?.key === key ? saved.value : null;
  const scopeChanged = Boolean(pending && pending.scope !== scope);
  async function run<T = unknown>(input?: StockTransferAction): Promise<T> {
    if (!ready || flight.current || (!pending && !input))
      throw new Error("Wait for the saved transfer check before posting.");
    if (pending && input)
      throw new Error("Check the saved result before starting another action. Use Retry saved action.");
    if (scopeChanged)
      throw new Error("Return to the original working location before retrying the saved action.");
    if (!navigator.onLine)
      throw new Error("Reconnect before posting or checking the saved action.");
    const instruction = pending ?? { scope, input: input! };
    flight.current = true;
    setBusy(true);
    try {
      // Save before calling the server. A storage failure must not send a request.
      try { sessionStorage.setItem(key, JSON.stringify(instruction)); }
      catch { throw new Error("Browser storage is unavailable. Restore it before posting this action."); }
      setSaved({ key, value: instruction });
      const result = await callAdministration<StockTransferAction, T>("stockTransfers", instruction.input);
      sessionStorage.removeItem(key);
      setSaved({ key, value: null });
      return result;
    } catch (cause) {
      const value = cause as { diagnosticCode?: string; code?: string };
      const code = value?.diagnosticCode ?? value?.code ?? "";
      // The server emits this only after an absent replay record and a newer
      // monotonic version prove that the exact saved instruction cannot commit.
      // Ordinary validation/permission failures cannot establish that for retries.
      if (code === "SAVED_ACTION_NOT_COMMITTED" || !pending && definiteRejection.has(code)) {
        try { sessionStorage.removeItem(key); setSaved({ key, value: null }); }
        catch { /* Keep saved instructions when browser cleanup is unavailable. */ }
      }
      throw cause;
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  return { ready: Boolean(ready), pending, scopeChanged, busy, error, run };
}
