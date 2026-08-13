"use client";

import { Download, Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { callAdministration } from "@/features/administration/api";
import { useAuth } from "@/features/auth/auth-context";
import { hasPermission } from "@/lib/permissions/roles";
import type { BranchRequest } from "@/types/domain";

interface Result {
  rows: BranchRequest[];
  nextCursor: string | null;
}
const csv = (value: unknown) =>
  `"${String(value ?? "").replaceAll('"', '""')}"`;
export function RequestList({
  initialStatus = "",
}: {
  initialStatus?: string;
}) {
  const { profile } = useAuth();
  const [status, setStatus] = useState(initialStatus);
  const [priority, setPriority] = useState("");
  const [rows, setRows] = useState<BranchRequest[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  async function load(next = false) {
    setLoading(true);
    setMessage(null);
    try {
      const result = await callAdministration<object, Result>(
        "listBranchRequests",
        {
          status: status || undefined,
          priority: priority || undefined,
          cursor: next ? cursor : undefined,
          limit: 50,
        },
      );
      setRows((current) => (next ? [...current, ...result.rows] : result.rows));
      setCursor(result.nextCursor);
    } catch {
      setMessage("Requests could not be loaded for the selected scope.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let active = true;
    void callAdministration<object, Result>("listBranchRequests", {
      status: initialStatus || undefined,
      limit: 50,
    })
      .then((result) => {
        if (active) {
          setRows(result.rows);
          setCursor(result.nextCursor);
        }
      })
      .catch(() => {
        if (active)
          setMessage("Requests could not be loaded for the selected scope.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [initialStatus]);
  const counts = useMemo(
    () =>
      Object.fromEntries(
        [
          "draft",
          "submitted",
          "under_review",
          "changes_requested",
          "approved",
          "partially_approved",
          "rejected",
          "cancelled",
        ].map((value) => [
          value,
          rows.filter((row) => row.status === value).length,
        ]),
      ),
    [rows],
  );
  function exportCsv() {
    const columns: (keyof BranchRequest)[] = [
      "requestNumber",
      "branchId",
      "requestType",
      "priority",
      "status",
      "requiredDate",
      "submittedBy",
      "reviewedBy",
      "totalRequestedQuantity",
      "totalApprovedQuantity",
      "totalRejectedQuantity",
      "totalFulfilledQuantity",
      "totalOutstandingQuantity",
    ];
    const body = [
      columns.join(","),
      ...rows.map((row) => columns.map((column) => csv(row[column])).join(",")),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([body], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "branch-request-register.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }
  if (
    !profile ||
    (!hasPermission(profile, "requests.read.all") &&
      !hasPermission(profile, "requests.read.own_branch"))
  )
    return (
      <div className="rounded-xl border bg-white p-8">
        You do not have permission to view branch requests.
      </div>
    );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">Branch requests</h1>
          <p className="text-[var(--muted)]">
            Demand, approval, and future fulfilment planning without stock
            reservation.
          </p>
        </div>
        <div className="flex gap-2">
          {hasPermission(profile, "reports.requests.export") &&
            rows.length > 0 && (
              <Button variant="secondary" onClick={exportCsv}>
                <Download className="mr-2 size-4" />
                Export loaded rows
              </Button>
            )}
          {hasPermission(profile, "requests.create") && (
            <Link
              className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[var(--brand)] px-4 text-sm font-semibold text-white"
              href="/requests/create"
            >
              <Plus className="mr-2 size-4" />
              New request
            </Link>
          )}
        </div>
      </div>
      <section className="grid gap-3 sm:grid-cols-4">
        {Object.entries(counts)
          .slice(0, 8)
          .map(([label, count]) => (
            <button
              key={label}
              onClick={() => setStatus(label)}
              className="rounded-xl border bg-white p-4 text-left"
            >
              <span className="text-2xl font-semibold">{count}</span>
              <span className="block text-xs text-[var(--muted)]">
                {label.replaceAll("_", " ")}
              </span>
            </button>
          ))}
      </section>
      <section className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-3">
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
        <Button disabled={loading} onClick={() => load(false)}>
          {loading && <Loader2 className="mr-2 size-4 animate-spin" />}Apply
          filters
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
                "Request",
                "Branch",
                "Priority",
                "Status",
                "Requested",
                "Approved",
                "Outstanding",
                "Required",
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
                <td data-label="Request" data-primary="true" className="px-4 py-3 font-medium">
                  <Link
                    className="text-[var(--brand)] underline"
                    href={`/requests/${row.id}`}
                  >
                    {row.requestNumber}
                  </Link>
                  <span className="block text-xs font-normal text-[var(--muted)]">
                    {row.requestType.replaceAll("_", " ")}
                  </span>
                </td>
                <td data-label="Branch" className="px-4 py-3 record-id">{row.branchId}</td>
                <td data-label="Priority" className="px-4 py-3 capitalize">{row.priority}</td>
                <td data-label="Status" className="px-4 py-3"><StatusBadge status={row.status}/></td>
                <td data-label="Requested" className="px-4 py-3">{row.totalRequestedQuantity}</td>
                <td data-label="Approved" className="px-4 py-3">{row.totalApprovedQuantity}</td>
                <td data-label="Outstanding" className="px-4 py-3 font-semibold">{row.totalOutstandingQuantity}</td>
                <td data-label="Required" className="px-4 py-3">
                  {typeof row.requiredDate === "string"
                    ? row.requiredDate.slice(0, 10)
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cursor && (
        <Button
          variant="secondary"
          disabled={loading}
          onClick={() => load(true)}
        >
          Load next page
        </Button>
      )}
    </div>
  );
}
