"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import {
  formatDateTime,
  formatNaira,
  formatQuantity,
} from "@/features/inventory/format";
import type { InventoryBalance } from "@/types/domain";
export default function InventoryPage() {
  const [rows, setRows] = useState<InventoryBalance[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function load(next?: string) {
    try {
      const result = await callAdministration<
        object,
        { rows: InventoryBalance[]; nextCursor: string | null }
      >("generateStockPositionReport", {
        cursor: next,
        limit: 50,
        includeCosts: true,
      });
      setRows((current) => (next ? [...current, ...result.rows] : result.rows));
      setCursor(result.nextCursor);
    } catch {
      setError("Unable to load inventory position.");
    }
  }
  useEffect(() => {
    void callAdministration<
      object,
      { rows: InventoryBalance[]; nextCursor: string | null }
    >("generateStockPositionReport", {
      limit: 50,
      includeCosts: true,
    })
      .then((result) => {
        setRows(result.rows);
        setCursor(result.nextCursor);
      })
      .catch(() => setError("Unable to load inventory position."));
  }, []);
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
          ["On hand", formatQuantity(totals.quantity)],
          ["Available", formatQuantity(totals.available)],
          ["Value", formatNaira(totals.inventoryValue)],
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
                  <td data-label="SKU" data-primary="true" className="px-4 py-3 font-mono">{row.sku}</td>
                  <td data-label="Location" className="px-4 font-mono text-xs">{row.locationId}</td>
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
      {cursor && (
        <Button variant="secondary" onClick={() => load(cursor)}>
          Load more
        </Button>
      )}
    </div>
  );
}
