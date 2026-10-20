"use client";

import { useEffect, useState } from "react";
import { callAdministration } from "@/features/administration/api";
import styles from "./pos-layout.module.css";

export interface PosFastMoving {
  version: 1;
  branchId: string;
  status: "ready" | "insufficient_history" | "unavailable" | "refreshing";
  productIds: string[];
  asOf: string;
  expiresAt: string;
}
export function usePosFastMoving(scope: string, branchId: string, online: boolean, refreshedAt?: string) {
  const [state, setState] = useState<{ scope: string; result: PosFastMoving | null }>({ scope: "", result: null });
  useEffect(() => {
    if (!branchId || !online || !refreshedAt) {
      const reset = setTimeout(() => setState({ scope: "", result: null }), 0);
      return () => clearTimeout(reset);
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const result = await callAdministration<{ branchId: string; fastMoving: true }, PosFastMoving>("getPosWorkspace", { branchId, fastMoving: true });
        if (cancelled) return;
        if (result?.version !== 1 || result.branchId !== branchId || !Array.isArray(result.productIds) || !Number.isFinite(Date.parse(result.expiresAt)) || Date.parse(result.expiresAt) <= Date.now()) throw Error("Suggestions unavailable");
        setState({ scope, result });
        timer = setTimeout(() => { setState({ scope, result: null }); void load(); }, Math.max(10_000, Date.parse(result.expiresAt) - Date.now()));
      } catch {
        if (cancelled) return;
        setState({ scope, result: { version: 1, branchId, productIds: [], status: "unavailable", asOf: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() } });
        timer = setTimeout(() => void load(), 60_000);
      }
    }
    timer = setTimeout(() => { setState({ scope, result: null }); void load(); }, 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [scope, branchId, online, refreshedAt]);
  return online && state.scope === scope && state.result?.branchId === branchId ? state.result : null;
}

export function FastMovingControls({ result, online, selected, onSelect }: {
  result: PosFastMoving | null; online: boolean; selected: boolean; onSelect: (selected: boolean) => void;
}) {
  const ready = online && result?.status === "ready";
  const message = !online ? "Fast-moving suggestions need a connection. All products remain available from the cached catalogue."
    : !result ? "Checking this branch’s recent completed sales…"
    : result.status === "refreshing" ? "This branch’s suggestions are being refreshed. All products remain available."
    : result.status === "unavailable" ? "Suggestions are unavailable: recent sales evidence could not be verified within the safe calculation limit. All products remain available."
    : result.status === "insufficient_history" ? "Not enough repeat activity yet. This branch needs at least 10 completed goods receipts with quantity remaining across 3 days."
    : result.productIds.length === 0 ? "No products meet the repeat-purchase threshold yet."
    : "Frequently bought at this branch · last 30 days";
  return <div className={styles.fastMovingPanel}>
    <div className={styles.catalogueFilters} role="group" aria-label="Product selection">
      <button type="button" aria-pressed={!selected} onClick={() => onSelect(false)}>All products</button>
      <button type="button" aria-pressed={selected} onClick={() => onSelect(true)}>Fast-moving</button>
    </div>
    <p role="status" className={styles.fastMovingStatus}>{message}</p>
    {ready && result.asOf && <p className={styles.fastMovingStatus}>Updated {new Date(result.asOf).toLocaleString("en-NG", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} WAT · refreshed every 15 minutes while POS is online.</p>}
    <details className={styles.fastMovingHelp}>
      <summary>How fast-moving works</summary>
      <p>Based on completed sales at this branch in the last 30 days. A product needs at least 5 separate receipts across 3 Lagos calendar days and must fall in the top 20% by repeat purchases; equal scores share the label. Approved returns and cancellations reduce the purchased quantity: a receipt counts only while some quantity remains. Drafts, rejected orders, stock transfers, services and included service parts do not count. Different units are never added together; unverifiable historical units receive no label. Short history can produce no suggestions. Out-of-stock products keep their label but cannot be added until available. Suggestions may lag new sales or returns by up to 15 minutes.</p>
    </details>
  </div>;
}
