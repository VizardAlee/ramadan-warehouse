"use client";
import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/ui/status-badge";
import { callAdministration } from "@/features/administration/api";
import { formatDateTime, formatNaira } from "@/features/inventory/format";
import type { SerializedItem } from "@/types/domain";
export default function AssetsPage() {
  const [rows, setRows] = useState<SerializedItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    callAdministration<object, { rows: SerializedItem[] }>(
      "generateSerialNumberReport",
      { limit: 100, includeCosts: true },
    )
      .then((result) => setRows(result.rows))
      .catch(() => setError("Unable to load serialized inventory."));
  }, []);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-semibold">
          Serialized inventory and lots
        </h1>
        <p className="text-[var(--muted)]">
          Current serialized lifecycle. Product detail pages expose their lot
          positions.
        </p>
      </div>
      {error && (
        <p className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>
      )}
      <div className="responsive-table-wrap">
        <table className="responsive-table">
          <thead>
            <tr>
              {[
                "SKU",
                "Serial",
                "Status",
                "Location",
                "Cost",
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
                <td colSpan={6} className="p-8 text-center">
                  No serialized items.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-t">
                  <td data-label="SKU" data-primary="true" className="px-4 py-3 font-mono">{row.sku}</td>
                  <td data-label="Serial / lot" className="px-4 font-mono">{row.serialNumber}</td>
                  <td data-label="Status" className="px-4"><StatusBadge status={row.status}/></td>
                  <td data-label="Location" className="px-4 record-id">{row.currentLocationId}</td>
                  <td data-label="Cost" className="px-4">
                    {formatNaira(row.currentUnitCostMinor)}
                  </td>
                  <td data-label="Last movement" className="px-4">{formatDateTime(row.lastMovementAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
