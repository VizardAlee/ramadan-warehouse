"use client";
import { FinancialAttributes, FinancialMessage, FinancialText, FinancialValue } from "@/features/finance/financial-privacy";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { downloadCsv, formatNaira } from "@/features/inventory/format";
import { FinancialAmount } from "@/components/ui/financial-amount";
import { marginPercent, rankProfit, type ProfitRow as Row, type ProfitOrder } from "./product-performance-presentation";
import styles from "./product-report.module.css";
interface Result { providerFunds?: { originalMinor: number; creditedMinor: number; netMinor: number }; rows: Row[]; invoiceCount: number; selectedInvoiceCount?: number; branchId?: string | null; completedAt: string }
type Props = { branchId?: string; productId?: string; fromDate: string; toDate: string; onProducts?: (rows: { productId: string; productName: string; sku: string }[]) => void };
export function ProductMargins(props: Props) {
  return <ProductMarginsReport key={JSON.stringify([props.branchId, props.productId, props.fromDate, props.toDate])} {...props} />;
}
function ProductMarginsReport({ branchId, productId, fromDate, toDate, onProducts }: Props) {
  const [data, setData] = useState<Result | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const sequence = useRef(0), key = JSON.stringify([branchId, productId, fromDate, toDate]);
  const [loadedKey, setLoadedKey] = useState("");
  useEffect(() => () => { sequence.current++; }, []);
  async function load() {
    const current = ++sequence.current; setBusy(true); setData(null); setError(""); setPage(1);
    try { const result = await callAdministration<object, Result>("getProductMargins", { branchId: branchId || undefined, productId: productId || undefined, fromDate, toDate }); if (current === sequence.current) { setData(result); setLoadedKey(key); onProducts?.(result.rows); } }
    catch (cause) { if (current === sequence.current) setError(cause instanceof Error ? cause.message : "Product margins could not be loaded."); }
    finally { if (current === sequence.current) setBusy(false); }
  }
  const current = loadedKey === key ? data : null;
  const [order, setOrder] = useState<ProfitOrder>("product"), [page, setPage] = useState(1);
  const ranked = rankProfit(current?.rows ?? [], order), visible = ranked.slice((page - 1) * 25, page * 25);
  const scope = current?.branchId ?? branchId ?? "All permitted Stores";
  const unknownCount = current?.rows.filter(row => row.grossMarginMinor === null).length ?? 0;
  function exportRows() {
    downloadCsv(`product-margins-${fromDate}-${toDate}.csv`, ranked.map(row => ({
      reportBasis: "Invoices issued in range; current collections and approved returns, including later activity; not period P&L",
      fromDate, toDate, timezone: "Africa/Lagos", storeScope: scope, selectedProductId: productId || "All", ranking: order, calculatedAt: current!.completedAt,
      itemKind: row.itemKind ?? "goods", sku: row.sku, product: row.productName,
      invoicedQuantity: row.invoicedQuantity, reversedQuantity: row.reversedQuantity,
      invoicedNetNaira: row.invoicedNetMinor / 100, reversedNetNaira: row.reversedNetMinor / 100,
      netSalesNaira: row.netSalesMinor / 100, recordedCostNaira: row.recordedCostMinor / 100,
      restockCreditsNaira: row.restockCreditMinor / 100, netRecordedCostNaira: row.netRecordedCostMinor / 100,
      unknownCostLines: row.unknownCostLines, grossMarginNaira: row.grossMarginMinor === null ? "Unknown" : row.grossMarginMinor / 100,
      grossMarginPercent: marginPercent(row) ?? "Not meaningful", providerFundsOriginalNaira: (row.providerOriginalMinor ?? 0) / 100,
      providerFundsCreditedNaira: (row.providerCreditedMinor ?? 0) / 100, providerFundsNetNaira: (row.providerNetMinor ?? 0) / 100,
    })));
  }
  return <section className={styles.report} aria-label="Product sales and recorded margins">
    <h2 className="text-lg font-semibold">Product sales and recorded gross profit</h2>
    <p className="text-sm text-[var(--muted)]">Invoice cohort: invoices issued in the selected Lagos dates and Store, across all payment statuses. Current collections and approved returns count even if recorded later. Revenue is net sales excluding VAT and provider pass-through. Cost is recorded issue cost less restock credits; gross profit is revenue less that cost. Overhead and operating expenses are excluded: this is not net profit or period profit and loss. Included parts are counted once in service costs; separately charged goods keep their own cost. Service revenue here is invoiced charges, not period receipt recognition.</p>
    <p className="text-sm text-[var(--muted)]">Missing costs, pending collections and held-return recovery needing allocation leave profit unknown. Signed losses remain losses. Margin % is gross profit ÷ positive net sales; it is not meaningful for zero or negative net sales. Known cost totals can be partial when evidence is missing. This live calculation is not a snapshot; refresh after concurrent activity. Selection still scans the invoice cohort. Limits: 366 days, 20,000 invoices and 2,000 matching products; exceeding a limit fails without partial rankings.</p>
    <div className={styles.controls}>
      <Button disabled={busy || !fromDate || !toDate || fromDate > toDate} onClick={() => void load()}>{busy ? "Calculating…" : "Calculate product margins"}</Button>
      <label>Profit view<select value={order} onChange={event => { setOrder(event.target.value as ProfitOrder); setPage(1); }}>
        <option value="highest">Highest gross profit</option><option value="lowest">Lowest gross profit / losses</option>
        <option value="margin-high">Highest margin %</option><option value="margin-low">Lowest margin %</option>
        <option value="unknown">Unknown cost / profit</option><option value="product">All products including unknown</option>
      </select></label>
      <Button variant="outline" disabled={busy || !ranked.length} onClick={exportRows}>Export product CSV</Button>
    </div>
    {error && <p role="alert" className="text-red-800"><FinancialMessage>{error}</FinancialMessage></p>}
    {current && <>
      <p className="text-sm">{current.invoiceCount} invoices scanned · {current.selectedInvoiceCount ?? current.invoiceCount} matching invoices · {current.rows.length} products · Store: {scope} · {fromDate}–{toDate} (Lagos). Updated {new Date(current.completedAt).toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}</p>
      <p className="text-sm">{unknownCount} products have unknown profit and are excluded from numeric rankings. <button className="underline" onClick={() => { setOrder("unknown"); setPage(1); }}>Show unknown evidence</button>. Numeric rankings retain negative gross profit. Export includes every row in the selected view, not just this page.</p>
      {current.providerFunds && <p className="text-sm">Provider pass-through: <FinancialAmount tone="neutral">{formatNaira(current.providerFunds.netMinor)}</FinancialAmount> net charges (excluded from company revenue and profit).</p>}
      <div className={styles.cards}>{visible.map(row => <FinancialAttributes key={row.productId}><article className={styles.card} aria-label={row.productName}>
        <h3><FinancialText>{row.productName}</FinancialText></h3><small><FinancialText>{row.sku}</FinancialText> · {row.itemKind ?? "goods"}</small>
        <dl>
          <dt>Invoiced / reversed qty</dt><dd>{row.invoicedQuantity} / {row.reversedQuantity}</dd>
          <dt>Revenue (net sales)</dt><dd><FinancialAmount tone="income">{formatNaira(row.netSalesMinor)}</FinancialAmount></dd>
          <dt>{row.unknownCostLines ? "Known cost (incomplete)" : "Net recorded cost"}</dt><dd><FinancialAmount tone="outflow">{formatNaira(row.netRecordedCostMinor)}</FinancialAmount></dd>
          <dt>Restock cost credits</dt><dd><FinancialAmount tone="neutral">{formatNaira(row.restockCreditMinor)}</FinancialAmount></dd>
          <dt>Gross profit</dt><dd>{row.grossMarginMinor === null ? <span>Unknown</span> : <FinancialAmount tone={row.grossMarginMinor < 0 ? "attention" : "income"}>{formatNaira(row.grossMarginMinor)}</FinancialAmount>}</dd>
          <dt>Gross margin %</dt><dd><FinancialValue>{marginPercent(row) ?? "Not meaningful"}</FinancialValue></dd>
          <dt>Cost evidence</dt><dd>{row.unknownCostLines ? `${row.unknownCostLines} incomplete lines` : "Recorded"}</dd>
        </dl>
      </article></FinancialAttributes>)}</div>
      {!ranked.length && <p>No products in this view. A product without cohort invoices has no invoice-cohort row; use Movement → Zero handovers for known local goods.</p>}
      {ranked.length > 25 && <div className={styles.controls}><Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous profit page</Button><span>Page {page} of {Math.ceil(ranked.length / 25)}</span><Button variant="outline" disabled={page * 25 >= ranked.length} onClick={() => setPage(page + 1)}>Next profit page</Button></div>}
    </>}
  </section>;
}
