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
  productName: string;
  locations: Readonly<Record<string, string>>;
  reportRow: Record<string, unknown>;
}

export function ProductHistoryPreview({ productId, productName, locations, reportRow }: Props) {
  const [entries, setEntries] = useState<InventoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    callAdministration<object, { rows: InventoryEntry[] }>("generateSkuMovementReport", {
      productId,
      limit: 30,
      includeCosts: false,
    }).then((result) => {
      if (active) setEntries(result.rows);
    }).catch(() => {
      if (active) setError(true);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [productId]);
  const events = useMemo(
    () => summarizeInventoryMovements(entries, locations).slice(0, 5),
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
