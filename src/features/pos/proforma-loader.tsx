"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import type { PosWorkspace } from "./types";
import type { Proforma } from "./proforma-document";
export function ProformaLoader({ branchId, online, disabled, queued, onLoad }: { branchId: string; online: boolean; disabled: boolean; queued: Map<string, number>; onLoad: (quote: Proforma, workspace: PosWorkspace) => boolean }) {
  const [quoteId, setQuoteId] = useState("");
  useEffect(() => { const timer = window.setTimeout(() => setQuoteId(new URLSearchParams(window.location.search).get("proformaId") ?? ""), 0); return () => clearTimeout(timer); }, []);
  const [quote, setQuote] = useState<Proforma>(), [busy, setBusy] = useState(false), [error, setError] = useState<string>(), [loaded, setLoaded] = useState(false);
  const callback = useRef(onLoad); useEffect(() => { callback.current = onLoad; }, [onLoad]);
  useEffect(() => { if (!quoteId || !online) return; let active = true; void callAdministration<object, Proforma>("getSaleDocument", { action: "get_proforma", proformaId: quoteId }).then(value => { if (active) setQuote(value); }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Proforma could not be loaded."); }); return () => { active = false; }; }, [online, quoteId]);
  if (!quoteId) return null;
  async function load() {
    if (!quote || busy || disabled || !online) return; setBusy(true); setError(undefined);
    try {
      if (quote.branchId !== branchId) throw new Error("Choose the proforma's store before converting it.");
      if (Date.parse(quote.expiresAt) < Date.now()) throw new Error("This proforma expired. Issue a new quote or start a new sale.");
      const workspace = await callAdministration<object, PosWorkspace>("getPosWorkspace", { branchId, limit: 500 });
      if (workspace.branch.id !== branchId) throw new Error("Fresh stock belongs to another store.");
      if (quote.customerId && !workspace.customers.some(row => row.id === quote.customerId)) throw new Error("The quoted customer is inactive or unavailable. Review the customer before conversion.");
      for (const line of quote.lines) { const product = workspace.products.find(row => row.id === line.productId); if (!product || (product.itemKind !== "service" && product.availableQuantity - (queued.get(product.id) ?? 0) < line.quantity)) throw new Error(`Current stock/catalogue cannot supply ${line.productName}. Refresh or restock; the quote reserved no goods.`); if (line.priceTier === "wholesale" && !product.wholesalePriceMinor) throw new Error(`Wholesale pricing is no longer available for ${line.productName}. Issue a revised quote.`); }
      if (callback.current(quote, workspace)) setLoaded(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Quote conversion could not be prepared."); } finally { setBusy(false); }
  }
  return <section className="surface space-y-2 p-4" aria-label="Proforma conversion"><h2 className="font-semibold">{quote?.number ?? "Proforma"}</h2><p className="text-sm">Review a fresh basket using current prices and stock. No money, debt or stock is posted until the normal authorized sale workflow completes. Customer credit is rechecked there.</p>{error && <p role="alert">{error}</p>}{loaded ? <p role="status">Proforma loaded with current catalogue prices. Review totals, serials, service details, credit and payment before receiving the order.</p> : <Button variant="outline" disabled={busy || disabled || !online || !quote} disabledReason={!online ? "Reconnect to check current stock/prices and the quote." : disabled ? "Start with an empty basket and finish any pending order first." : undefined} onClick={() => void load()}>Load proforma into empty basket</Button>}</section>;
}
