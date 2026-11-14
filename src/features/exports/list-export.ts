export type ExportRow = Record<string, string | number>;
export interface ListExport { title: string; scope: string; filters: string; rows: ExportRow[]; }

export function csvCell(value: unknown) {
  const raw = String(value ?? "");
  const safe = /^[\s]*[=+@-]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}
export function listCsv(data: ListExport, generatedAt: string) {
  const headers = Object.keys(data.rows[0] ?? {});
  return '\uFEFF' + [
    ['Snapshot time', 'Scope', 'Filters', ...headers].map(csvCell).join(','),
    ...data.rows.map(row => [generatedAt, data.scope, data.filters, ...headers.map(key => row[key])].map(csvCell).join(',')),
  ].join('\r\n');
}
export function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
}
export function listPrintHtml(data: ListExport, generatedAt: string) {
  const headers = Object.keys(data.rows[0] ?? {});
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(data.title)}</title><style>
  body{font:11px Arial,sans-serif;color:#142337;padding:18px}h1{font-size:22px}table{border-collapse:collapse;width:100%;table-layout:auto}th,td{border:1px solid #ccd3dc;padding:6px;text-align:left;overflow-wrap:anywhere}th{background:#edf2f8}thead{display:table-header-group}tr{break-inside:avoid}p{line-height:1.5}@page{size:A4 landscape;margin:12mm}@media print{button{display:none}body{padding:0}}</style></head><body>
  <h1>${escapeHtml(data.title)}</h1><p>Scope: ${escapeHtml(data.scope)}<br>Filters: ${escapeHtml(data.filters)}<br>Snapshot generated: ${escapeHtml(generatedAt)}<br>${data.rows.length} records. Exported values are snapshots, not live balances. Quantities in different units are not added together.</p>
  <p>Use your browser's Print menu and select Save as PDF.</p><table><thead><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${data.rows.map(row => `<tr>${headers.map(h => `<td>${escapeHtml(row[h])}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`;
}
/** Never return a silently truncated export or loop forever on a broken cursor. */
export async function collectExportPages<T>(load: (cursor?: string) => Promise<{rows:T[];nextCursor:string|null}>, active: () => boolean) {
  const rows:T[] = [], seen = new Set<string>();
  let cursor:string|undefined;
  do {
    if (!active()) throw new Error('Export cancelled because the view or account changed.');
    const page = await load(cursor);
    if (!active()) throw new Error('Export cancelled because the view or account changed.');
    rows.push(...page.rows);
    cursor = page.nextCursor ?? undefined;
    if (cursor && (seen.has(cursor) || seen.size >= 1000)) throw new Error('Unable to export the full list. Narrow the filters and retry. No partial file was saved.');
    if (cursor) seen.add(cursor);
  } while(cursor);
  return rows;
}
