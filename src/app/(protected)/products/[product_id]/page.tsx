"use client";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import {
  formatDateTime,
  formatNaira,
  formatQuantity,
} from "@/features/inventory/format";
import type {
  InventoryBalance,
  InventoryEntry,
  InventoryLot,
  Product,
  SerializedItem,
} from "@/types/domain";
interface Summary {
  product: Product;
  totals: {
    onHand: number;
    reserved: number;
    available: number;
    valueMinor: number;
  };
  balances: InventoryBalance[];
  serializedItems: SerializedItem[];
  lots: InventoryLot[];
  includeCosts: boolean;
}
export default function ProductDetailPage() {
  const { product_id: productId } = useParams<{ product_id: string }>();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [history, setHistory] = useState<InventoryEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function loadHistory(next?: string) {
    const result = await callAdministration<
      object,
      { rows: InventoryEntry[]; nextCursor: string | null }
    >("getSkuMovementHistory", {
      productId,
      cursor: next,
      limit: 25,
      includeCosts: true,
    });
    setHistory((current) =>
      next ? [...current, ...result.rows] : result.rows,
    );
    setCursor(result.nextCursor);
  }
  useEffect(() => {
    Promise.all([
      callAdministration<object, Summary>("getProductStockSummary", {
        productId,
        limit: 100,
        includeCosts: true,
      }),
      callAdministration<
        object,
        { rows: InventoryEntry[]; nextCursor: string | null }
      >("getSkuMovementHistory", {
        productId,
        limit: 25,
        includeCosts: true,
      }),
    ])
      .then(([result, movement]) => {
        setSummary(result);
        setHistory(movement.rows);
        setCursor(movement.nextCursor);
      })
      .catch(() => setError("Unable to load SKU history."));
  }, [productId]);
  if (error)
    return <p className="rounded-lg bg-red-50 p-4 text-red-800">{error}</p>;
  if (!summary)
    return <p className="p-8 text-center">Loading product history…</p>;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">{summary.product.name}</h1>
        <p className="font-mono text-[var(--muted)]">
          {summary.product.sku} · {summary.product.trackingType} ·{" "}
          {summary.product.unitOfMeasure}
        </p>
      </div>
      <section className="grid gap-4 md:grid-cols-4">
        {[
          ["On hand", formatQuantity(summary.totals.onHand)],
          ["Available", formatQuantity(summary.totals.available)],
          ["Reserved", formatQuantity(summary.totals.reserved)],
          [
            "Inventory value",
            summary.includeCosts
              ? formatNaira(summary.totals.valueMinor)
              : "Restricted",
          ],
        ].map(([label, value]) => (
          <article key={label} className="rounded-xl border bg-white p-5">
            <p className="text-xs uppercase text-[var(--muted)]">{label}</p>
            <p className="mt-2 text-2xl font-semibold">{value}</p>
          </article>
        ))}
      </section>
      <section className="rounded-xl border bg-white p-5">
        <h2 className="text-lg font-semibold">Stock by location</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                {[
                  "Location",
                  "On hand",
                  "Reserved",
                  "Available",
                  "Average cost",
                  "Value",
                ].map((item) => (
                  <th key={item} className="py-2">
                    {item}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summary.balances.map((balance) => (
                <tr key={balance.id} className="border-t">
                  <td className="py-2 font-mono text-xs">
                    {balance.locationId}
                  </td>
                  <td>{balance.onHandQuantity}</td>
                  <td>{balance.reservedQuantity}</td>
                  <td>{balance.availableQuantity}</td>
                  <td>{formatNaira(balance.averageUnitCostMinor)}</td>
                  <td>{formatNaira(balance.totalValueMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="rounded-xl border bg-white p-5">
        <h2 className="text-lg font-semibold">Movement history</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr>
                {[
                  "Date",
                  "Transaction",
                  "Type",
                  "Location",
                  "Quantity",
                  "Unit cost",
                  "Value",
                  "Balance after",
                  "Reason",
                ].map((item) => (
                  <th key={item} className="py-2 pr-4">
                    {item}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.map((entry) => (
                <tr key={entry.id} className="border-t">
                  <td className="py-2 pr-4">
                    {formatDateTime(entry.effectiveAt)}
                  </td>
                  <td className="pr-4 font-mono">{entry.transactionNumber}</td>
                  <td className="pr-4">{entry.transactionType}</td>
                  <td className="pr-4">
                    {entry.locationId ?? entry.externalAccount}
                  </td>
                  <td className="pr-4">{entry.quantityDelta}</td>
                  <td className="pr-4">{formatNaira(entry.unitCostMinor)}</td>
                  <td className="pr-4">{formatNaira(entry.valueDeltaMinor)}</td>
                  <td className="pr-4">{entry.balanceAfter}</td>
                  <td>{entry.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {cursor && (
          <Button
            className="mt-4"
            variant="secondary"
            onClick={() => loadHistory(cursor)}
          >
            Load more
          </Button>
        )}
      </section>
      {summary.product.trackingType === "serial" && (
        <section className="rounded-xl border bg-white p-5">
          <h2 className="text-lg font-semibold">Serialized assets</h2>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {summary.serializedItems.map((item) => (
              <div key={item.id} className="rounded-lg border p-3 text-sm">
                <strong className="font-mono">{item.serialNumber}</strong>
                <span className="block text-xs text-[var(--muted)]">
                  {item.status} · {item.currentLocationId} ·{" "}
                  {formatNaira(item.currentUnitCostMinor)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
      {summary.product.trackingType === "batch" && (
        <section className="rounded-xl border bg-white p-5">
          <h2 className="text-lg font-semibold">Lots</h2>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {summary.lots.map((lot) => (
              <div key={lot.id} className="rounded-lg border p-3 text-sm">
                <strong>{lot.lotNumber}</strong>
                <span className="block text-xs text-[var(--muted)]">
                  Remaining {lot.remainingQuantity} ·{" "}
                  {formatNaira(lot.unitCostMinor)} · expiry{" "}
                  {lot.expiryDate ?? "not set"}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
