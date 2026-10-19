"use client";

import { FileClock } from "lucide-react";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { RecordSkeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { useAuth } from "@/features/auth/auth-context";
import { FinancialDetails, FinancialMessage, FinancialText } from "@/features/finance/financial-privacy";
import { formatDateTime } from "@/features/inventory/format";
import { auditActionTitle, auditEntityLabel, auditRoleLabel } from "./presentation";
import { canReadAudit } from "./access";
import type { ActivityPage } from "./activity-types";

function today() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
export function AuditList() {
  const { profile } = useAuth();
  if (!canReadAudit(profile)) return <EmptyState icon={FileClock} title="Audit access restricted" description="Only authorized administrators and auditors can review the immutable operational history." />;
  // A changed account or authority remounts the reader and discards its pages before rendering.
  return <AuthorizedAuditList key={JSON.stringify([profile!.uid, profile!.organizationId, profile!.authorizationVersion, profile!.roleId, profile!.roleIds, profile!.effectivePermissions])} />;
}
function AuthorizedAuditList() {
  const [draft, setDraft] = useState(() => ({ fromDate: `${today().slice(0, 7)}-01`, toDate: today(), actorUserId: "", action: "", module: "", entityType: "", reference: "" }));
  const [filters, setFilters] = useState(draft), [pageSize, setPageSize] = useState(25);
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [refresh, setRefresh] = useState(0);
  const cursor = cursors.at(-1), key = JSON.stringify([filters, pageSize, cursor, refresh]);
  const [response, setResponse] = useState<{ key: string; data?: ActivityPage; error?: string }>();
  const data = response?.key === key ? response.data : undefined, error = response?.key === key ? response.error : undefined;
  useEffect(() => {
    let active = true;
    void callAdministration<object, ActivityPage>("getUserActivity", { ...filters, pageSize, cursor })
      .then(value => { if (active) setResponse({ key, data: value }); })
      .catch(cause => { if (active) setResponse({ key, error: cause instanceof Error ? cause.message : "Audit history could not be loaded." }); });
    return () => { active = false; };
  }, [filters, pageSize, cursor, key]);
  return <div className="page-stack">
    <PageHeader title="Audit history" description="Filter recorded activity by user, period and business action. Dates use Lagos time." />
    <form className="surface grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4" onSubmit={event => { event.preventDefault(); setFilters({ ...draft }); setCursors([undefined]); setRefresh(value => value + 1); }}>
      {([
        ["fromDate", "From date", "date"], ["toDate", "Through date", "date"], ["actorUserId", "Actor user ID", "text"],
        ["action", "Action code (exact)", "text"], ["module", "Module code (exact)", "text"], ["entityType", "Record type (exact)", "text"], ["reference", "Business reference contains", "text"],
      ] as const).map(([field, label, type]) => <label className="text-sm" key={field}>{label}<input type={type} required={type === "date"} maxLength={field === "actorUserId" ? 128 : 160} value={draft[field]} onChange={event => setDraft({ ...draft, [field]: event.target.value })} className="mt-1 w-full rounded-lg border px-3" /></label>)}
      <div className="flex items-end"><Button type="submit">Apply filters / refresh</Button></div>
      <p className="text-xs text-[var(--muted)] sm:col-span-2 lg:col-span-4">Choose up to 366 days. Copy a user ID from an event to review that user. Module examples: sale, sales_order, inventory, purchase_order, user. Filters apply when submitted.</p>
    </form>
    <p className="text-sm text-[var(--muted)]">Recorded events only; this is not a record of every click or read. A current name is not historical identity evidence. Legacy names, locations and unrecorded assignees may be unknown.</p>
    {error ? <p role="alert"><FinancialMessage>{error}</FinancialMessage></p> : !data ? <RecordSkeleton /> : <>
      <p role="status" className="text-sm">Scanned {data.scanned} events on this page. {data.scanLimited ? "Scan limit reached. Continue scanning for more matches or narrow the period / actor." : data.nextCursor ? "More events may match on subsequent pages." : "End of this search."}</p>
      {data.rows.length === 0 ? <EmptyState icon={FileClock} title={data.nextCursor ? "No matches in this scan" : "No audit records match"} description={data.nextCursor ? "Continue to scan older events; this page does not establish that there is no matching history." : "Only recorded events within the selected period are included."} /> : <div className="responsive-table-wrap"><table className="responsive-table table-fixed [overflow-wrap:anywhere]"><thead><tr><th>What happened</th><th>Record</th><th>Done by</th><th>When</th></tr></thead><tbody>
        {data.rows.map(log => <tr key={log.id}>
          <td data-label="What happened" data-primary="true"><strong><FinancialText>{auditActionTitle(log.action)}</FinancialText></strong>{log.reason && <span className="block text-xs text-[var(--muted)]">Reason: <FinancialDetails>{log.reason}</FinancialDetails></span>}
            <details className="mt-2 text-xs text-[var(--muted)]"><summary className="cursor-pointer font-medium text-[var(--brand)]">Technical details</summary><div className="mt-2 space-y-1 rounded-lg border p-3">
              <p>Action code: <code><FinancialText>{log.action}</FinancialText></code></p><p>Module: <FinancialText>{log.module}</FinancialText></p>
              <p>Record ID: <code className="break-all"><FinancialText>{log.entityId}</FinancialText></code></p><p>Actor ID: <code className="break-all"><FinancialText>{log.actorUserId}</FinancialText></code></p>
              <p>Source: <code><FinancialText>{log.sourceFunction}</FinancialText></code></p>{log.correlationId && <p>Trace ID: <code className="break-all"><FinancialText>{log.correlationId}</FinancialText></code></p>}
              <p>Recorded location evidence: <FinancialText>{log.location ? Object.entries(log.location).map(([name, value]) => `${name}: ${value}`).join(" · ") : "Unknown (legacy or not recorded)"}</FinancialText></p>
            </div></details>
          </td>
          <td data-label="Record"><FinancialText>{auditEntityLabel(log.entityType)}</FinancialText>{log.reference && <span className="block text-xs"><FinancialText>{log.reference}</FinancialText></span>}</td>
          <td data-label="Done by"><span className="break-all"><FinancialText>{log.actorName ?? (log.actorUserId || "Unknown actor")}</FinancialText></span><span className="block text-xs text-[var(--muted)]">{log.actorNameEvidence === "recorded_snapshot" ? "Name recorded with event" : log.actorNameEvidence === "current_name" ? "Current name · historical name not recorded" : "UID only · name unavailable"}</span><span className="block text-xs"><FinancialText>{auditRoleLabel(log.actorRoleId)}</FinancialText></span></td>
          <td data-label="When"><FinancialText>{log.createdAt ? formatDateTime(log.createdAt) : "Time not recorded"}</FinancialText></td>
        </tr>)}
      </tbody></table></div>}
      <nav aria-label="Audit scan pages" className="surface flex flex-wrap items-center justify-between gap-3 p-3 text-sm"><label>Rows per page<select className="ml-2 rounded-lg border px-2" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setCursors([undefined]); }}>{[25, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}</select></label><span>Scan page {cursors.length} · {data.rows.length} matches</span><div className="flex gap-2"><Button variant="secondary" disabled={cursors.length <= 1} onClick={() => setCursors(value => value.slice(0, -1))}>Previous</Button><Button variant="secondary" disabled={!data.nextCursor} onClick={() => { if (data.nextCursor) setCursors(value => [...value, data.nextCursor!]); }}>{data.scanLimited ? "Continue scanning" : "Next"}</Button></div></nav>
    </>}
  </div>;
}
