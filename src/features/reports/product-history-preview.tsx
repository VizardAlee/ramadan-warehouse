"use client";

import Link from "next/link";
import { ArrowRight, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { callAdministration } from "@/features/administration/api";
import { formatDateTime, formatQuantity } from "@/features/inventory/format";
import { summarizeInventoryMovements } from "@/features/inventory/movement-presentation";
import type { InventoryEntry } from "@/types/domain";

interface Props {
  productId: string;
  locationIds?: readonly string[];
  productName: string;
  locations: Readonly<Record<string, string>>;
  reportRow: Record<string, unknown>;
}

function movementInstant(value: InventoryEntry["effectiveAt"]): readonly [number, number] {
  if (typeof value === "string") {
    const milliseconds = Date.parse(value);
    const seconds = Math.floor(milliseconds / 1000);
    return Number.isFinite(milliseconds) ? [seconds, (milliseconds - seconds * 1000) * 1_000_000] : [-Infinity, 0];
  }
  return Number.isFinite(value?.seconds) ? [value.seconds, value.nanoseconds ?? 0] : [-Infinity, 0];
}

export function ProductHistoryPreview(props: Props) {
  return <HistoryPreview key={JSON.stringify([props.productId, props.locationIds ? [...props.locationIds].sort() : "all"])} {...props} />;
}

function HistoryPreview({ productId, productName, locations, reportRow, locationIds }: Props) {
  const locationKey = locationIds ? JSON.stringify([...locationIds].sort()) : "all";
  const [entries, setEntries] = useState<InventoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    async function load() {
      const scopes: (string | undefined)[] = locationKey === "all" ? [undefined] : JSON.parse(locationKey) as string[];
      const rows: InventoryEntry[] = [];
      for (const locationId of scopes) {
        const result = await callAdministration<object, { rows: InventoryEntry[] }>("getSkuMovementHistory", {
          productId, locationId, limit: 30, includeCosts: false,
        });
        if (!active) return;
        rows.push(...result.rows.filter((row) => !locationId || row.locationId === locationId));
      }
      if (active) setEntries(rows);
    }
    void load().catch(() => {
      if (active) setError(true);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [productId, locationKey]);
  const events = useMemo(
    () => {
      const chronological = [...entries].sort((left, right) => {
        const [leftSeconds, leftNanoseconds] = movementInstant(left.effectiveAt);
        const [rightSeconds, rightNanoseconds] = movementInstant(right.effectiveAt);
        if (leftSeconds !== rightSeconds) return leftSeconds > rightSeconds ? -1 : 1;
        if (leftNanoseconds !== rightNanoseconds) return rightNanoseconds - leftNanoseconds;
        return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
      });
      // Group every matching line before limiting events so movements spanning
      // areas retain both their source and destination.
      return summarizeInventoryMovements(chronological, locations).slice(0, 5);
    },
    [entries, locations],
  );
  return (
    <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{productName}</h3>
          <p className="text-sm text-[var(--muted)]">Recent stock activity, with each transaction shown once.</p>
        </div>
        <Link href={`/products/${encodeURIComponent(productId)}#movement-history`} prefetch={false} className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-[var(--brand)] underline underline-offset-2">
          Full product history <ArrowRight className="size-4" />
        </Link>
      </div>
      {typeof reportRow.onHandQuantity === "number" && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg bg-white p-3 text-sm">
          <span>On hand <strong>{formatQuantity(reportRow.onHandQuantity)}</strong></span>
          {typeof reportRow.reservedQuantity === "number" && <span>Reserved <strong>{formatQuantity(reportRow.reservedQuantity)}</strong></span>}
          {typeof reportRow.availableQuantity === "number" && <span>Available to sell <strong>{formatQuantity(reportRow.availableQuantity)}</strong></span>}
        </div>
      )}
      {loading ? <p role="status" className="flex items-center gap-2 text-sm text-[var(--muted)]"><Loader2 className="size-4 animate-spin" /> Loading recent activity…</p>
        : error ? <p role="alert" className="text-sm text-red-700">Recent activity could not be loaded. You can still open the full product history.</p>
        : events.length ? <ol className="space-y-2">
          {events.map((event) => <li key={event.id} className="flex flex-wrap justify-between gap-x-4 gap-y-1 rounded-lg border bg-white p-3 text-sm">
            <div><strong>{event.title}</strong><p className="text-[var(--muted)]">{event.description}</p></div>
            <span className="text-xs text-[var(--muted)]">{formatDateTime(event.date)}</span>
          </li>)}
        </ol> : <p className="text-sm text-[var(--muted)]">No stock movements recorded yet.</p>}
    </div>
  );
}
