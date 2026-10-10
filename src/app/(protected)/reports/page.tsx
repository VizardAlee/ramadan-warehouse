"use client";

import { ChevronDown, Download, FileText, Loader2 } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  PaginatedTableControls,
  useTablePagination,
} from "@/components/ui/table-pagination";
import { callAdministration } from "@/features/administration/api";
import { useOrganizationCollection } from "@/features/administration/use-organization-collection";
import { useAuth } from "@/features/auth/auth-context";
import { formatNaira } from "@/features/inventory/format";
import { SaleDocumentDialog } from "@/features/pos/sale-document";
import type { SaleDocument } from "@/features/pos/types";
import {
  formatInventoryReportValue,
  humanizeInventoryReportRows,
  inventoryReportColumnLabel,
  readableInventoryCsvRows,
} from "@/features/reports/inventory-report-presentation";
import { ReportPeriodPicker, reportDateRange, type ReportPeriod } from "@/features/reports/date-range";
import { FinancialStatements } from "@/features/reports/financial-statements";
import { ProductHistoryPreview } from "@/features/reports/product-history-preview";
import { hasPermission } from "@/lib/permissions/roles";
import type {
  Branch,
  InventoryLocation,
  Product,
  Warehouse,
} from "@/types/domain";

const inventoryReports = {
  stock: ["Stock position", "generateStockPositionReport"],
  movement: ["SKU movements", "generateSkuMovementReport"],
  valuation: ["Inventory valuation", "generateInventoryValuationReport"],
  serial: ["Serial numbers", "generateSerialNumberReport"],
  adjustment: ["Stock adjustments", "generateStockAdjustmentReport"],
  count: ["Stock-count variance", "generateStockCountVarianceReport"],
} as const;
type InventoryReportKey = keyof typeof inventoryReports;
type ReportFamily = "sales" | "inventory" | "financial";

interface InventoryReportResult {
  rows: Record<string, unknown>[];
  nextCursor: string | null;
  summary?: { count: number; onHandQuantity: number; reservedQuantity: number; availableQuantity: number; valueMinor?: number } | null;
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
  subtotalAmountMinor: number;
  discountAmountMinor: number;
  discountReason: string;
  netAmountMinor: number;
  vatAmountMinor: number;
  grossAmountMinor: number;
  amountPaidMinor: number;
  creditAmountMinor: number;
  currency: "NGN";
  recordedAt: string;
}
interface SalesCursor {
  recordedAt: string;
  saleId: string;
}
interface SalesReportResult {
  rows: SalesReportRow[];
  nextCursor: SalesCursor | null;
  summary?: { count: number; subtotalAmountMinor: number; discountAmountMinor: number; netAmountMinor: number; vatAmountMinor: number; grossAmountMinor: number; amountPaidMinor: number; creditAmountMinor: number };
}

