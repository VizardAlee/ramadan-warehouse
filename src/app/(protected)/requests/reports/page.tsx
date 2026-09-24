"use client";
import { Download, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  PaginatedTableControls,
  useTablePagination,
} from "@/components/ui/table-pagination";
import { callAdministration } from "@/features/administration/api";
import { useAuth } from "@/features/auth/auth-context";
import { hasPermission } from "@/lib/permissions/roles";
const reportTypes = [
  "register",
  "items",
  "pending",
  "approval_performance",
  "approved_unfulfilled",
  "product_demand",
] as const;
const csvCell = (value: unknown) =>
  `"${String(value ?? "").replaceAll('"', '""')}"`;
export default function RequestReportsPage() {
  const { profile } = useAuth();
  const [reportType, setReportType] =
    useState<(typeof reportTypes)[number]>("register");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const allowed = Boolean(profile && hasPermission(profile, "reports.requests.read"));
  const queryKey = JSON.stringify([reportType, status, priority]);
  const ready = loadedKey === queryKey;
  const visibleRows = useMemo(() => ready ? rows : [], [ready, rows]);
  const pagination = useTablePagination(visibleRows);
  const setPage = pagination.setPage;
  const columns = useMemo(
    () => [
      ...new Set(
        visibleRows
          .flatMap((row) => Object.keys(row))
          .filter((key) => rowValue(visibleRows, key)),
      ),
    ],
    [visibleRows],
  );
  useEffect(() => {
    if (!allowed) return;
    const version = ++requestVersion.current;
    const timer = window.setTimeout(() => {
      void (async () => {
        setLoading(true);
        setMessage(null);
        setPage(1);
        try {
          const result = await callAdministration<object, { rows: Record<string, unknown>[] }>("generateBranchRequestReport", {
            reportType,
            status: status || undefined,
            priority: priority || undefined,
            limit: 100,
          });
          if (version !== requestVersion.current) return;
          setRows(result.rows);
          setLoadedKey(queryKey);
          if (!result.rows.length) setMessage("No rows matched the selected report.");
        } catch {
          if (version === requestVersion.current) setMessage("The report could not be generated for this scope.");
        } finally {
          if (version === requestVersion.current) setLoading(false);
        }
      })();
    }, 250);
    return () => {
      window.clearTimeout(timer);
      requestVersion.current += 1;
    };
  }, [allowed, priority, queryKey, reportType, setPage, status]);
  function exportCsv() {
    const body = [
      columns.map(csvCell).join(","),
      ...visibleRows.map((row) =>
        columns.map((column) => csvCell(row[column])).join(","),
      ),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([body], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${reportType}-requests.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  if (!allowed)
    return (
      <div className="rounded-xl border bg-white p-8">
        You do not have permission to view request reports.
      </div>
    );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">Request reports</h1>
          <p className="text-[var(--muted)]">
            Organization- and branch-scoped demand and approval views update
            when you change filters.
          </p>
        </div>
        {profile && hasPermission(profile, "reports.requests.export") &&
          ready && visibleRows.length > 0 && (
            <Button variant="secondary" disabled={loading} onClick={exportCsv}>
              <Download className="mr-2 size-4" />
              Export loaded rows
            </Button>
          )}
      </div>
      <section className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-3">
        <label className="text-sm font-medium">Report
        <select
          className="mt-1 w-full rounded-lg border p-2.5"
          value={reportType}
          onChange={(event) =>
            setReportType(event.target.value as (typeof reportTypes)[number])
          }
        >
          {reportTypes.map((type) => (
            <option key={type} value={type}>{type.replaceAll("_", " ")}</option>
          ))}
        </select>
        </label>
        <label className="text-sm font-medium">Status
        <select
          className="mt-1 w-full rounded-lg border p-2.5"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">All statuses</option>
          {[
            "draft",
            "submitted",
            "under_review",
            "changes_requested",
            "approved",
            "partially_approved",
            "rejected",
            "cancelled",
            "closed",
          ].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        </label>
        <label className="text-sm font-medium">Priority
        <select
          className="mt-1 w-full rounded-lg border p-2.5"
          value={priority}
          onChange={(event) => setPriority(event.target.value)}
        >
          <option value="">All priorities</option>
          {["low", "normal", "high", "urgent", "critical"].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        </label>
      </section>
      {!ready && !message && <p role="status" className="flex items-center gap-2 text-sm text-[var(--muted)]"><Loader2 className="size-4 animate-spin" /> Updating request report…</p>}
      {message && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm">{message}</p>
      )}
      <div className="responsive-table-wrap">
        <table className="responsive-table text-xs">
          <thead className="bg-slate-50">
            <tr>
              {columns.map((column) => (
                <th key={column} className="px-3 py-2">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pagination.rows.map((row, index) => (
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
      {ready && visibleRows.length > 0 && (
        <PaginatedTableControls
          pagination={pagination}
          total={visibleRows.length}
          itemLabel="report rows"
        />
      )}
    </div>
  );
}
function rowValue(rows: Record<string, unknown>[], key: string) {
  return rows.some((row) => row[key] !== undefined);
}
