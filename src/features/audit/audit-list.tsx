"use client";

import { FileClock } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { RecordSkeleton } from "@/components/ui/skeleton";
import {
  PaginatedTableControls,
  useTablePagination,
} from "@/components/ui/table-pagination";
import { useOrganizationCollection } from "@/features/administration/use-organization-collection";
import { useAuth } from "@/features/auth/auth-context";
import { formatDateTime } from "@/features/inventory/format";
import { hasPermission } from "@/lib/permissions/roles";
import type { AuditLog } from "@/types/domain";

export function AuditList() {
  const { profile } = useAuth();
  const logs = useOrganizationCollection<AuditLog>("auditLogs");
  const [search, setSearch] = useState("");
  const filteredRows = useMemo(
    () =>
      logs.data
        .filter(
          (log) =>
            !search ||
            `${log.action} ${log.entityType} ${log.entityId} ${log.actorUserId}`
              .toLowerCase()
              .includes(search.toLowerCase()),
        )
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    [logs.data, search],
  );
  const pagination = useTablePagination(filteredRows);
  if (!profile || !hasPermission(profile, "audit.read"))
    return (
      <EmptyState
        icon={FileClock}
        title="Audit access restricted"
        description="Only authorized administrators and auditors can review the immutable operational history."
      />
    );
  return (
    <div className="page-stack">
      <PageHeader
        title="Audit history"
        description="Immutable, organization-scoped evidence for sensitive operations. Search the full loaded history and choose how many records to view per page."
      />
      <label className="surface block p-4">
        <span className="sr-only">Search audit history</span>
        <input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            pagination.setPage(1);
          }}
          placeholder="Search action, entity, reference, or actor"
          className="w-full rounded-lg border px-3"
        />
      </label>
      {logs.loading ? (
        <RecordSkeleton />
      ) : filteredRows.length === 0 ? (
        <EmptyState
          icon={FileClock}
          title="No audit records match"
          description="Bootstrap and operational actions appear here as they are recorded."
        />
      ) : (
        <>
          <div className="responsive-table-wrap">
            <table className="responsive-table">
            <thead>
              <tr>
                <th>Action</th>
                <th>Entity</th>
                <th>Actor</th>
                <th>Source</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {pagination.rows.map((log) => (
                <tr key={log.id}>
                  <td data-label="Action" data-primary="true">
                    <strong>{log.action.replaceAll("_", " ")}</strong>
                    {log.reason && (
                      <span className="block text-xs text-[var(--muted)]">
                        {log.reason}
                      </span>
                    )}
                  </td>
                  <td data-label="Entity">
                    <span className="capitalize">
                      {log.entityType.replaceAll("_", " ")}
                    </span>
                    <span
                      className="record-id block text-xs text-[var(--muted)]"
                      title={log.entityId}
                    >
                      {log.entityId}
                    </span>
                  </td>
                  <td data-label="Actor">
                    <span className="record-id" title={log.actorUserId}>
                      {log.actorUserId}
                    </span>
                    <span className="block text-xs capitalize text-[var(--muted)]">
                      {log.actorRoleId.replaceAll("_", " ")}
                    </span>
                  </td>
                  <td data-label="Source">{log.sourceFunction}</td>
                  <td data-label="Date">{formatDateTime(log.createdAt)}</td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>
          <PaginatedTableControls
            pagination={pagination}
            total={filteredRows.length}
            itemLabel="audit records"
          />
        </>
      )}
    </div>
  );
}
