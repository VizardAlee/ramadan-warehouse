"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { downloadCsv } from "@/features/inventory/format";

interface HistoryRow { id: string; staffId: string; employeeName: string; kind: string; occurredAt: string | null; occurredOn: string | null; source: string | null; reason: string | null; summary: string | null }
interface HistoryPage { rows: HistoryRow[]; nextCursorId: string | null }
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const time = (row: HistoryRow) => row.occurredAt ? new Date(row.occurredAt).toLocaleString("en-NG", { timeZone: "Africa/Lagos" }) : row.occurredOn;

export function HrHistory() {
  const [kind, setKind] = useState<"attendance" | "activity">("attendance");
  const [fromDate, setFrom] = useState(() => `${today().slice(0, 7)}-01`), [toDate, setTo] = useState(today);
  const [limit, setLimit] = useState(25), [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [page, setPage] = useState<HistoryPage | null>(null), [busy, setBusy] = useState(false), [exporting, setExporting] = useState(false), [error, setError] = useState("");
  const sequence = useRef(0), cursorId = cursors.at(-1), valid = !!fromDate && !!toDate && fromDate <= toDate;
  const load = useCallback(async () => {
    const current = ++sequence.current; setPage(null); setError("");
    if (!valid) { setError("Choose a valid date range."); setBusy(false); return; }
    setBusy(true);
    try { const result = await callAdministration<object, HistoryPage>("getHrHistory", { kind, fromDate, toDate, limit, cursorId }); if (current === sequence.current) setPage(result); }
    catch (cause) { if (current === sequence.current) setError(cause instanceof Error ? cause.message : "History could not be loaded."); }
    finally { if (current === sequence.current) setBusy(false); }
  }, [kind, fromDate, toDate, limit, cursorId, valid]);
  const invalidate = useCallback(() => { sequence.current++; }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 150); return () => { window.clearTimeout(timer); invalidate(); }; }, [load, invalidate]);
  async function exportAll() {
    setExporting(true); setError("");
    try {
      const rows: HistoryRow[] = [], seen = new Set<string>(); let cursor: string | undefined;
      do {
        const result = await callAdministration<object, HistoryPage>("getHrHistory", { kind, fromDate, toDate, limit: 100, cursorId: cursor });
        for (const row of result.rows) { if (seen.has(row.id)) throw new Error("History changed during export. Refresh and retry."); seen.add(row.id); rows.push(row); }
        if (rows.length > 10_000 || (rows.length === 10_000 && result.nextCursorId)) throw new Error("This range exceeds 10,000 events. Choose a shorter range; no partial file was exported.");
        if (result.nextCursorId === cursor) throw new Error("History paging did not advance. Refresh and retry.");
        cursor = result.nextCursorId ?? undefined;
      } while (cursor);
      if (!rows.length) throw new Error("No events exist in this range.");
      downloadCsv(`hr-${kind}-${fromDate}-${toDate}.csv`, rows.map(row => ({ history: kind, fromDate, toDate, timezone: "Africa/Lagos", staffId: row.staffId, employee: row.employeeName, event: row.kind, nigeriaDateTime: time(row), source: row.source ?? "", detail: row.summary ?? row.reason ?? "" })));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "History export failed."); }
    finally { setExporting(false); }
  }
  return <section className="space-y-4 rounded-xl border bg-white p-5" aria-label="HR history reports">
    <h2 className="text-lg font-semibold">Attendance and staff activity history</h2>
    <p className="text-sm text-[var(--muted)]">Recorded events in Nigerian business dates. Export includes every page in the selected range. Events do not calculate worked hours, overtime or payroll.</p>
    <fieldset disabled={exporting} className="flex flex-wrap items-end gap-3">
      <label>History<select className="input block" value={kind} onChange={e => { setKind(e.target.value as typeof kind); setCursors([undefined]); }}><option value="attendance">Attendance</option><option value="activity">Staff activity</option></select></label>
      <label>From<input className="input block" type="date" value={fromDate} onChange={e => { setFrom(e.target.value); setCursors([undefined]); }}/></label>
      <label>To<input className="input block" type="date" value={toDate} onChange={e => { setTo(e.target.value); setCursors([undefined]); }}/></label>
      <label>Rows<select className="input block" value={limit} onChange={e => { setLimit(Number(e.target.value)); setCursors([undefined]); }}>{[25, 50, 100].map(size => <option key={size}>{size}</option>)}</select></label>
      <Button variant="outline" disabled={busy} onClick={() => void load()}>Refresh</Button>
      <Button disabled={!valid || busy || !page?.rows.length} onClick={() => void exportAll()}>{exporting ? "Exporting…" : "Export full range CSV"}</Button>
    </fieldset>
    {error && <p role="alert" className="text-red-800">{error}</p>}
    <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead><tr>{["Employee", "Event", "Date / time (Nigeria)", "Source", "Details"].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{page?.rows.map(row => <tr key={row.id} className="border-t"><td className="p-2">{row.employeeName}<small className="block">{row.staffId}</small></td><td className="p-2">{row.kind.replaceAll("_", " ")}</td><td className="p-2">{time(row)}</td><td className="p-2">{row.source?.replaceAll("_", " ") ?? "—"}</td><td className="p-2">{row.summary ?? row.reason ?? "—"}</td></tr>)}{!page?.rows.length && <tr><td colSpan={5} className="p-4">{busy ? "Loading history…" : error ? "History unavailable." : "No events in this range."}</td></tr>}</tbody></table></div>
    <div className="flex items-center justify-between gap-3"><Button variant="outline" disabled={busy || exporting || cursors.length < 2} onClick={() => setCursors(cursors.slice(0, -1))}>Previous</Button><span>Page {cursors.length}</span><Button variant="outline" disabled={busy || exporting || !page?.nextCursorId} onClick={() => setCursors([...cursors, page!.nextCursorId!])}>Next</Button></div>
  </section>;
}
