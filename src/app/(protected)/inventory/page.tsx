"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CursorTablePagination } from "@/components/ui/table-pagination";
import { callAdministration } from "@/features/administration/api";
import { useOrganizationCollection } from "@/features/administration/use-organization-collection";
import {
  formatDateTime,
  formatNaira,
  formatQuantity,
} from "@/features/inventory/format";
import type { InventoryBalance, InventoryLocation } from "@/types/domain";

function fetchStockPosition(cursor?: string, limit = 25) {
  return callAdministration<
    object,
    { rows: InventoryBalance[]; nextCursor: string | null }
  >("generateStockPositionReport", {
    cursor,
    limit,
    includeCosts: true,
  });
}

export default function InventoryPage() {
  const locations = useOrganizationCollection<InventoryLocation>("inventoryLocations");
  const [rows, setRows] = useState<InventoryBalance[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [pageStarts, setPageStarts] = useState<(string | null)[]>([null]);
  const [pageSize, setPageSize] = useState(25);
  const [error, setError] = useState<string | null>(null);
  async function load(startCursor: string | null = null, size = pageSize) {
    try {
      const result = await fetchStockPosition(startCursor || undefined, size);
      setRows(result.rows);
      setCursor(result.nextCursor);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to load inventory position.",
      );
    }
  }
  useEffect(() => {
    void fetchStockPosition(undefined, pageSize)
      .then((result) => {
        setRows(result.rows);
        setCursor(result.nextCursor);
      })
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Unable to load inventory position.",
        ),
      );
  }, [pageSize]);
  function nextPage() {
    if (!cursor) return;
    setPageStarts((current) => [...current, cursor]);
    void load(cursor);
  }
  function previousPage() {
    if (pageStarts.length <= 1) return;
    const previousStarts = pageStarts.slice(0, -1);
    setPageStarts(previousStarts);
    void load(previousStarts.at(-1) ?? null);
  }
  function changePageSize(size: number) {
    setPageSize(size);
    setPageStarts([null]);
  }
  const totals = rows.reduce(
    (value, row) => ({
      quantity: value.quantity + row.onHandQuantity,
      available: value.available + row.availableQuantity,
      inventoryValue: value.inventoryValue + (row.totalValueMinor ?? 0),
    }),
    { quantity: 0, available: 0, inventoryValue: 0 },
  );
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-semibold">Inventory overview</h1>
        <p className="text-[var(--muted)]">
          Fast-read balances backed by immutable entries.
        </p>
      </div>
      <section className="grid gap-4 md:grid-cols-3">
        {[
          ["On hand (this page)", formatQuantity(totals.quantity)],
          ["Available (this page)", formatQuantity(totals.available)],
          ["Value (this page)", formatNaira(totals.inventoryValue)],
        ].map(([label, value]) => (
          <article key={label} className="rounded-xl border bg-white p-5">
            <p className="text-xs uppercase text-[var(--muted)]">{label}</p>
            <p className="mt-2 text-2xl font-semibold">{value}</p>
          </article>
        ))}
      </section>
      {error && (
        <p className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>
      )}
      <div className="responsive-table-wrap">
        <table className="responsive-table">
          <thead className="bg-slate-50">
            <tr>
              {[
                "SKU",
                "Location",
                "On hand",
                "Reserved",
                "Available",
                "Average cost",
                "Value",
                "Last movement",
              ].map((item) => (
                <th key={item} className="px-4 py-3">
                  {item}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-8 text-center text-[var(--muted)]">
                  No posted stock.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-t">
                  <td data-label="SKU" data-primary="true" className="px-4 py-3 font-mono">
                    <Link href={`/products/${row.productId}#movement-history`} className="font-semibold text-[var(--brand)] underline underline-offset-2" title="Open product stock history">{row.sku}</Link>
                  </td>
                  <td data-label="Location" className="px-4 text-sm">{locations.data.find((location) => location.id === row.locationId)?.name ?? row.locationId}</td>
                  <td data-label="On hand" className="px-4">{row.onHandQuantity}</td>
                  <td data-label="Reserved" className="px-4">{row.reservedQuantity}</td>
                  <td data-label="Available" className="px-4 font-semibold">{row.availableQuantity}</td>
                  <td data-label="Average cost" className="px-4">
                    {formatNaira(row.averageUnitCostMinor)}
                  </td>
                  <td data-label="Value" className="px-4">{formatNaira(row.totalValueMinor)}</td>
                  <td data-label="Last movement" className="px-4 text-xs">
                    {formatDateTime(row.lastMovementAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <CursorTablePagination
        page={pageStarts.length}
        pageSize={pageSize}
        rowCount={rows.length}
        hasNextPage={Boolean(cursor)}
        onPrevious={previousPage}
        onNext={nextPage}
        onPageSizeChange={changePageSize}
        itemLabel="inventory positions"
      />
    </div>
  );
}
