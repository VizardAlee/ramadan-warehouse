"use client";
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useFinancialPrivacy } from '@/features/finance/financial-privacy';
import { listCsv, listPrintHtml, type ListExport } from './list-export';

export function ListExportActions({ scopeKey, disabled, load }: { scopeKey:string; disabled:boolean; load:(active:()=>boolean)=>Promise<ListExport> }) {
  const [busy,setBusy] = useState(false), [error,setError] = useState('');
  const current = useRef(scopeKey), mounted = useRef(true);
  const privacy = useFinancialPrivacy();
  useEffect(() => { current.current = scopeKey; }, [scopeKey]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function exportList(kind:'csv'|'pdf') {
    if (disabled || busy || !privacy.ready) return;
    if (privacy.hidden && !window.confirm('This export contains actual authorized prices and financial values, even while amounts are hidden on screen. Continue?')) return;
    const key = scopeKey;
    const active = () => mounted.current && current.current === key;
    // Open synchronously to avoid popup blocking after asynchronous pagination.
    const preview = kind === 'pdf' ? window.open('', '_blank') : null;
    if (kind === 'pdf' && !preview) { setError('Allow this app to open the PDF print preview, then retry.'); return; }
    if (preview) { preview.opener = null; preview.document.body.textContent = 'Preparing the full filtered list…'; }
    setBusy(true); setError('');
    try {
      const data = await load(active);
      if (!active()) throw new Error('Export cancelled because the view or account changed.');
      if (!data.rows.length) throw new Error('There are no matching records to export.');
      const now = new Date().toISOString();
      if (preview) {
        preview.document.open(); preview.document.write(listPrintHtml(data,now)); preview.document.close();
        preview.focus(); preview.print();
      } else {
        const url = URL.createObjectURL(new Blob([listCsv(data,now)],{type:'text/csv;charset=utf-8'}));
        const anchor = document.createElement('a'); anchor.href=url; anchor.download=`${data.title.toLowerCase().replace(/[^a-z0-9]+/g,'-')}-${now.slice(0,10)}.csv`;
        anchor.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
      }
    } catch(cause) { preview?.close(); if (mounted.current) setError(cause instanceof Error ? cause.message : 'Export failed. No partial file was saved.'); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <div className="space-y-1"><div className="flex flex-wrap gap-2">
    <Button disabled={disabled || busy || !privacy.ready} onClick={()=>void exportList('csv')}>Download CSV</Button>
    <Button variant="secondary" disabled={disabled || busy || !privacy.ready} onClick={()=>void exportList('pdf')}>PDF / Print</Button>
    </div><p className="text-xs text-[var(--muted)]" role="status">{busy ? 'Preparing all matching records…' : 'Full filtered list • actual authorized values • PDF: choose Save as PDF'}</p>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}</div>;
}
