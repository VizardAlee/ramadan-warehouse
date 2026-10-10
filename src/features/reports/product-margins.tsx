"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { downloadCsv, formatNaira } from "@/features/inventory/format";
interface Row { providerOriginalMinor?: number; providerCreditedMinor?: number; providerNetMinor?: number; itemKind?: "goods" | "service" | "mixed_history"; productId: string; sku: string; productName: string; invoicedQuantity: number; reversedQuantity: number; invoicedNetMinor: number; reversedNetMinor: number; netSalesMinor: number; recordedCostMinor: number; restockCreditMinor: number; netRecordedCostMinor: number; unknownCostLines: number; grossMarginMinor: number | null }
interface Result { providerFunds?: { originalMinor: number; creditedMinor: number; netMinor: number }; rows: Row[]; invoiceCount: number; completedAt: string }
type Props = { branchId?: string; fromDate: string; toDate: string };
export function ProductMargins(props: Props) {
  return <ProductMarginsReport key={JSON.stringify([props.branchId, props.fromDate, props.toDate])} {...props} />;
}
function ProductMarginsReport({ branchId, fromDate, toDate }: Props) {
  const [data, setData] = useState<Result | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const sequence = useRef(0), key = JSON.stringify([branchId, fromDate, toDate]);
  const [loadedKey, setLoadedKey] = useState("");
  useEffect(() => () => { sequence.current++; }, []);
  async function load() {
    const current = ++sequence.current; setBusy(true); setData(null); setError("");
    try { const result = await callAdministration<object, Result>("getProductMargins", { branchId: branchId || undefined, fromDate, toDate }); if (current === sequence.current) { setData(result); setLoadedKey(key); } }
    catch (cause) { if (current === sequence.current) setError(cause instanceof Error ? cause.message : "Product margins could not be loaded."); }
    finally { if (current === sequence.current) setBusy(false); }
  }
  const current = loadedKey === key ? data : null;
  return <section className="space-y-3 rounded-xl border bg-white p-4" aria-label="Product sales and recorded margins">
    <h2 className="text-lg font-semibold">Product sales and recorded gross margins</h2>
    <p className="text-sm text-[var(--muted)]">Uses invoices issued in the selected dates and store, across all payment statuses. Includes their current collections and approved returns, even if recorded later. Net sales exclude VAT. Costs are recorded issue costs less restock credits; overhead and operating expenses are excluded. Missing costs, pending collections or held-return recovery needing allocation leave margin unknown. Included parts are counted once in service costs; separately charged goods keep their own issue cost. Provider pass-through funds are excluded from company net sales, cost and margin. Service net sales are invoiced charges, not receipt-recognized period income. This is an invoice-cohort report, not period profit and loss.</p>
    <div className="flex flex-wrap gap-3"><Button disabled={busy || !fromDate || !toDate || fromDate > toDate} onClick={() => void load()}>{busy ? "Calculating…" : "Calculate product margins"}</Button><Button variant="outline" disabled={busy || !current?.rows.length} onClick={() => downloadCsv(`product-margins-${fromDate}-${toDate}.csv`, current!.rows.map(row => ({ reportBasis: "Invoices issued in range; current collections and approved returns, including later activity; not period P&L", fromDate, toDate, storeScope: branchId || "All authorized stores", calculatedAt: current!.completedAt, itemKind: row.itemKind ?? "goods", providerFundsOriginalNaira: (row.providerOriginalMinor ?? 0) / 100, providerFundsCreditedNaira: (row.providerCreditedMinor ?? 0) / 100, providerFundsNetNaira: (row.providerNetMinor ?? 0) / 100, sku: row.sku, product: row.productName, invoicedQuantity: row.invoicedQuantity, reversedQuantity: row.reversedQuantity, invoicedNetNaira: row.invoicedNetMinor / 100, reversedNetNaira: row.reversedNetMinor / 100, netSalesNaira: row.netSalesMinor / 100, recordedCostNaira: row.recordedCostMinor / 100, restockCreditsNaira: row.restockCreditMinor / 100, netRecordedCostNaira: row.netRecordedCostMinor / 100, unknownCostLines: row.unknownCostLines, grossMarginNaira: row.grossMarginMinor === null ? "Unknown" : row.grossMarginMinor / 100 })))}>Export product CSV</Button></div>
    {error && <p role="alert" className="text-red-800">{error}</p>}
    {current?.providerFunds && <p className="text-sm">Provider pass-through charges: {formatNaira(current.providerFunds.originalMinor)} · credits {formatNaira(current.providerFunds.creditedMinor)} · net payable charges {formatNaira(current.providerFunds.netMinor)} (excluded from company margins).</p>}
    {current && <><p className="text-sm">{current.invoiceCount} invoices · {current.rows.length} products · Updated {new Date(current.completedAt).toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}</p><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead><tr>{["Product", "Invoiced / reversed qty", "Net sales", "Recorded cost", "Restock credits", "Gross margin", "Provider charges / credits", "Cost evidence"].map(label => <th className="p-2" key={label}>{label}</th>)}</tr></thead><tbody>{current.rows.map(row => <tr key={row.productId} className="border-t"><td className="p-2">{row.productName}<small className="block">{row.sku} · {row.itemKind ?? "goods"}</small></td><td className="p-2">{row.invoicedQuantity} / {row.reversedQuantity}</td><td className="p-2">{formatNaira(row.netSalesMinor)}</td><td className="p-2">{formatNaira(row.recordedCostMinor)}</td><td className="p-2">{formatNaira(row.restockCreditMinor)}</td><td className="p-2">{row.grossMarginMinor === null ? "Unknown" : formatNaira(row.grossMarginMinor)}</td><td className="p-2">{formatNaira(row.providerOriginalMinor ?? 0)} / {formatNaira(row.providerCreditedMinor ?? 0)}</td><td className="p-2">{row.unknownCostLines ? `${row.unknownCostLines} incomplete lines` : "Recorded"}</td></tr>)}</tbody></table></div>{!current.rows.length && <p>No invoices in this range.</p>}</>}
  </section>;
}
