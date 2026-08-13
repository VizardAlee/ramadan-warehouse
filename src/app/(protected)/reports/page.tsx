"use client";

import { Download, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { useOrganizationCollection } from "@/features/administration/use-organization-collection";
import { useAuth } from "@/features/auth/auth-context";
import { hasPermission } from "@/lib/permissions/roles";
import type { InventoryLocation, Product } from "@/types/domain";

const reports = {
  stock: ["Stock position", "generateStockPositionReport"],
  movement: ["SKU movements", "generateSkuMovementReport"],
  valuation: ["Inventory valuation", "generateInventoryValuationReport"],
  serial: ["Serial numbers", "generateSerialNumberReport"],
  adjustment: ["Stock adjustments", "generateStockAdjustmentReport"],
  count: ["Stock-count variance", "generateStockCountVarianceReport"],
} as const;
type ReportKey = keyof typeof reports;
interface ReportResult {
  rows: Record<string, unknown>[];
  nextCursor: string | null;
  includeCosts: boolean;
}

function csvCell(value: unknown) {
  const text =
    value === null || value === undefined
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export default function ReportsPage() {
  const { profile } = useAuth();
  const products = useOrganizationCollection<Product>("products");
  const locations =
    useOrganizationCollection<InventoryLocation>("inventoryLocations");
  const [kind, setKind] = useState<ReportKey>("stock");
  const [productId, setProductId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const canRead = profile
    ? hasPermission(profile, "reports.inventory.read")
    : false;
  const canExport = profile
    ? hasPermission(profile, "reports.inventory.export")
    : false;
  const includeCosts = profile
    ? hasPermission(profile, "inventory.cost.read")
    : false;
  const columns = useMemo(
    () => [...new Set(rows.flatMap((row) => Object.keys(row)))],
    [rows],
  );

  async function load(next = false) {
    setLoading(true);
    setMessage(null);
    try {
      const result = await callAdministration<object, ReportResult>(
        reports[kind][1],
        {
          productId: productId || undefined,
          locationId: locationId || undefined,
          cursor: next ? cursor : undefined,
          limit: 50,
          includeCosts,
        },
      );
      setRows((current) => (next ? [...current, ...result.rows] : result.rows));
      setCursor(result.nextCursor);
      if (!result.rows.length) setMessage("No rows matched this report page.");
    } catch {
      setMessage("The report query was rejected or requires an index.");
    } finally {
      setLoading(false);
    }
  }

  function exportCsv() {
    const content = [
      columns.map(csvCell).join(","),
      ...rows.map((row) => columns.map((key) => csvCell(row[key])).join(",")),
    ].join("\n");
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${kind}-report.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (!canRead)
    return (
      <div className="rounded-xl border bg-white p-8">
        You do not have permission to view inventory reports.
      </div>
    );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">Inventory reports</h1>
          <p className="text-[var(--muted)]">
            Server-scoped, paginated operational and valuation views.
          </p>
        </div>
        {canExport && rows.length > 0 && (
          <Button variant="secondary" onClick={exportCsv}>
            <Download className="mr-2 size-4" /> Export loaded rows
          </Button>
        )}
      </div>
      <section className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-4">
        <select
          value={kind}
          onChange={(event) => {
            setKind(event.target.value as ReportKey);
            setRows([]);
            setCursor(null);
          }}
          className="rounded-lg border p-2.5"
        >
          {Object.entries(reports).map(([key, [label]]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={productId}
          onChange={(event) => setProductId(event.target.value)}
          className="rounded-lg border p-2.5"
        >
          <option value="">All products</option>
          {products.data.map((product) => (
            <option key={product.id} value={product.id}>
              {product.sku} — {product.name}
            </option>
          ))}
        </select>
        <select
          value={locationId}
          onChange={(event) => setLocationId(event.target.value)}
          className="rounded-lg border p-2.5"
        >
          <option value="">All locations</option>
          {locations.data.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>
        <Button disabled={loading} onClick={() => load(false)}>
          {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
          Run report
        </Button>
      </section>
      {message && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm">{message}</p>
      )}
      <div className="responsive-table-wrap">
        <table className="responsive-table text-xs">
          <thead className="bg-slate-50">
            <tr>
              {columns.map((column) => (
                <th key={column} className="px-3 py-2 font-semibold">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={String(row.id ?? index)} className="border-t">
                {columns.map((column) => (
                  <td key={column} data-label={column.replaceAll("_", " ")} className="max-w-72 truncate px-3 py-2">
                    {typeof row[column] === "object"
                      ? JSON.stringify(row[column])
                      : String(row[column] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cursor && (
        <Button
          variant="secondary"
          disabled={loading}
          onClick={() => load(true)}
        >
          Load next page
        </Button>
      )}
    </div>
  );
}
