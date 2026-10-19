"use client";
import { FinancialMessage, FinancialText, FinancialValue } from "@/features/finance/financial-privacy";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CursorTablePagination } from "@/components/ui/table-pagination";
import { useAuth } from "@/features/auth/auth-context";
import { hasOrganizationWideOperatingAccess } from "@/features/auth/operating-context";
import { hasPermission } from "@/lib/permissions/roles";
import { useLocationInventory } from "@/features/inventory/use-location-inventory";
import { useOrganizationCollection } from "@/features/administration/use-organization-collection";
import {
  formatDateTime,
  formatNaira,
  formatQuantity,
} from "@/features/inventory/format";
import type { InventoryLocation } from "@/types/domain";

export default function InventoryPage() {
  const { profile, operatingContext } = useAuth();
  // Reset queries, rows and pagination together on identity/authority/location changes.
  return <InventoryPosition key={JSON.stringify([profile?.organizationId, profile?.uid, profile?.authorizationVersion, profile?.roleId, profile?.roleIds, profile?.branchIds, profile?.warehouseIds, operatingContext])} />;
}

function InventoryPosition() {
  const { profile, operatingContext } = useAuth();
  const canSelectAll = Boolean(profile && hasOrganizationWideOperatingAccess(profile));
  const canReadCosts = Boolean(profile && hasPermission(profile, "inventory.cost.read"));
  const locations = useOrganizationCollection<InventoryLocation>("inventoryLocations", true,
    operatingContext ? { field: operatingContext.type === "branch" ? "branchId" : "warehouseId", id: operatingContext.id } : undefined);
  const [pageStarts, setPageStarts] = useState<(string | null)[]>([null]);
  const [pageSize, setPageSize] = useState(25);
  const { rows, nextCursor, summary, loading, error, refresh } = useLocationInventory(locations, pageStarts.at(-1) ?? undefined, pageSize);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-3xl font-semibold">Inventory overview</h1>
        <p className="text-[var(--muted)]">
          Inventory for <FinancialText>{operatingContext ? "the selected Store/Warehouse" : canSelectAll ? "All locations" : "a selected Store/Warehouse"}</FinancialText>. Includes products with local inventory history, even at zero stock.
        </p></div>
        <Button variant="secondary" onClick={() => { setPageStarts([null]); refresh(); }}>Refresh inventory</Button>
      </div>
      <section className="grid gap-4 md:grid-cols-3">
        {[
          ["On hand", loading || error ? "—" : formatQuantity(summary?.onHandQuantity ?? 0)],
          ["Available", loading || error ? "—" : formatQuantity(summary?.availableQuantity ?? 0)],
          ["Value", loading || error || !canReadCosts ? "—" : formatNaira(summary?.valueMinor)],
        ].map(([label, value]) => (
          <article key={label} className="rounded-xl border bg-white p-5">
            <p className="text-xs uppercase text-[var(--muted)]"><FinancialText>{label}</FinancialText></p>
            <p className="mt-2 text-2xl font-semibold"><FinancialValue financial={label === "Value"}>{value}</FinancialValue></p>
          </article>
        ))}
      </section>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800"><FinancialMessage>{error}</FinancialMessage></p>
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
                  <FinancialText>{item}</FinancialText>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-8 text-center text-[var(--muted)]">
                  <FinancialText>{loading ? "Loading inventory…" : error ? "Inventory could not be loaded." : "No inventory history at this location."}</FinancialText>
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-t">
                  <td data-label="SKU" data-primary="true" className="px-4 py-3 font-mono">
                    <Link href={`/products/${row.productId}#movement-history`} className="font-semibold text-[var(--brand)] underline underline-offset-2" title="Open product stock history"><FinancialText>{row.sku}</FinancialText></Link>
                  </td>
                  <td data-label="Location" className="px-4 text-sm"><FinancialText>{locations.data.find((location) => location.id === row.locationId)?.name ?? row.locationId}</FinancialText></td>
                  <td data-label="On hand" className="px-4"><FinancialText>{row.onHandQuantity}</FinancialText></td>
                  <td data-label="Reserved" className="px-4"><FinancialText>{row.reservedQuantity}</FinancialText></td>
                  <td data-label="Available" className="px-4 font-semibold"><FinancialText>{row.availableQuantity}</FinancialText></td>
                  <td data-label="Average cost" className="px-4">
                    <FinancialValue>{formatNaira(row.averageUnitCostMinor)}</FinancialValue>
                  </td>
                  <td data-label="Value" className="px-4"><FinancialValue>{formatNaira(row.totalValueMinor)}</FinancialValue></td>
                  <td data-label="Last movement" className="px-4 text-xs">
                    <FinancialText>{formatDateTime(row.lastMovementAt)}</FinancialText>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {!loading && !error && <CursorTablePagination
        page={pageStarts.length}
        pageSize={pageSize}
        rowCount={rows.length}
        total={summary?.count}
        hasNextPage={Boolean(nextCursor)}
        loading={loading}
        onPrevious={() => setPageStarts((pages) => pages.length > 1 ? pages.slice(0, -1) : pages)}
        onNext={() => { if (nextCursor) setPageStarts((pages) => [...pages, nextCursor]); }}
        onPageSizeChange={(size) => { setPageSize(size); setPageStarts([null]); }}
        itemLabel="inventory positions"
      />}

    </div>
  );
}
