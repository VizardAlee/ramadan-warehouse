"use client";

import { Download, Loader2, Plus, Truck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { callAdministration } from "@/features/administration/api";
import { useAuth } from "@/features/auth/auth-context";
import { hasPermission } from "@/lib/permissions/roles";
import type { WarehouseTransfer } from "@/types/domain";

const queueStatus: Record<string, string> = {
  review: "submitted",
  reservations: "approved",
  picking: "picking",
  packing: "packing",
  dispatch: "ready_for_dispatch",
  "in-transit": "dispatched",
  incoming: "dispatched",
  discrepancies: "disputed",
  closed: "closed",
};
const labels: Record<string, string> = {
  review: "Review queue",
  reservations: "Reservation queue",
  picking: "Picking queue",
  packing: "Packing queue",
  dispatch: "Dispatch queue",
  "in-transit": "Goods in transit",
  incoming: "Incoming branch transfers",
  discrepancies: "Transfer discrepancies",
  costs: "Transfer costs",
  "cost-approvals": "Cost approvals",
  "cost-reconciliation": "Cost reconciliation",
  closed: "Closed transfers",
};
const csv = (value: unknown) =>
  `"${String(value ?? "").replaceAll('"', '""')}"`;
export function TransferList({ view = "all" }: { view?: string }) {
  const { profile } = useAuth();
  const [rows, setRows] = useState<WarehouseTransfer[]>([]);
  const [status, setStatus] = useState(queueStatus[view] ?? "");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  async function load(more = false) {
    setLoading(true);
    setMessage(null);
    try {
      const result = await callAdministration<
        object,
        { rows: WarehouseTransfer[]; nextCursor: string | null }
      >("listTransfers", {
        status: status || undefined,
        cursor: more ? cursor : undefined,
        limit: 50,
      });
      setRows((current) => (more ? [...current, ...result.rows] : result.rows));
      setCursor(result.nextCursor);
    } catch {
      setMessage("Transfers could not be loaded for your current assignment.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let active = true;
    void callAdministration<
      object,
      { rows: WarehouseTransfer[]; nextCursor: string | null }
    >("listTransfers", {
      status: queueStatus[view] || undefined,
      limit: 50,
    })
      .then((value) => {
        if (active) {
          setRows(value.rows);
          setCursor(value.nextCursor);
        }
      })
      .catch(() => {
        if (active)
          setMessage(
            "Transfers could not be loaded for your current assignment.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [view]);
  if (
    !profile ||
    ![
      "transfers.read.all",
      "transfers.read.assigned_warehouse",
      "transfers.read.own_branch",
    ].some((permission) =>
      hasPermission(profile, permission as Parameters<typeof hasPermission>[1]),
    )
  )
    return (
      <div className="rounded-xl border bg-white p-8">
        You do not have permission to view transfers.
      </div>
    );
  function exportCsv() {
    const columns: (keyof WarehouseTransfer)[] = [
      "transferNumber",
      "sourceType",
      "sourceRequestId",
      "originWarehouseId",
      "destinationBranchId",
      "status",
      "priority",
      "totalPlannedQuantity",
      "totalDispatchedQuantity",
      "totalReceivedQuantity",
      "totalOutstandingQuantity",
    ];
    const value = [
      columns.join(","),
      ...rows.map((row) => columns.map((column) => csv(row[column])).join(",")),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([value], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "transfer-register.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">
            {labels[view] ?? "Warehouse transfers"}
          </h1>
          <p className="text-[var(--muted)]">
            Auditable reservation, dispatch, transit, receipt, discrepancy, and
            cost control.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {["system_administrator", "operations_administrator", "auditor"].includes(profile.roleId) && (
            <Link className="inline-flex min-h-10 items-center rounded-lg border bg-white px-4 text-sm font-semibold" href="/transfers/reconciliation">Reconciliation</Link>
          )}
          {hasPermission(profile, "reports.transfers.export") &&
            rows.length > 0 && (
              <Button variant="secondary" onClick={exportCsv}>
                <Download className="mr-2 size-4" />
                Export loaded rows
              </Button>
            )}
          {hasPermission(profile, "transfers.create.from_request") && (
            <Link
              className="inline-flex min-h-10 items-center rounded-lg border bg-white px-4 text-sm font-semibold"
              href="/transfers/create/from-request"
            >
              <Plus className="mr-2 size-4" />
              From request
            </Link>
          )}
          {hasPermission(profile, "transfers.create.direct") && (
            <Link
              className="inline-flex min-h-10 items-center rounded-lg bg-[var(--brand)] px-4 text-sm font-semibold text-white"
              href="/transfers/create/direct"
            >
              <Plus className="mr-2 size-4" />
              Direct transfer
            </Link>
          )}
        </div>
      </header>
      <nav aria-label="Transfer queues" className="scroll-tabs pb-1">
        {Object.entries(labels).map(([key, label]) => (
          <Link
            key={key}
            href={`/transfers/${key}`}
            className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-lg border px-3 text-sm ${view === key ? "bg-emerald-950 text-white" : "bg-white"}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      <section className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-[1fr_auto]">
        <select
          className="rounded-lg border p-2.5"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">All statuses</option>
          {[
            "draft",
            "submitted",
            "under_review",
            "approved",
            "partially_reserved",
            "reserved",
            "picking",
            "packing",
            "ready_for_dispatch",
            "partially_dispatched",
            "dispatched",
            "partially_received",
            "received",
            "disputed",
            "cost_reconciliation",
            "closed",
            "cancelled",
          ].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <Button onClick={() => load(false)} disabled={loading}>
          {loading && <Loader2 className="mr-2 size-4 animate-spin" />}Apply
        </Button>
      </section>
      {message && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm">{message}</p>
      )}
      <div className="responsive-table-wrap">
        <table className="responsive-table">
          <thead className="bg-slate-50">
            <tr>
              {[
                "Transfer",
                "Source",
                "Route",
                "Priority",
                "Status",
                "Approved",
                "Dispatched",
                "Received",
                "Outstanding",
              ].map((label) => (
                <th key={label} className="px-4 py-3">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t">
                <td data-label="Transfer" data-primary="true" className="px-4 py-3">
                  <Link
                    href={`/transfers/${row.id}`}
                    className="font-semibold text-[var(--brand)] underline"
                  >
                    {row.transferNumber}
                  </Link>
                </td>
                <td data-label="Source" className="px-4 py-3">
                  {row.sourceType.replaceAll("_", " ")}
                </td>
                <td data-label="Route" className="px-4 py-3">
                  <span className="block">{row.originWarehouseId}</span>
                  <span className="text-xs text-[var(--muted)]">
                    to {row.destinationBranchId}
                  </span>
                </td>
                <td data-label="Priority" className="px-4 py-3 capitalize">{row.priority}</td>
                <td data-label="Status" className="px-4 py-3">
                  <StatusBadge
                    tone={
                      row.status === "closed" || row.status === "received"
                        ? "success"
                        : row.status === "disputed"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {row.status.replaceAll("_", " ")}
                  </StatusBadge>
                </td>
                <td data-label="Approved" className="px-4 py-3">{row.totalApprovedQuantity}</td>
                <td data-label="Dispatched" className="px-4 py-3">{row.totalDispatchedQuantity}</td>
                <td data-label="Received" className="px-4 py-3">{row.totalReceivedQuantity}</td>
                <td data-label="Outstanding" className="px-4 py-3 font-semibold">{row.totalOutstandingQuantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && rows.length === 0 && (
          <div className="grid place-items-center p-12 text-center text-[var(--muted)]">
            <Truck className="mb-3 size-9" />
            <p>No transfers match this queue.</p>
          </div>
        )}
      </div>
      {cursor && (
        <Button
          variant="secondary"
          disabled={loading}
          onClick={() => load(true)}
        >
          Load more
        </Button>
      )}
    </div>
  );
}
