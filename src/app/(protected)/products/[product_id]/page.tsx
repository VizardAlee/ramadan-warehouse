"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CursorTablePagination } from "@/components/ui/table-pagination";
import { callAdministration } from "@/features/administration/api";
import { useOrganizationCollection } from "@/features/administration/use-organization-collection";
import { useAuth } from "@/features/auth/auth-context";
import {
  formatDateTime,
  formatNaira,
  formatQuantity,
} from "@/features/inventory/format";
import { inventoryLocationLabel, summarizeInventoryMovements } from "@/features/inventory/movement-presentation";
import { hasPermission } from "@/lib/permissions/roles";
import type {
  InventoryBalance,
  InventoryEntry,
  InventoryLot,
  InventoryLocation,
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
  const { profile } = useAuth();
  const locations = useOrganizationCollection<InventoryLocation>("inventoryLocations");
  const { product_id: productId } = useParams<{ product_id: string }>();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [history, setHistory] = useState<InventoryEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [pageStarts, setPageStarts] = useState<(string | null)[]>([null]);
  const [pageSize, setPageSize] = useState(25);
  const [error, setError] = useState<string | null>(null);
  const locationNames = Object.fromEntries(locations.data.map((location) => [location.id, location.name]));
  const events = summarizeInventoryMovements(history, locationNames);
  async function loadHistory(startCursor: string | null = null, size = pageSize) {
    const result = await callAdministration<
      object,
      { rows: InventoryEntry[]; nextCursor: string | null }
    >("getSkuMovementHistory", {
      productId,
      cursor: startCursor || undefined,
      limit: size,
      includeCosts: true,
    });
    setHistory(result.rows);
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
        limit: pageSize,
        includeCosts: true,
      }),
    ])
      .then(([result, movement]) => {
        setSummary(result);
        setHistory(movement.rows);
        setCursor(movement.nextCursor);
      })
      .catch(() => setError("Unable to load SKU history."));
  }, [pageSize, productId]);
  useEffect(() => {
    if (summary && window.location.hash === "#movement-history")
      document.getElementById("movement-history")?.scrollIntoView({ block: "start" });
  }, [summary]);
  function nextHistoryPage() {
    if (!cursor) return;
    setPageStarts((current) => [...current, cursor]);
    void loadHistory(cursor);
  }
  function previousHistoryPage() {
    if (pageStarts.length <= 1) return;
    const previousStarts = pageStarts.slice(0, -1);
    setPageStarts(previousStarts);
    void loadHistory(previousStarts.at(-1) ?? null);
  }
  if (error)
    return <p className="rounded-lg bg-red-50 p-4 text-red-800">{error}</p>;
  if (!summary)
    return <p className="p-8 text-center">Loading product history…</p>;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">{summary.product.name}</h1>
          <p className="font-mono text-[var(--muted)]">
            {summary.product.sku} · {summary.product.trackingType} ·{" "}
            {summary.product.unitOfMeasure}
          </p>
        </div>
        {profile && hasPermission(profile, "inventory.opening_stock") && (
          <Link
            href={`/inventory/opening-stock?productId=${encodeURIComponent(summary.product.id)}`}
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--brand)] px-4 text-sm font-semibold text-white hover:bg-[var(--brand-dark)]"
          >
            Add initial stock
          </Link>
        )}
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
        <p className="mt-1 text-sm text-[var(--muted)]">On hand is physically in the store. Reserved is set aside for a customer; available can still be sold.</p>
        <div className="responsive-table-wrap mt-4">
          <table className="responsive-table">
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
                  <td data-label="Location" data-primary="true" className="py-2 font-medium">
                    {locationNames[balance.locationId] ?? "Stock location"}
                  </td>
                  <td data-label="On hand">{balance.onHandQuantity}</td>
                  <td data-label="Reserved">{balance.reservedQuantity}</td>
                  <td data-label="Available" className="font-semibold">{balance.availableQuantity}</td>
                  <td data-label="Average cost">{formatNaira(balance.averageUnitCostMinor)}</td>
                  <td data-label="Value">{formatNaira(balance.totalValueMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section id="movement-history" className="scroll-mt-24 rounded-xl border bg-white p-5">
        <h2 className="text-lg font-semibold">What happened to this product</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">Each sale, receipt or transfer appears once here. The audit ledger below retains its balancing entries.</p>
        {events.length ? <ol className="mt-4 space-y-3">
          {events.map((event) => <li key={event.id} className="rounded-xl border p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><h3 className="font-semibold">{event.title}</h3><p className="mt-1 text-sm">{event.description}</p></div>
              <span className="text-xs text-[var(--muted)]">{formatDateTime(event.date)}</span>
            </div>
            <p className="mt-2 text-xs text-[var(--muted)]">Reference {event.reference}{event.balanceAfter !== undefined ? ` · ${event.location} balance afterward: ${formatQuantity(event.balanceAfter)}` : ""}</p>
          </li>)}
        </ol> : <p className="mt-4 text-sm text-[var(--muted)]">No stock movements recorded yet.</p>}
        <details className="mt-5 rounded-xl border p-3">
          <summary className="cursor-pointer font-medium">Show detailed audit ledger ({history.length} entries on this page)</summary>
          <p className="mt-2 text-xs text-[var(--muted)]">A transaction may have a store entry and an opposite external entry. Only the store entry changes physical stock. Unit cost is inventory cost, not the customer selling price.</p>
        <div className="responsive-table-wrap mt-4">
          <table className="responsive-table text-xs">
            <thead>
              <tr>
                {[
                  "Date",
                  "Transaction",
                  "Entry",
                  "Change",
                  "Unit cost",
                  "Value",
                  "Store balance after",
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
                  <td data-label="Date" data-primary="true" className="py-2 pr-4">
                    {formatDateTime(entry.effectiveAt)}
                  </td>
                  <td data-label="Transaction" className="pr-4 font-mono">{entry.transactionNumber}</td>
                  <td data-label="Entry" className="pr-4">{inventoryLocationLabel(entry, locationNames)}{!entry.locationId ? " (balancing entry)" : ""}</td>
                  <td data-label="Change" className="pr-4">{entry.quantityDelta > 0 ? "+" : ""}{formatQuantity(entry.quantityDelta)}</td>
                  <td data-label="Unit cost" className="pr-4">{formatNaira(entry.unitCostMinor)}</td>
                  <td data-label="Value" className="pr-4">{formatNaira(entry.valueDeltaMinor)}</td>
                  <td data-label="Store balance after" className="pr-4">{entry.locationId ? formatQuantity(entry.balanceAfter) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </details>
        <CursorTablePagination
          page={pageStarts.length}
          pageSize={pageSize}
          rowCount={history.length}
          hasNextPage={Boolean(cursor)}
          onPrevious={previousHistoryPage}
          onNext={nextHistoryPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPageStarts([null]);
          }}
          itemLabel="ledger entries"
        />
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
