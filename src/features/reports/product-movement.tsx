"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { downloadCsv } from "@/features/inventory/format";
import { rankMovement, type MovementOrder, type QuantityRow } from "./product-performance-presentation";
import styles from "./product-report.module.css";
interface Result { rows: QuantityRow[]; branchId: string | null; fromDate: string; toDate: string; calendarDays: number; scannedEntries: number; unresolvedEntries: number; zeroPopulationIncluded: boolean; population: string; startedAt: string; completedAt: string }
type Props = { branchId?: string; productId?: string; fromDate: string; toDate: string; canExport: boolean; onProducts?: (rows: { productId: string; productName: string; sku: string }[]) => void };
export function ProductMovement(props: Props) { return <MovementReport key={JSON.stringify([props.branchId, props.productId, props.fromDate, props.toDate])} {...props} />; }
function MovementReport({ branchId, productId, fromDate, toDate, canExport, onProducts }: Props) {
  const [data, setData] = useState<Result | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [order, setOrder] = useState<MovementOrder>("fast"), [page, setPage] = useState(1);
  const sequence = useRef(0); useEffect(() => () => { sequence.current++; }, []);
  async function load() {
    const version = ++sequence.current; setData(null); setBusy(true); setError(""); setPage(1);
    try {
      const result = await callAdministration<object, Result>("getProductMovement", { branchId: branchId || undefined, productId: productId || undefined, fromDate, toDate });
      if (version === sequence.current) { setData(result); onProducts?.(result.rows); }
    } catch (cause) { if (version === sequence.current) setError(cause instanceof Error ? cause.message : "Movement could not be calculated."); }
    finally { if (version === sequence.current) setBusy(false); }
  }
  const ranked = rankMovement(data?.rows ?? [], order), visible = ranked.slice((page - 1) * 25, page * 25);
  const unknown = data?.rows.filter(row => row.unknownEntryCount > 0).length ?? 0;
  return <section className={styles.report} aria-label="Customer product movement">
    <h2 className="text-lg font-semibold">Fast / slow customer movement</h2>
    <p className="text-sm text-[var(--muted)]">Physical goods leaving Store stock for customers in the selected Lagos dates, less customer goods actually restocked in those dates. Delayed and partial pickup counts on handover, not invoice date; a later restock counts in its own period. Included service parts are separate consumption, excluded from customer handover rankings. Transfers, receipts, reservations, cancellation of uncollected goods and service-only quantities do not count. Held goods count only when restored to stock. Independently proven legacy reversals correct their original movement category in the reversal period; ambiguous lineage stays incomplete.</p>
    <p className="text-sm text-[var(--muted)]">Fast / slow ranks positive net quantities relative to other goods in this result, across recorded units. Compare like units; a unit is not revenue or demand. Rate = net customer quantity ÷ inclusive calendar days, including days closed/out of stock. This is not in-stock-day sell-through. Zero handovers, return-dominated negatives and incomplete evidence have separate views. Current stock is shown separately and is not period-end stock. Limits: 366 days, 100,000 scoped entries/balances and 2,000 matching products; limits fail without partial rankings.</p>
    <div className={styles.controls}>
      <Button disabled={busy || !fromDate || !toDate || fromDate > toDate} onClick={() => void load()}>{busy ? "Calculating movement…" : "Calculate customer movement"}</Button>
      <label>Movement view<select value={order} onChange={event => { setOrder(event.target.value as MovementOrder); setPage(1); }}>
        <option value="fast">Fast moving (highest positive net quantity)</option><option value="slow">Slow moving (lowest positive net quantity)</option>
        <option value="zero">Zero handovers / restocks</option><option value="returns">Return-dominated / net inward (negative)</option><option value="unknown">Incomplete movement evidence</option><option value="product">All known products</option>
      </select></label>
      <Button variant="outline" disabled={!canExport || busy || !ranked.length} disabledReason={!canExport ? "Existing inventory export permission is required." : undefined} onClick={() => downloadCsv(`customer-movement-${fromDate}-${toDate}.csv`, ranked.map(row => ({
        basis: "Physical customer handovers less actual customer restocks in Lagos calendar period; not invoice sales or in-stock-day sell-through",
        fromDate, toDate, timezone: "Africa/Lagos", storeScope: data!.branchId ?? "All permitted Stores", selectedProductId: productId || "All", ranking: order,
        calendarDays: data!.calendarDays, calculatedAt: data!.completedAt, population: data!.population,
        productId: row.productId, product: row.productName, sku: row.sku, unit: row.unitOfMeasure,
        handedOverQuantity: row.handedOverQuantity, restockedQuantity: row.restockedQuantity, includedPartsQuantity: row.includedPartsQuantity,
        netCustomerQuantity: row.unknownEntryCount ? "Incomplete" : row.netCustomerQuantity,
        netUnitsPerCalendarDay: row.unknownEntryCount ? "Incomplete" : row.netCustomerQuantity / data!.calendarDays,
        currentOnHandQuantity: row.currentOnHandQuantity ?? "Not in active local goods population", unknownEntryCount: row.unknownEntryCount,
      })))}>Export movement CSV</Button>
    </div>
    {error && <p role="alert" className="text-red-800">{error}</p>}
    {data && <>
      <p className="text-sm">{data.fromDate}–{data.toDate} · {data.calendarDays} calendar days (Lagos) · Store: {data.branchId ?? "All permitted Stores"} · {data.scannedEntries} entries scanned · {data.rows.length} products. Updated {new Date(data.completedAt).toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}</p>
      <p className="text-sm">{data.population} No snapshot is held while this report runs; refresh after concurrent activity. Export covers every row in the selected view, not just this page.</p>
      <p className="text-sm">{unknown} products have incomplete evidence and are excluded from numeric rankings; {data.unresolvedEntries} additional entries lack a product identity. <button className="underline" onClick={() => { setOrder("unknown"); setPage(1); }}>Review incomplete movement</button></p>
      <div className={styles.cards}>{visible.map(row => <article key={row.productId} className={styles.card} aria-label={row.productName}>
        <h3>{row.productName}</h3><small>{row.sku} · {row.unitOfMeasure}</small>
        <dl>
          <dt>Customer handovers</dt><dd>{row.handedOverQuantity}</dd><dt>Actual restocks</dt><dd>{row.restockedQuantity}</dd>
          <dt>Net customer quantity</dt><dd>{row.unknownEntryCount ? "Incomplete" : row.netCustomerQuantity}</dd>
          <dt>Net units / calendar day</dt><dd>{row.unknownEntryCount ? "Incomplete" : (row.netCustomerQuantity / data.calendarDays).toLocaleString("en-NG", { maximumFractionDigits: 3 })}</dd>
          <dt>Included service parts</dt><dd>{row.includedPartsQuantity}</dd><dt>Current stock</dt><dd>{row.currentOnHandQuantity ?? "Outside active local population"}</dd>
          <dt>Evidence</dt><dd>{row.unknownEntryCount ? `${row.unknownEntryCount} incomplete entries` : "Recorded"}</dd>
        </dl>
      </article>)}</div>
      {!ranked.length && <p>No products in this movement view. Try zero handovers, return-dominated or all known products.</p>}
      {ranked.length > 25 && <div className={styles.controls}><Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous movement page</Button><span>Page {page} of {Math.ceil(ranked.length / 25)}</span><Button variant="outline" disabled={page * 25 >= ranked.length} onClick={() => setPage(page + 1)}>Next movement page</Button></div>}
    </>}
  </section>;
}
