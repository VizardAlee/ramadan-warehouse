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
import {
  auditActionTitle,
  auditEntityLabel,
  auditRecordReference,
  auditRoleLabel,
  auditTimestamp,
} from "@/features/audit/presentation";
import { useAuth } from "@/features/auth/auth-context";
import { formatDateTime } from "@/features/inventory/format";
import { hasPermission } from "@/lib/permissions/roles";
import type { AuditLog, UserProfile } from "@/types/domain";

export function AuditList() {
  const { profile } = useAuth();
  const logs = useOrganizationCollection<AuditLog>("auditLogs");
  const users = useOrganizationCollection<UserProfile>(
    "users",
    Boolean(profile && hasPermission(profile, "user.manage")),
  );
  const actorNames = useMemo(
    () => Object.fromEntries(users.data.flatMap((user) => [
      [user.uid, user.displayName || user.email],
      [user.id, user.displayName || user.email],
    ])),
    [users.data],
  );
  const [search, setSearch] = useState("");
  const filteredRows = useMemo(
    () =>
      logs.data
        .filter(
          (log) =>
            !search ||
            `${auditActionTitle(log.action)} ${auditEntityLabel(log.entityType)} ${auditRecordReference(log) ?? ""} ${actorNames[log.actorUserId] ?? ""} ${auditRoleLabel(log.actorRoleId)} ${log.reason ?? ""} ${log.action} ${log.entityId} ${log.actorUserId}`
              .toLowerCase()
              .includes(search.toLowerCase()),
        )
        .sort((a, b) => auditTimestamp(b.createdAt) - auditTimestamp(a.createdAt)),
    [actorNames, logs.data, search],
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
        description="See who did what and when. Open technical details only when you need the exact audit evidence."
      />
      <label className="surface block p-4">
        <span className="sr-only">Search audit history</span>
        <input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            pagination.setPage(1);
          }}
          placeholder="Search an action, person, record, or reference"
          className="w-full rounded-lg border px-3"
        />
      </label>
      {logs.error ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">Audit history could not be loaded. Refresh the page or ask an administrator to check your access.</p>
      ) : logs.loading ? (
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
                <th>What happened</th>
                <th>Record</th>
                <th>Done by</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {pagination.rows.map((log) => (
                <tr key={log.id}>
                  <td data-label="What happened" data-primary="true">
                    <strong>{auditActionTitle(log.action)}</strong>
                    {log.reason && (
                      <span className="block text-xs text-[var(--muted)]">
                        Reason: {log.reason}
                      </span>
                    )}
                    <details className="mt-2 text-xs text-[var(--muted)]">
                      <summary className="cursor-pointer font-medium text-[var(--brand)]">Technical details</summary>
                      <div className="mt-2 space-y-1 rounded-lg border bg-slate-50 p-3">
                        <p>Action code: <code>{log.action}</code></p>
                        <p>Record ID: <code className="break-all">{log.entityId}</code></p>
                        <p>Actor ID: <code className="break-all">{log.actorUserId}</code></p>
                        <p>Source: <code>{log.sourceFunction}</code></p>
                        {log.correlationId && <p>Trace ID: <code className="break-all">{log.correlationId}</code></p>}
                        {log.before && <div><p className="font-semibold">Before</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(log.before, null, 2)}</pre></div>}
                        {log.after && <div><p className="font-semibold">After</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(log.after, null, 2)}</pre></div>}
                      </div>
                    </details>
                  </td>
                  <td data-label="Record">
                    <span>{auditEntityLabel(log.entityType)}</span>
                    {auditRecordReference(log) && <span className="block text-xs text-[var(--muted)]">{auditRecordReference(log)}</span>}
                  </td>
                  <td data-label="Done by">
                    <span>{actorNames[log.actorUserId] ?? (profile?.uid === log.actorUserId ? profile.displayName : null) ?? `${auditRoleLabel(log.actorRoleId)} account`}</span>
                    {actorNames[log.actorUserId] && <span className="block text-xs text-[var(--muted)]">{auditRoleLabel(log.actorRoleId)}</span>}
                  </td>
                  <td data-label="When">{formatDateTime(log.createdAt)}</td>
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
