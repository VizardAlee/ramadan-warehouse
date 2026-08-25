"use client";

import { Download, FileText, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { useOrganizationCollection } from "@/features/administration/use-organization-collection";
import { useAuth } from "@/features/auth/auth-context";
import { formatNaira } from "@/features/inventory/format";
import { SaleDocumentDialog } from "@/features/pos/sale-document";
import type { SaleDocument } from "@/features/pos/types";
import { hasPermission } from "@/lib/permissions/roles";
import type { Branch, InventoryLocation, Product } from "@/types/domain";

const inventoryReports = {
  stock: ["Stock position", "generateStockPositionReport"],
  movement: ["SKU movements", "generateSkuMovementReport"],
  valuation: ["Inventory valuation", "generateInventoryValuationReport"],
  serial: ["Serial numbers", "generateSerialNumberReport"],
  adjustment: ["Stock adjustments", "generateStockAdjustmentReport"],
  count: ["Stock-count variance", "generateStockCountVarianceReport"],
} as const;
type InventoryReportKey = keyof typeof inventoryReports;
type ReportFamily = "sales" | "inventory";

interface InventoryReportResult {
  rows: Record<string, unknown>[];
  nextCursor: string | null;
}
interface SalesReportRow {
  id: string;
  saleNumber: string;
  receiptNumber: string;
  branchId: string;
  branchName: string;
  customerNumber: string;
  customerName: string;
  paymentStatus: string;
  source: string;
  itemCount: number;
  totalQuantity: number;
  netAmountMinor: number;
  vatAmountMinor: number;
  grossAmountMinor: number;
  amountPaidMinor: number;
  creditAmountMinor: number;
  currency: "NGN";
  recordedAt: string;
}
interface SalesCursor { recordedAt: string; saleId: string }
interface SalesReportResult { rows: SalesReportRow[]; nextCursor: SalesCursor | null }

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}
function downloadCsv(filename: string, columns: string[], rows: Record<string, unknown>[]) {
  const content = [columns.map(csvCell).join(","), ...rows.map((row) => columns.map((key) => csvCell(row[key])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
function salesCsvRows(rows: SalesReportRow[]): Record<string, unknown>[] {
  return rows.map((row) => ({
    sale_number: row.saleNumber, receipt_number: row.receiptNumber, date_time: row.recordedAt,
    branch: row.branchName, customer_number: row.customerNumber, customer: row.customerName,
    payment_status: row.paymentStatus, source: row.source, item_count: row.itemCount,
    total_quantity: row.totalQuantity, net_amount_naira: (row.netAmountMinor / 100).toFixed(2),
    vat_naira: (row.vatAmountMinor / 100).toFixed(2), invoice_total_naira: (row.grossAmountMinor / 100).toFixed(2),
    amount_paid_naira: (row.amountPaidMinor / 100).toFixed(2), outstanding_naira: (row.creditAmountMinor / 100).toFixed(2), currency: row.currency,
  }));
}

export default function ReportsPage() {
  const { profile } = useAuth();
  const products = useOrganizationCollection<Product>("products");
  const locations = useOrganizationCollection<InventoryLocation>("inventoryLocations");
  const branches = useOrganizationCollection<Branch>("branches");
  const canReadInventory = Boolean(profile && hasPermission(profile, "reports.inventory.read"));
  const canExportInventory = Boolean(profile && hasPermission(profile, "reports.inventory.export"));
  const canReadSales = Boolean(profile && hasPermission(profile, "reports.sales.read"));
  const includeCosts = Boolean(profile && hasPermission(profile, "inventory.cost.read"));
  const [family, setFamily] = useState<ReportFamily>(canReadSales ? "sales" : "inventory");
  const [kind, setKind] = useState<InventoryReportKey>("stock");
  const [productId, setProductId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [inventoryRows, setInventoryRows] = useState<Record<string, unknown>[]>([]);
  const [inventoryCursor, setInventoryCursor] = useState<string | null>(null);
  const [branchId, setBranchId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [salesRows, setSalesRows] = useState<SalesReportRow[]>([]);
  const [salesCursor, setSalesCursor] = useState<SalesCursor | null>(null);
  const [saleDocument, setSaleDocument] = useState<SaleDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inventoryColumns = useMemo(() => [...new Set(inventoryRows.flatMap((row) => Object.keys(row)))], [inventoryRows]);

  async function loadInventory(next = false) {
    setLoading(true); setMessage(null);
    try {
      const result = await callAdministration<object, InventoryReportResult>(inventoryReports[kind][1], {
        productId: productId || undefined, locationId: locationId || undefined,
        cursor: next ? inventoryCursor : undefined, limit: 50, includeCosts,
      });
      setInventoryRows((current) => next ? [...current, ...result.rows] : result.rows);
      setInventoryCursor(result.nextCursor);
      if (!result.rows.length) setMessage("No rows matched this inventory report page.");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "The inventory report query was rejected."); }
    finally { setLoading(false); }
  }

  async function loadSales(next = false) {
    setLoading(true); setMessage(null);
    try {
      const result = await callAdministration<object, SalesReportResult>("generateSalesReport", {
        reportType: "sales_register", branchId: branchId || undefined, fromDate: fromDate || undefined,
        toDate: toDate || undefined, cursor: next ? salesCursor : undefined, limit: 100,
      });
      setSalesRows((current) => next ? [...current, ...result.rows] : result.rows);
      setSalesCursor(result.nextCursor);
      if (!result.rows.length) setMessage("No posted sales matched the selected filters.");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "The sales report query was rejected."); }
    finally { setLoading(false); }
  }

  async function downloadCompleteSalesCsv() {
    setLoading(true); setMessage(null);
    try {
      const allRows: SalesReportRow[] = [];
      let cursor: SalesCursor | null = null;
      do {
        const result: SalesReportResult = await callAdministration("generateSalesReport", {
          reportType: "sales_register", branchId: branchId || undefined, fromDate: fromDate || undefined,
          toDate: toDate || undefined, cursor: cursor ?? undefined, limit: 500,
        });
        allRows.push(...result.rows); cursor = result.nextCursor;
        if (allRows.length >= 25_000 && cursor) throw new Error("This export exceeds 25,000 sales. Select a shorter date range.");
      } while (cursor);
      if (!allRows.length) { setMessage("No posted sales matched the selected filters."); return; }
      const exportRows = salesCsvRows(allRows);
      downloadCsv(`sales-register-${fromDate || "all"}-to-${toDate || "current"}.csv`, Object.keys(exportRows[0]!), exportRows);
      setMessage(`${allRows.length} posted sale${allRows.length === 1 ? "" : "s"} downloaded.`);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "The sales report could not be downloaded."); }
    finally { setLoading(false); }
  }

  async function openSaleDocument(saleId: string) {
    setLoading(true); setMessage(null);
    try { setSaleDocument(await callAdministration<{ saleId: string }, SaleDocument>("getSaleDocument", { saleId })); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "The official invoice and receipt could not be loaded."); }
    finally { setLoading(false); }
  }

  if (!canReadInventory && !canReadSales) return <div className="rounded-xl border bg-white p-8">You do not have permission to view reports.</div>;

  return <div className="space-y-5">
    <header><h1 className="text-3xl font-semibold">Reports &amp; sales documents</h1><p className="text-[var(--muted)]">Download server-scoped reports and reprint official invoices and receipts.</p></header>
    <div className="flex gap-2 rounded-xl border bg-white p-2">
      {canReadSales && <Button variant={family === "sales" ? "primary" : "ghost"} onClick={() => setFamily("sales")}>Sales register</Button>}
      {canReadInventory && <Button variant={family === "inventory" ? "primary" : "ghost"} onClick={() => setFamily("inventory")}>Inventory reports</Button>}
    </div>

    {family === "sales" && canReadSales ? <>
      <section className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-sm font-medium">Branch<select value={branchId} onChange={(event) => setBranchId(event.target.value)} className="mt-1 w-full rounded-lg border p-2.5"><option value="">All permitted branches</option>{branches.data.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
        <label className="text-sm font-medium">From date<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="mt-1 w-full rounded-lg border p-2.5" /></label>
        <label className="text-sm font-medium">To date<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="mt-1 w-full rounded-lg border p-2.5" /></label>
        <Button className="self-end" disabled={loading} onClick={() => void loadSales(false)}>{loading && <Loader2 className="mr-2 size-4 animate-spin" />}Run report</Button>
        <Button className="self-end" variant="secondary" disabled={loading} onClick={() => void downloadCompleteSalesCsv()}><Download className="mr-2 size-4" /> Download CSV</Button>
      </section>
      <div className="responsive-table-wrap"><table className="responsive-table text-xs"><thead className="bg-slate-50"><tr><th className="px-3 py-2">Sale / receipt</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Branch</th><th className="px-3 py-2">Customer</th><th className="px-3 py-2 text-right">Net</th><th className="px-3 py-2 text-right">VAT</th><th className="px-3 py-2 text-right">Total</th><th className="px-3 py-2 text-right">Outstanding</th><th className="px-3 py-2">Document</th></tr></thead>
        <tbody>{salesRows.map((row) => <tr key={row.id} className="border-t"><td data-label="Sale / receipt" className="px-3 py-2"><strong>{row.saleNumber}</strong><span className="block font-mono text-[var(--muted)]">{row.receiptNumber}</span></td><td data-label="Date" className="px-3 py-2">{new Date(row.recordedAt).toLocaleString("en-NG")}</td><td data-label="Branch" className="px-3 py-2">{row.branchName}</td><td data-label="Customer" className="px-3 py-2">{row.customerName}</td><td data-label="Net" className="px-3 py-2 text-right">{formatNaira(row.netAmountMinor)}</td><td data-label="VAT" className="px-3 py-2 text-right">{formatNaira(row.vatAmountMinor)}</td><td data-label="Total" className="px-3 py-2 text-right font-semibold">{formatNaira(row.grossAmountMinor)}</td><td data-label="Outstanding" className="px-3 py-2 text-right">{formatNaira(row.creditAmountMinor)}</td><td data-label="Document" className="px-3 py-2"><Button size="sm" variant="outline" disabled={loading} onClick={() => void openSaleDocument(row.id)}><FileText className="mr-1 size-4" /> View</Button></td></tr>)}</tbody></table></div>
      {salesCursor && <Button variant="secondary" disabled={loading} onClick={() => void loadSales(true)}>Load next page</Button>}
    </> : canReadInventory ? <>
      <section className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-4">
        <select value={kind} onChange={(event) => { setKind(event.target.value as InventoryReportKey); setInventoryRows([]); setInventoryCursor(null); }} className="rounded-lg border p-2.5">{Object.entries(inventoryReports).map(([key, [label]]) => <option key={key} value={key}>{label}</option>)}</select>
        <select value={productId} onChange={(event) => setProductId(event.target.value)} className="rounded-lg border p-2.5"><option value="">All products</option>{products.data.map((product) => <option key={product.id} value={product.id}>{product.sku} — {product.name}</option>)}</select>
        <select value={locationId} onChange={(event) => setLocationId(event.target.value)} className="rounded-lg border p-2.5"><option value="">All locations</option>{locations.data.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select>
        <Button disabled={loading} onClick={() => void loadInventory(false)}>{loading && <Loader2 className="mr-2 size-4 animate-spin" />}Run report</Button>
      </section>
      {canExportInventory && inventoryRows.length > 0 && <Button variant="secondary" onClick={() => downloadCsv(`${kind}-report.csv`, inventoryColumns, inventoryRows)}><Download className="mr-2 size-4" /> Download loaded rows CSV</Button>}
      <div className="responsive-table-wrap"><table className="responsive-table text-xs"><thead className="bg-slate-50"><tr>{inventoryColumns.map((column) => <th key={column} className="px-3 py-2 font-semibold">{column}</th>)}</tr></thead><tbody>{inventoryRows.map((row, index) => <tr key={String(row.id ?? index)} className="border-t">{inventoryColumns.map((column) => <td key={column} data-label={column.replaceAll("_", " ")} className="max-w-72 truncate px-3 py-2">{typeof row[column] === "object" ? JSON.stringify(row[column]) : String(row[column] ?? "")}</td>)}</tr>)}</tbody></table></div>
      {inventoryCursor && <Button variant="secondary" disabled={loading} onClick={() => void loadInventory(true)}>Load next page</Button>}
    </> : null}
    {message && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm">{message}</p>}
    {saleDocument && <SaleDocumentDialog document={saleDocument} onClose={() => setSaleDocument(null)} />}
  </div>;
}
