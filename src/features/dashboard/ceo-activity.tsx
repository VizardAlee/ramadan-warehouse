"use client";
import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { formatNaira } from "@/features/inventory/format";
import type { CeoDashboard } from "../../../functions/src/dashboard/ceo-model";
type Measure = "compare" | "invoicedMinor" | "checkoutReceiptsMinor";
export function ceoDateLabel(date: string) { return new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", timeZone: "Africa/Lagos" }).format(new Date(`${date}T12:00:00Z`)); }
const axisMoney = (value: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", notation: "compact", maximumFractionDigits: 1 }).format(value / 100);
export function CeoActivity({ workspace, invoiced, loading, href, onNavigate }: {
  workspace: CeoDashboard | null; invoiced: number | null; loading: boolean;
  href: (path: string, from?: string, to?: string) => string; onNavigate: () => void;
}) {
  const [measure, setMeasure] = useState<Measure>("compare");
  const trend = workspace?.trend, previous = workspace?.comparison;
  const maximum = Math.max(1, ...(trend ?? []).flatMap(row => measure === "compare" ? [row.invoicedMinor, row.checkoutReceiptsMinor] : [row[measure]]));
  const hasActivity = trend?.some(row => measure === "compare" ? row.invoicedMinor > 0 || row.checkoutReceiptsMinor > 0 : row[measure] > 0);
  const peak = trend?.reduce<(NonNullable<CeoDashboard["trend"]>)[number] | null>((best, row) => row.invoicedMinor > (best?.invoicedMinor ?? 0) ? row : best, null);
  const change = invoiced !== null && previous && previous.invoicedMinor > 0 ? (invoiced - previous.invoicedMinor) / previous.invoicedMinor * 100 : null;
  const comparisonMaximum = Math.max(1, invoiced ?? 0, previous?.invoicedMinor ?? 0);
  return <section id="ceo-activity" className="ceo-activity-grid" aria-label="Trends and comparisons">
    <div className="ceo-panel ceo-chart-panel">
      <div className="ceo-section-heading"><div><p className="ceo-eyebrow">THE DIRECTION</p><h2>Activity over time</h2></div><div className="ceo-measures" role="group" aria-label="Chart measure">{([["compare", "Compare"], ["invoicedMinor", "Invoiced sales"], ["checkoutReceiptsMinor", "Checkout receipts"]] as const).map(([value, label]) => <button key={value} className="ceo-chip" aria-pressed={measure === value} onClick={() => setMeasure(value)}>{label}</button>)}</div></div>
      <p className="ceo-chart-note">Gross invoiced value and recorded checkout receipts are different measures. Neither is earned income; receipts are before refunds.</p>
      <div className="ceo-legend" aria-label="Chart legend"><span><i className="ceo-dot ceo-invoiced-color" />Invoiced sales</span><span><i className="ceo-dot ceo-receipts-color" />Checkout receipts</span><span className="ceo-muted">NGN · select an interval for details</span></div>
      {loading ? <p role="status" className="ceo-chart-state">Loading chart…</p> : !trend ? <p className="ceo-chart-state">This chart is unavailable or outside your access. Open a permitted report below.</p> : !hasActivity ? <p className="ceo-chart-state">No recorded {measure === "checkoutReceiptsMinor" ? "checkout receipts" : measure === "compare" ? "invoices or checkout receipts" : "invoiced sales"} in this period.</p> : <div className="ceo-plot">
        <div className="ceo-axis" aria-hidden="true"><span>{axisMoney(maximum)}</span><span>{axisMoney(maximum / 2)}</span><span>₦0</span></div>
        <div className={`ceo-bars ${measure === "compare" ? "" : "ceo-bars-single"}`} aria-label={`${measure === "compare" ? "Invoiced sales and checkout receipts" : measure === "invoicedMinor" ? "Invoiced sales" : "Checkout receipts"} chart`}>
          {trend.map((row, index) => <Link key={row.fromDate} className="ceo-bar-link" href={href("/reports", row.fromDate, row.toDate)} onClick={onNavigate} aria-label={`${row.fromDate} to ${row.toDate}: ${measure === "compare" ? `invoiced ${formatNaira(row.invoicedMinor)}, checkout receipts ${formatNaira(row.checkoutReceiptsMinor)}` : formatNaira(row[measure])}. Open sales detail.`}>
            <span className="ceo-bar-value" aria-hidden="true"><b>{ceoDateLabel(row.fromDate)} — {ceoDateLabel(row.toDate)}</b><span>Invoiced {formatNaira(row.invoicedMinor)}</span><span>Checkout {formatNaira(row.checkoutReceiptsMinor)}</span></span>
            {measure !== "checkoutReceiptsMinor" && <span className="ceo-bar ceo-invoiced-color" style={{ height: `${row.invoicedMinor / maximum * 100}%` }} />}
            {measure !== "invoicedMinor" && <span className="ceo-bar ceo-receipts-color" style={{ height: `${row.checkoutReceiptsMinor / maximum * 100}%` }} />}
            {(index % Math.ceil(trend.length / 4) === 0 || index === trend.length - 1) && <span className="ceo-bar-date">{ceoDateLabel(row.fromDate)}</span>}
          </Link>)}
        </div>
      </div>}
      {peak && <Link className="ceo-peak" href={href("/reports", peak.fromDate, peak.toDate)} onClick={onNavigate}><span><span className="ceo-muted">Highest invoiced interval</span><strong>{ceoDateLabel(peak.fromDate)} — {ceoDateLabel(peak.toDate)}</strong></span><strong>{formatNaira(peak.invoicedMinor)}</strong><ArrowUpRight className="size-4" aria-hidden="true" /></Link>}
      {trend && <details className="ceo-chart-table"><summary>View chart figures &amp; open details</summary><div className="overflow-x-auto"><table><caption className="sr-only">Recorded invoiced sales and checkout receipts by interval</caption><thead><tr><th>Period</th><th>Invoiced</th><th>Checkout receipts</th></tr></thead><tbody>{trend.map(row => <tr key={row.fromDate}><td><Link href={href("/reports", row.fromDate, row.toDate)} onClick={onNavigate}>{row.fromDate} — {row.toDate}</Link></td><td>{formatNaira(row.invoicedMinor)}</td><td>{formatNaira(row.checkoutReceiptsMinor)}</td></tr>)}</tbody></table></div></details>}
    </div>
    <div className="ceo-panel ceo-comparison"><p className="ceo-eyebrow">A LITTLE PERSPECTIVE</p><h2>Against the previous period</h2><p className="ceo-chart-note">Invoiced sales over equal-length periods. The current day may still be incomplete.</p>
      <div className="ceo-change">{change === null ? "—" : <>{change >= 0 ? <ArrowUpRight aria-hidden="true" /> : <ArrowDownRight aria-hidden="true" />}<span>{Math.abs(change).toFixed(1)}%</span><small>{change >= 0 ? "higher" : "lower"}</small></>}</div>
      <div className="ceo-comparison-row"><div><span>Selected period</span><strong>{invoiced === null ? "—" : formatNaira(invoiced)}</strong></div><div className="ceo-comparison-track" aria-hidden="true"><span style={{ width: `${(invoiced ?? 0) / comparisonMaximum * 100}%` }} /></div></div>
      <div className="ceo-comparison-row"><div><span>Previous period</span><strong>{previous ? formatNaira(previous.invoicedMinor) : "—"}</strong></div><div className="ceo-comparison-track ceo-comparison-track-previous" aria-hidden="true"><span style={{ width: `${(previous?.invoicedMinor ?? 0) / comparisonMaximum * 100}%` }} /></div><p className="ceo-muted">{previous ? `${previous.fromDate} — ${previous.toDate}` : loading ? "Loading comparison…" : "Comparison unavailable"}</p></div>
      {previous?.invoicedMinor === 0 && <p className="ceo-chart-note">No prior invoiced value. A percentage change would be misleading.</p>}
      <div className="mt-6 flex flex-wrap gap-2"><Link className="ceo-button" href={href("/reports")} onClick={onNavigate}>Explore sales <ArrowRight className="size-4" /></Link>{previous && <Link className="ceo-button" href={href("/reports", previous.fromDate, previous.toDate)} onClick={onNavigate}>Open previous period</Link>}</div>
    </div>
  </section>;
}
