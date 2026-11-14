import { describe, expect, it } from 'vitest';
import { collectExportPages, csvCell, listCsv, listPrintHtml } from '../src/features/exports/list-export';

describe('complete safe list exports', () => {
  it('quotes commas/newlines and neutralizes spreadsheet formulas including leading whitespace', () => {
    expect(csvCell('  =SUM(A1)')).toBe('"\'  =SUM(A1)"');
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
    expect(csvCell('@formula')).toBe('"\'@formula"');
  });
  it('includes scope/filter/snapshot metadata and all rows', () => {
    const data = {title:'Stock',scope:'Civic Center',filters:'fan',rows:[{Product:'Fan',Quantity:3},{Product:'Fan 2',Quantity:5}]};
    const csv=listCsv(data,'2026-11-14T12:00:00Z');
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('Civic Center'); expect(csv).toContain('Fan 2');
    const html=listPrintHtml(data,'now');
    expect(html).toContain('2 records'); expect(html).toContain('Save as PDF');
  });
  it('escapes HTML instead of executing catalogue text', () => {
    const html=listPrintHtml({title:'<script>',scope:'A&B',filters:'all',rows:[{Product:'<img src=x onerror=alert(1)>'}]},'now');
    expect(html).not.toContain('<script>'); expect(html).not.toContain('<img'); expect(html).toContain('&lt;img');
  });
  it('collects every page, not just the loaded UI page', async () => {
    const cursors:(string|undefined)[]=[];
    const rows=await collectExportPages(async cursor=>{cursors.push(cursor); return cursor ? {rows:[3,4],nextCursor:null}:{rows:[1,2],nextCursor:'next'};},()=>true);
    expect(rows).toEqual([1,2,3,4]); expect(cursors).toEqual([undefined,'next']);
  });
  it('rejects non-advancing pagination without returning partial data', async () => {
    await expect(collectExportPages(async()=>({rows:[1],nextCursor:'same'}),()=>true)).rejects.toThrow('No partial file');
  });
  it('cancels after authority/view changes while fetching', async () => {
    let active=true;
    await expect(collectExportPages(async()=>{active=false;return {rows:[1],nextCursor:null};},()=>active)).rejects.toThrow('cancelled');
  });
});
