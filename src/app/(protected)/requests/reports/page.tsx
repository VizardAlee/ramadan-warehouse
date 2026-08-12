"use client";
import { Download, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
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
  const columns = useMemo(
    () => [
      ...new Set(
        rows
          .flatMap((row) => Object.keys(row))
          .filter((key) => rowValue(rows, key)),
      ),
    ],
    [rows],
  );
  async function load() {
    setLoading(true);
    setMessage(null);
    try {
      const result = await callAdministration<
        object,
        { rows: Record<string, unknown>[] }
      >("generateBranchRequestReport", {
        reportType,
        status: status || undefined,
        priority: priority || undefined,
        limit: 100,
      });
      setRows(result.rows);
      if (!result.rows.length)
        setMessage("No rows matched the selected report.");
    } catch {
      setMessage("The report could not be generated for this scope.");
    } finally {
      setLoading(false);
    }
  }
  function exportCsv() {
    const body = [
      columns.map(csvCell).join(","),
      ...rows.map((row) =>
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
  if (!profile || !hasPermission(profile, "reports.requests.read"))
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
            Paginated, organization- and branch-scoped demand and approval
            views.
          </p>
        </div>
        {hasPermission(profile, "reports.requests.export") &&
          rows.length > 0 && (
            <Button variant="secondary" onClick={exportCsv}>
              <Download className="mr-2 size-4" />
              Export loaded rows
            </Button>
          )}
      </div>
      <section className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-4">
        <select
          className="rounded-lg border p-2.5"
          value={reportType}
          onChange={(event) =>
            setReportType(event.target.value as (typeof reportTypes)[number])
          }
        >
          {reportTypes.map((type) => (
            <option key={type}>{type.replaceAll("_", " ")}</option>
          ))}
        </select>
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
        <select
          className="rounded-lg border p-2.5"
          value={priority}
          onChange={(event) => setPriority(event.target.value)}
        >
          <option value="">All priorities</option>
          {["low", "normal", "high", "urgent", "critical"].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <Button disabled={loading} onClick={load}>
          {loading && <Loader2 className="mr-2 size-4 animate-spin" />}Run
          report
        </Button>
      </section>
      {message && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm">{message}</p>
      )}
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full whitespace-nowrap text-left text-xs">
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
            {rows.map((row, index) => (
              <tr key={String(row.id ?? index)} className="border-t">
                {columns.map((column) => (
                  <td key={column} className="max-w-72 truncate px-3 py-2">
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
    </div>
  );
}
function rowValue(rows: Record<string, unknown>[], key: string) {
  return rows.some((row) => row[key] !== undefined);
}