function csvCell(value: unknown) {
  const raw =
    value === null || value === undefined
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  const text = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${text.replaceAll('"', '""')}"`;
}
function downloadCsv(
  filename: string,
  columns: string[],
  rows: Record<string, unknown>[],
) {
  const content = [
    columns.map(csvCell).join(","),
    ...rows.map((row) => columns.map((key) => csvCell(row[key])).join(",")),
  ].join("\n");
  const url = URL.createObjectURL(
    new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
function salesCsvRows(rows: SalesReportRow[]): Record<string, unknown>[] {
  return rows.map((row) => ({
    sale_number: row.saleNumber,
    receipt_number: row.receiptNumber,
    date_time: row.recordedAt,
    branch: row.branchName,
    customer_number: row.customerNumber,
    customer: row.customerName,
    payment_status: row.paymentStatus,
    source: row.source,
    item_count: row.itemCount,
    total_quantity: row.totalQuantity,
    product_subtotal_naira: (row.subtotalAmountMinor / 100).toFixed(2),
    discount_naira: (row.discountAmountMinor / 100).toFixed(2),
    discount_reason: row.discountReason,
    net_amount_naira: (row.netAmountMinor / 100).toFixed(2),
    vat_naira: (row.vatAmountMinor / 100).toFixed(2),
    invoice_total_naira: (row.grossAmountMinor / 100).toFixed(2),
    amount_paid_naira: (row.amountPaidMinor / 100).toFixed(2),
    credit_issued_naira: (row.creditAmountMinor / 100).toFixed(2),
    currency: row.currency,
  }));
}

export default function ReportsPage() {
  const { profile } = useAuth();
  const products = useOrganizationCollection<Product>("products");
  const locations =
    useOrganizationCollection<InventoryLocation>("inventoryLocations");
  const branches = useOrganizationCollection<Branch>("branches");
  const warehouses = useOrganizationCollection<Warehouse>("warehouses");
  const canReadInventory = Boolean(
    profile && hasPermission(profile, "reports.inventory.read"),
  );
  const canExportInventory = Boolean(
    profile && hasPermission(profile, "reports.inventory.export"),
  );
  const canReadSales = Boolean(
    profile && hasPermission(profile, "reports.sales.read"),
  );
  const canReadFinancial = Boolean(
    profile && hasPermission(profile, "finance.journal.read"),
  );
  const includeCosts = Boolean(
    profile && hasPermission(profile, "inventory.cost.read"),
  );
  const [family, setFamily] = useState<ReportFamily>(
    canReadSales ? "sales" : canReadFinancial ? "financial" : "inventory",
  );
  const [kind, setKind] = useState<InventoryReportKey>("stock");
  const [productId, setProductId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [inventoryRows, setInventoryRows] = useState<Record<string, unknown>[]>(
    [],
  );
  const [inventoryCursor, setInventoryCursor] = useState<string | null>(null);
  const [inventorySummary, setInventorySummary] = useState<InventoryReportResult["summary"]>(null);
  const [branchId, setBranchId] = useState("");
  const [period, setPeriod] = useState<ReportPeriod>("monthly");
  const [creditOnly, setCreditOnly] = useState(false);
  const [fromDate, setFromDate] = useState(() => reportDateRange("monthly").fromDate);
  const [toDate, setToDate] = useState(() => reportDateRange("monthly").toDate);
  const [salesRows, setSalesRows] = useState<SalesReportRow[]>([]);
  const [salesCursor, setSalesCursor] = useState<SalesCursor | null>(null);
  const [salesSummary, setSalesSummary] = useState<SalesReportResult["summary"]>(undefined);
  const [saleDocument, setSaleDocument] = useState<SaleDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [familyMessages, setFamilyMessages] = useState<Partial<Record<ReportFamily, string>>>({});
  const [inventoryLoadedKey, setInventoryLoadedKey] = useState<string | null>(null);
  const [expandedInventoryRow, setExpandedInventoryRow] = useState<string | null>(null);
  const [salesLoadedKey, setSalesLoadedKey] = useState<string | null>(null);
  const inventoryRequestVersion = useRef(0);
  const salesRequestVersion = useRef(0);
  const activeFamily: ReportFamily =
    family === "sales" && canReadSales
      ? "sales"
      : family === "financial" && canReadFinancial
        ? "financial"
        : family === "inventory" && canReadInventory
          ? "inventory"
          : canReadSales
            ? "sales"
            : canReadFinancial
              ? "financial"
              : "inventory";
  const message = familyMessages[activeFamily] ?? null;
  const setMessage = useCallback((value: string | null) => {
    setFamilyMessages((current) => ({ ...current, [activeFamily]: value ?? undefined }));
  }, [activeFamily]);
  const inventoryQueryKey = JSON.stringify([kind, productId, locationId, includeCosts]);
  const salesQueryKey = JSON.stringify([branchId, fromDate, toDate, creditOnly]);
  const inventoryReady = inventoryLoadedKey === inventoryQueryKey;
  const salesReady = salesLoadedKey === salesQueryKey;
  const inventoryLookups = useMemo(
    () => ({
      products: Object.fromEntries(
        products.data.map((product) => [
          product.id,
          `${product.sku} — ${product.name}`,
        ]),
      ),
      locations: Object.fromEntries(
        locations.data.map((location) => [location.id, location.name]),
      ),
      branches: Object.fromEntries(
        branches.data.map((branch) => [branch.id, branch.name]),
      ),
      warehouses: Object.fromEntries(
        warehouses.data.map((warehouse) => [warehouse.id, warehouse.name]),
      ),
    }),
    [branches.data, locations.data, products.data, warehouses.data],
  );
  const inventoryDisplayRows = useMemo(
    () => humanizeInventoryReportRows(inventoryReady ? inventoryRows : [], inventoryLookups),
    [inventoryLookups, inventoryReady, inventoryRows],
  );
  const inventoryColumns = useMemo(
    () => [...new Set(inventoryDisplayRows.flatMap((row) => Object.keys(row)))],
    [inventoryDisplayRows],
  );
  const inventoryTableRows = useMemo(
    () => inventoryDisplayRows.map((display, index) => ({
      display,
      rowId: String(inventoryRows[index]?.id ?? index),
      productId: typeof inventoryRows[index]?.productId === "string"
        ? inventoryRows[index].productId as string
        : null,
    })),
    [inventoryDisplayRows, inventoryRows],
  );
  const salesPagination = useTablePagination(salesReady ? salesRows : []);
  const inventoryPagination = useTablePagination(inventoryTableRows);
  const setInventoryPage = inventoryPagination.setPage;
  const setSalesPage = salesPagination.setPage;

  useEffect(() => {
    if (activeFamily !== "inventory" || !canReadInventory) return;
    const version = ++inventoryRequestVersion.current;
    const timer = window.setTimeout(() => {
      void (async () => {
        setLoading(true);
        setMessage(null);
        setInventoryPage(1);
        try {
          const result = await callAdministration<object, InventoryReportResult>(inventoryReports[kind][1], {
            productId: productId || undefined,
            locationId: locationId || undefined,
            limit: 50,
            includeCosts,
          });
          if (version !== inventoryRequestVersion.current) return;
          setInventoryRows(result.rows);
          setInventorySummary(result.summary ?? null);
          setInventoryCursor(result.nextCursor);
          setInventoryLoadedKey(inventoryQueryKey);
          if (!result.rows.length) setMessage("No rows matched the selected inventory filters.");
        } catch (cause) {
          if (version !== inventoryRequestVersion.current) return;
          setMessage(cause instanceof Error ? cause.message : "The inventory report query was rejected.");
        } finally {
          if (version === inventoryRequestVersion.current) setLoading(false);
        }
      })();
    }, 250);
    return () => {
      window.clearTimeout(timer);
      inventoryRequestVersion.current += 1;
    };
  }, [activeFamily, canReadInventory, includeCosts, inventoryQueryKey, kind, locationId, productId, setInventoryPage, setMessage]);

  useEffect(() => {
    if (activeFamily !== "sales" || !canReadSales) return;
    const version = ++salesRequestVersion.current;
    const timer = window.setTimeout(() => {
      void (async () => {
        setLoading(true);
        setMessage(null);
        setSalesPage(1);
        if (fromDate && toDate && fromDate > toDate) {
          setMessage("The from date must be on or before the to date.");
          setLoading(false);
          return;
        }
        try {
          const result = await callAdministration<object, SalesReportResult>("generateSalesReport", {
            reportType: "sales_register",
            creditOnly,
            branchId: branchId || undefined,
            fromDate: fromDate || undefined,
            toDate: toDate || undefined,
            limit: 100,
          });
          if (version !== salesRequestVersion.current) return;
          setSalesRows(result.rows);
          setSalesSummary(result.summary);
          setSalesCursor(result.nextCursor);
          setSalesLoadedKey(salesQueryKey);
          if (!result.rows.length) setMessage("No matching sales in this page. Load the next page if available.");
        } catch (cause) {
          if (version !== salesRequestVersion.current) return;
          setMessage(cause instanceof Error ? cause.message : "The sales report query was rejected.");
        } finally {
          if (version === salesRequestVersion.current) setLoading(false);
        }
      })();
    }, 250);
    return () => {
      window.clearTimeout(timer);
      salesRequestVersion.current += 1;
    };
  }, [activeFamily, branchId, canReadSales, fromDate, salesQueryKey, setSalesPage, setMessage, toDate, creditOnly]);

  async function loadInventoryNext() {
    if (!inventoryCursor || !inventoryReady || loading) return;
    const version = inventoryRequestVersion.current;
    setLoading(true);
    setMessage(null);
    try {
      const result = await callAdministration<object, InventoryReportResult>(inventoryReports[kind][1], {
        productId: productId || undefined,
        locationId: locationId || undefined,
        cursor: inventoryCursor,
        limit: 50,
        includeCosts,
      });
      if (version !== inventoryRequestVersion.current) return;
      setInventoryRows((current) => [...current, ...result.rows]);
      setInventoryCursor(result.nextCursor);
    } catch (cause) {
      if (version === inventoryRequestVersion.current)
        setMessage(cause instanceof Error ? cause.message : "The next inventory report page could not be loaded.");
    } finally {
      if (version === inventoryRequestVersion.current) setLoading(false);
    }
  }

  async function loadSalesNext() {
    if (!salesCursor || !salesReady || loading) return;
    const version = salesRequestVersion.current;
    setLoading(true);
    setMessage(null);
    try {
      const result = await callAdministration<object, SalesReportResult>("generateSalesReport", {
        reportType: "sales_register",
            creditOnly,
        branchId: branchId || undefined,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        includeSummary: false,
        cursor: salesCursor,
        limit: 100,
      });
      if (version !== salesRequestVersion.current) return;
      setSalesRows((current) => [...current, ...result.rows]);
      setSalesCursor(result.nextCursor);
    } catch (cause) {
      if (version === salesRequestVersion.current)
        setMessage(cause instanceof Error ? cause.message : "The next sales report page could not be loaded.");
    } finally {
      if (version === salesRequestVersion.current) setLoading(false);
    }
  }

  async function downloadCompleteSalesCsv() {
    setLoading(true);
    setMessage(null);
    try {
      const allRows: SalesReportRow[] = [];
      let cursor: SalesCursor | null = null;
      do {
        const result: SalesReportResult = await callAdministration(
          "generateSalesReport",
          {
            reportType: "sales_register",
            creditOnly,
            branchId: branchId || undefined,
            fromDate: fromDate || undefined,
            toDate: toDate || undefined,
            includeSummary: false,
            cursor: cursor ?? undefined,
            limit: 500,
          },
        );
        allRows.push(...result.rows);
        cursor = result.nextCursor;
        if (allRows.length >= 25_000 && cursor)
          throw new Error(
            "This export exceeds 25,000 sales. Select a shorter date range.",
          );
      } while (cursor);
      if (!allRows.length) {
        setMessage("No matching sales in this page. Load the next page if available.");
        return;
      }
      const exportRows = salesCsvRows(allRows);
      const sum = (key: keyof SalesReportRow) => allRows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
      exportRows.push({
        sale_number: "FILTER TOTAL", item_count: sum("itemCount"), total_quantity: sum("totalQuantity"),
        product_subtotal_naira: (sum("subtotalAmountMinor") / 100).toFixed(2),
        discount_naira: (sum("discountAmountMinor") / 100).toFixed(2),
        net_amount_naira: (sum("netAmountMinor") / 100).toFixed(2),
        vat_naira: (sum("vatAmountMinor") / 100).toFixed(2),
        invoice_total_naira: (sum("grossAmountMinor") / 100).toFixed(2),
        amount_paid_naira: (sum("amountPaidMinor") / 100).toFixed(2),
        credit_issued_naira: (sum("creditAmountMinor") / 100).toFixed(2),
      });
      downloadCsv(
        `${creditOnly ? "credit-sales" : "sales-register"}-${fromDate || "all"}-to-${toDate || "current"}.csv`,
        Object.keys(exportRows[0]!),
        exportRows,
      );
      setMessage(
        `${allRows.length} posted sale${allRows.length === 1 ? "" : "s"} downloaded.`,
      );
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "The sales report could not be downloaded.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function openSaleDocument(saleId: string) {
    setLoading(true);
    setMessage(null);
    try {
      setSaleDocument(
        await callAdministration<{ saleId: string }, SaleDocument>(
          "getSaleDocument",
          { saleId },
        ),
      );
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "The official invoice and receipt could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }

  if (!canReadInventory && !canReadSales && !canReadFinancial)
    return (
      <div className="rounded-xl border bg-white p-8">
        You do not have permission to view reports.
      </div>
    );

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-3xl font-semibold">
          Reports &amp; sales documents
        </h1>
        <p className="text-[var(--muted)]">
          Reports update when you change filters. Download server-scoped results
          or reprint official invoices and receipts when needed.
        </p>
      </header>
      <div className="flex gap-2 rounded-xl border bg-white p-2">
        {canReadSales && (
          <Button
            variant={activeFamily === "sales" ? "primary" : "ghost"}
            onClick={() => setFamily("sales")}
          >
            Sales register
          </Button>
        )}
        {canReadFinancial && (
          <Button
            variant={activeFamily === "financial" ? "primary" : "ghost"}
            onClick={() => setFamily("financial")}
          >
            Financial statements
          </Button>
        )}
        {canReadInventory && (
          <Button
            variant={activeFamily === "inventory" ? "primary" : "ghost"}
            onClick={() => setFamily("inventory")}
          >
            Inventory reports
          </Button>
        )}
      </div>

      {activeFamily === "financial" && canReadFinancial ? (
        <FinancialStatements />
      ) : activeFamily === "sales" && canReadSales ? (
        <>
          <section className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-2 lg:grid-cols-6">
            <ReportPeriodPicker value={period} onChange={value => { setPeriod(value); if (value !== "custom") { const range = reportDateRange(value); setFromDate(range.fromDate); setToDate(range.toDate); } }} />
            <label className="text-sm font-medium">Sales record<select value={creditOnly ? "credit" : "all"} onChange={event => setCreditOnly(event.target.value === "credit")} className="mt-1 w-full rounded-lg border p-2.5"><option value="all">All sales summary</option><option value="credit">Credit sales summary</option></select></label>
            <label className="text-sm font-medium">
              Branch
              <select
                value={branchId}
                onChange={(event) => setBranchId(event.target.value)}
                className="mt-1 w-full rounded-lg border p-2.5"
              >
                <option value="">All permitted branches</option>
                {branches.data.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              From date
              <input
                type="date"
                value={fromDate}
                onChange={(event) => { setPeriod("custom"); setFromDate(event.target.value); }}
                className="mt-1 w-full rounded-lg border p-2.5"
              />
            </label>
            <label className="text-sm font-medium">
              To date
              <input
                type="date"
                value={toDate}
                onChange={(event) => { setPeriod("custom"); setToDate(event.target.value); }}
                className="mt-1 w-full rounded-lg border p-2.5"
              />
            </label>
            <Button
              className="self-end"
              variant="secondary"
              disabled={loading || !salesReady || Boolean(fromDate && toDate && fromDate > toDate)}
              onClick={() => void downloadCompleteSalesCsv()}
            >
              <Download className="mr-2 size-4" /> Download CSV
            </Button>
          </section>
          {!salesReady && !message && <p role="status" className="flex items-center gap-2 text-sm text-[var(--muted)]"><Loader2 className="size-4 animate-spin" /> Updating sales report…</p>}
          {salesReady && salesSummary && <section aria-label="Filtered sales totals" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Sales", salesSummary.count.toLocaleString("en-NG")],
              ["Net sales", formatNaira(salesSummary.netAmountMinor)],
              ["Discounts", formatNaira(salesSummary.discountAmountMinor)],
              ["VAT", formatNaira(salesSummary.vatAmountMinor)],
              ["Invoice total", formatNaira(salesSummary.grossAmountMinor)],
              ["Paid", formatNaira(salesSummary.amountPaidMinor)],
              ["Credit issued at sale", formatNaira(salesSummary.creditAmountMinor)],
            ].map(([label, value]) => <div key={label} className="rounded-xl border bg-white p-3 text-sm"><span className="text-[var(--muted)]">{label}</span><strong className={`mt-1 block text-lg tabular-nums ${label === "Paid" || label === "Net sales" || label === "Invoice total" ? "finance-income" : label === "Credit issued at sale" ? "finance-attention" : label === "Discounts" ? "finance-outflow" : "finance-balance"}`}>{value}</strong></div>)}
          </section>}
          <p className="text-xs text-[var(--muted)]">{creditOnly ? "Credit sales include fully and partly unpaid invoices at the time of sale. " : ""}Totals cover the full selected range. Credit issued is the original amount at sale; customer statements show later repayments and returns.</p>
          <div className="responsive-table-wrap">
            <table className="responsive-table text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2">Sale / receipt</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Branch</th>
                  <th className="px-3 py-2">Customer</th>
                  <th className="px-3 py-2 text-right">Net</th>
                  <th className="px-3 py-2 text-right">Discount</th>
                  <th className="px-3 py-2 text-right">VAT</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-right">Credit at sale</th>
                  <th className="px-3 py-2">Document</th>
                </tr>
              </thead>
              <tbody>
                {salesPagination.rows.map((row) => (
                  <tr key={row.id} className="border-t">
                    <td data-label="Sale / receipt" className="px-3 py-2">
                      <strong>{row.saleNumber}</strong>
                      <span className="block font-mono text-[var(--muted)]">
                        {row.receiptNumber}
                      </span>
                    </td>
                    <td data-label="Date" className="px-3 py-2">
                      {new Date(row.recordedAt).toLocaleString("en-NG")}
                    </td>
                    <td data-label="Branch" className="px-3 py-2">
                      {row.branchName}
                    </td>
                    <td data-label="Customer" className="px-3 py-2">
                      {row.customerName}
                    </td>
                    <td data-label="Net" className="px-3 py-2 text-right">
                      {formatNaira(row.netAmountMinor)}
                    </td>
                    <td data-label="Discount" className="px-3 py-2 text-right">
                      {formatNaira(row.discountAmountMinor)}
                    </td>
                    <td data-label="VAT" className="px-3 py-2 text-right">
                      {formatNaira(row.vatAmountMinor)}
                    </td>
                    <td
                      data-label="Total"
                      className="px-3 py-2 text-right font-semibold"
                    >
                      {formatNaira(row.grossAmountMinor)}
                    </td>
                    <td
                      data-label="Credit at sale"
                      className="px-3 py-2 text-right"
                    >
                      <span className={row.creditAmountMinor > 0 ? "finance-attention font-semibold" : "finance-neutral"}>{formatNaira(row.creditAmountMinor)}</span>
                    </td>
                    <td data-label="Document" className="px-3 py-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={loading}
                        onClick={() => void openSaleDocument(row.id)}
                      >
                        <FileText className="mr-1 size-4" /> View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {salesReady && salesRows.length > 0 && (
            <PaginatedTableControls
              pagination={salesPagination}
              total={salesRows.length}
              itemLabel="sales"
            />
          )}
          {salesReady && salesCursor && (
            <Button
              variant="secondary"
              disabled={loading}
              onClick={() => void loadSalesNext()}
            >
              Load next page
            </Button>
          )}
        </>
      ) : canReadInventory ? (
        <>
          <section className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-3">
            <label className="text-sm font-medium">Report
              <select value={kind} onChange={(event) => setKind(event.target.value as InventoryReportKey)} className="mt-1 w-full rounded-lg border p-2.5">
                {Object.entries(inventoryReports).map(([key, [label]]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium">Product
              <select value={productId} onChange={(event) => setProductId(event.target.value)} className="mt-1 w-full rounded-lg border p-2.5">
                <option value="">All products</option>
                {products.data.map((product) => <option key={product.id} value={product.id}>{product.sku} — {product.name}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium">Stock location
              <select value={locationId} onChange={(event) => setLocationId(event.target.value)} className="mt-1 w-full rounded-lg border p-2.5">
                <option value="">All locations</option>
                {locations.data.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
              </select>
            </label>
          </section>
          {!inventoryReady && !message && <p role="status" className="flex items-center gap-2 text-sm text-[var(--muted)]"><Loader2 className="size-4 animate-spin" /> Updating inventory report…</p>}
          {inventoryReady && inventorySummary && <section aria-label="Filtered inventory totals" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              ["Positions", inventorySummary.count.toLocaleString("en-NG")],
              ["On hand", inventorySummary.onHandQuantity.toLocaleString("en-NG")],
              ["Reserved", inventorySummary.reservedQuantity.toLocaleString("en-NG")],
              ["Available", inventorySummary.availableQuantity.toLocaleString("en-NG")],
              ...(inventorySummary.valueMinor !== undefined ? [["Stock value", formatNaira(inventorySummary.valueMinor)]] : []),
            ].map(([label, value]) => <div key={label} className="rounded-xl border bg-white p-3 text-sm"><span className="text-[var(--muted)]">{label}</span><strong className="mt-1 block text-lg">{value}</strong></div>)}
          </section>}
          <p className="text-sm text-[var(--muted)]">
            Product, branch, warehouse and stock-area references are shown as
            business names. Technical IDs are shortened only when no business
            number exists.
          </p>
          {canExportInventory && inventoryDisplayRows.length > 0 && (
            <Button
              variant="secondary"
              onClick={() => {
                const rows = readableInventoryCsvRows(inventoryDisplayRows);
                downloadCsv(
                  `${kind}-report.csv`,
                  Object.keys(rows[0] ?? {}),
                  rows,
                );
              }}
            >
              <Download className="mr-2 size-4" /> Download loaded rows
            </Button>
          )}
          <div className="responsive-table-wrap">
            <table className="responsive-table text-xs">
              <thead className="bg-slate-50">
                <tr>
                  {inventoryColumns.map((column) => (
                    <th key={column} className="px-3 py-2 font-semibold">
                      {inventoryReportColumnLabel(column)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {inventoryPagination.rows.map(({ display, productId: rowProductId, rowId }, index) => {
                  const rowKey = `${inventoryQueryKey}-${rowId}`;
                  const expanded = expandedInventoryRow === rowKey;
                  return <Fragment key={rowKey}>
                  <tr className="border-t">
                    {inventoryColumns.map((column) => (
                      <td
                        key={column}
                        data-label={inventoryReportColumnLabel(column)}
                        data-primary={column === "product" ? "true" : undefined}
                        className="max-w-72 px-3 py-2"
                      >
                        {column === "product" && rowProductId ? (
                          <button
                            type="button"
                            aria-expanded={expanded}
                            aria-controls={`product-preview-${rowId}`}
                            onClick={() => setExpandedInventoryRow(expanded ? null : rowKey)}
                            className="inline-flex items-center gap-1.5 text-left font-medium text-[var(--brand)] underline underline-offset-2 hover:text-[var(--brand-dark)]"
                          >
                            {formatInventoryReportValue(column, display[column])}
                            <ChevronDown className={`size-4 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
                          </button>
                        ) : formatInventoryReportValue(column, display[column])}
                      </td>
                    ))}
                  </tr>
                  {expanded && rowProductId && <tr id={`product-preview-${rowId}`}><td colSpan={inventoryColumns.length} className="p-2 sm:p-3">
                    <ProductHistoryPreview productId={rowProductId} productName={String(display.product ?? "Product")} locations={inventoryLookups.locations} reportRow={inventoryRows[(inventoryPagination.page - 1) * inventoryPagination.pageSize + index] ?? {}} />
                  </td></tr>}
                  </Fragment>;
                })}
              </tbody>
            </table>
          </div>
          {inventoryDisplayRows.length > 0 && (
            <PaginatedTableControls
              pagination={inventoryPagination}
              total={inventoryDisplayRows.length}
              itemLabel="inventory report rows"
            />
          )}
          {inventoryReady && inventoryCursor && (
            <Button
              variant="secondary"
              disabled={loading}
              onClick={() => void loadInventoryNext()}
            >
              Load next page
            </Button>
          )}
        </>
      ) : null}
      {message && (
        <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm">
          {message}
        </p>
      )}
      {saleDocument && (
        <SaleDocumentDialog
          document={saleDocument}
          onClose={() => setSaleDocument(null)}
        />
      )}
    </div>
  );
}
