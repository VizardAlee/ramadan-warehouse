"use client";
import { FinancialText } from "@/features/finance/financial-privacy";
import { useCallback, useState } from "react";
import { ProductMargins } from "./product-margins";
import { ProductMovement } from "./product-movement";
import { ReportPeriodPicker, reportDateRange, type ReportPeriod } from "./date-range";
import styles from "./product-report.module.css";
interface Label { productId: string; productName: string; sku: string }
type Props = { branches: { id: string; name: string }[]; products: { id: string; name: string; sku: string }[]; canReadMargins: boolean; canReadMovement: boolean; canExportMovement: boolean };
export function ProductPerformance({ branches, products, canReadMargins, canReadMovement, canExportMovement }: Props) {
  const [branchId, setBranchId] = useState(""), [productId, setProductId] = useState("");
  const [period, setPeriod] = useState<ReportPeriod>("monthly"), [fromDate, setFromDate] = useState(() => reportDateRange("monthly").fromDate), [toDate, setToDate] = useState(() => reportDateRange("monthly").toDate);
  const [known, setKnown] = useState<Label[]>([]);
  const remember = useCallback((rows: Label[]) => setKnown(old => [...new Map([...old, ...rows].map(row => [row.productId, row])).values()]), []);
  const options = [...new Map([...known, ...products.map(row => ({ productId: row.id, productName: row.name, sku: row.sku }))].map(row => [row.productId, row])).values()].sort((a, b) => a.productName.localeCompare(b.productName) || a.productId.localeCompare(b.productId));
  const props = { branchId: branchId || undefined, productId: productId || undefined, fromDate, toDate, onProducts: remember };
  return <div className="min-w-0 space-y-4">
    <section className={styles.report} aria-label="Product performance filters">
      <h2 className="text-lg font-semibold">Product profitability &amp; movement</h2>
      <p className="text-sm text-[var(--muted)]">Choose one product or compare the result. Both reports use these dates and Store filters, with different reporting bases explained below. Calculate each report explicitly. Changing a filter clears its old results and export. Rankings compare only the selected product scope. Loading all products first also discovers historical product choices.</p>
      <div className={styles.controls}>
        <ReportPeriodPicker value={period} onChange={value => { setPeriod(value); if (value !== "custom") { const range = reportDateRange(value); setFromDate(range.fromDate); setToDate(range.toDate); } }} />
        <label>Store scope<select value={branchId} onChange={event => setBranchId(event.target.value)}><option value="">All permitted Stores / assigned Store</option>{branches.map(branch => <option value={branch.id} key={branch.id}><FinancialText>{branch.name}</FinancialText></option>)}</select></label>
        <label>Product filter<select value={productId} onChange={event => setProductId(event.target.value)}><option value="">All matching products</option>{options.map(row => <option value={row.productId} key={row.productId}><FinancialText>{`${row.productName} · ${row.sku || row.productId}`}</FinancialText></option>)}</select></label>
        <label>Performance from date<input type="date" value={fromDate} onChange={event => { setPeriod("custom"); setFromDate(event.target.value); }} /></label>
        <label>Performance to date<input type="date" value={toDate} onChange={event => { setPeriod("custom"); setToDate(event.target.value); }} /></label>
      </div>
    </section>
    {canReadMargins ? <ProductMargins {...props} /> : <p className="rounded-lg border p-3 text-sm">Gross profit requires existing sales-report and inventory-cost permissions.</p>}
    {canReadMovement ? <ProductMovement {...props} canExport={canExportMovement} /> : <p className="rounded-lg border p-3 text-sm">Customer movement requires existing inventory-report and inventory read permissions in a Store context.</p>}
  </div>;
}
