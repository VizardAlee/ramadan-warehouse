"use client";

import { useEffect, useRef, useState } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import { CursorTablePagination } from "@/components/ui/table-pagination";
import { callAdministration } from "@/features/administration/api";
import { formatNaira } from "@/features/inventory/format";
import { OperationalPhotos } from "@/features/pos/operational-photos";

interface ReturnLine { id: string; productId: string; productName: string; quantity: number; returnedQuantity: number }
interface Receipt { id: string; receiptNumber: string; quantity: number; returnedQuantity: number; receivedAt: string }
interface ReturnRecord { id: string; returnNumber: string; creditNoteReference: string; productName: string; quantity: number; grossAmountMinor: number; payableReductionMinor: number; supplierCreditMinor: number; inventoryTransactionNumber: string; journalNumber: string; returnedAt: string; reason: string; serialized?: boolean }
interface ReturnPage { invoiceNumber: string; lines: ReturnLine[]; returns: ReturnRecord[]; nextCursor: string | null }
interface ReceiptPage { receipts: Receipt[]; nextCursor: string | null }
interface CreditLine { supplierInvoiceItemId: string; productId: string; productName: string; receiptId: string; receiptNumber: string; quantity: number; serialNumbers: string[]; idempotencyKey: string }
const date = (value: string) => value ? new Date(value).toLocaleString("en-GB", { timeZone: "Africa/Lagos" }) : "Date not recorded";
const errorText = (cause: unknown) => cause instanceof Error ? cause.message : "The request could not be completed.";

export function SupplierReturns({ invoiceId, canPost, onClose, onComplete, heldHandover }: { invoiceId: string; canPost: boolean; onClose: () => void; onComplete: () => void; heldHandover?: { id: string; remaining: number; productId: string; serialNumber?: string } }) {
  const [limit, setLimit] = useState(25), [pages, setPages] = useState<Array<string | null>>([null]);
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<{ key: string; data?: ReturnPage; error?: string }>();
  const [lineId, setLineId] = useState(""), [receiptId, setReceiptId] = useState("");
  const [receiptPages, setReceiptPages] = useState<Array<string | null>>([null]);
  const [receiptLimit, setReceiptLimit] = useState(25);
  const [receipts, setReceipts] = useState<{ key: string; data?: ReceiptPage; error?: string }>();
  const [quantity, setQuantity] = useState("1"), [serials, setSerials] = useState(heldHandover?.serialNumber ?? "");
  const [creditNote, setCreditNote] = useState(""), [reason, setReason] = useState(""), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [evidenceRecordId, setEvidenceRecordId] = useState("");
  const [creditLines, setCreditLines] = useState<CreditLine[]>([]);
  const pending = useRef<Record<string, unknown> | null>(null);
  const cursor = pages.at(-1), receiptCursor = receiptPages.at(-1);
  const key = JSON.stringify([invoiceId, limit, cursor, revision]);
  const receiptKey = JSON.stringify([invoiceId, lineId, receiptLimit, receiptCursor, revision]);
  const data = page?.key === key ? page.data : undefined;
  const receiptData = receipts?.key === receiptKey ? receipts.data : undefined;
  const line = data?.lines.find((item) => item.id === lineId);
  const receipt = receiptData?.receipts.find((item) => item.id === receiptId);
  const maximum = Math.min(5000, heldHandover?.remaining ?? 5000, line ? line.quantity - line.returnedQuantity : 0, receipt ? receipt.quantity - receipt.returnedQuantity : 0);
  const lineValid = Boolean(line && receipt) && Number.isInteger(Number(quantity)) && Number(quantity) > 0 && Number(quantity) <= maximum;
  const valid = confirmed && (creditLines.length ? !lineId : lineValid) && creditNote.trim().length >= 2 && reason.trim().length >= 5;
  function addCreditLine() {
    if (!line || !receipt || !lineValid || creditLines.length >= 10 || creditLines.some(item => item.productId === line.productId)) return;
    const serialNumbers = serials.split(/[\n,]+/).map(value => value.trim()).filter(Boolean);
    if (serialNumbers.length + creditLines.reduce((sum, item) => sum + item.serialNumbers.length, 0) > 50) {
      setError("Use at most 50 serial numbers per credit document."); return;
    }
    setCreditLines(items => [...items, { supplierInvoiceItemId: line.id, productId: line.productId, productName: line.productName,
      receiptId: receipt.id, receiptNumber: receipt.receiptNumber, quantity: Number(quantity), serialNumbers, idempotencyKey: crypto.randomUUID() }]);
    setLineId(""); setReceiptId(""); setQuantity("1"); setSerials(""); setReceiptPages([null]); setConfirmed(false); setError("");
  }
  useEffect(() => {
    let active = true;
    void callAdministration<object, ReturnPage>("getProcurementWorkspace", { view: "supplier_returns", supplierInvoiceId: invoiceId, limit, cursor: cursor || undefined })
      .then((result) => { if (active) setPage({ key, data: result }); })
      .catch((cause) => { if (active) setPage({ key, error: errorText(cause) }); });
    return () => { active = false; };
  }, [invoiceId, limit, cursor, revision, key]);
  useEffect(() => {
    if (!lineId || !canPost) return;
    let active = true;
    void callAdministration<object, ReceiptPage>("getProcurementWorkspace", { view: "supplier_return_receipts", supplierInvoiceId: invoiceId, supplierInvoiceItemId: lineId, limit: receiptLimit, cursor: receiptCursor || undefined })
      .then((result) => { if (active) setReceipts({ key: receiptKey, data: result }); })
      .catch((cause) => { if (active) setReceipts({ key: receiptKey, error: errorText(cause) }); });
    return () => { active = false; };
  }, [invoiceId, lineId, receiptLimit, receiptCursor, revision, receiptKey, canPost]);
  async function post() {
    if (!pending.current && !valid) return;
    pending.current ??= { ...(heldHandover ? { heldHandoverId: heldHandover.id } : {}), supplierInvoiceId: invoiceId,
      ...(creditLines.length ? { lines: creditLines.map(({ supplierInvoiceItemId, receiptId: originalReceipt, quantity: returned, serialNumbers, idempotencyKey }) => ({ supplierInvoiceItemId, receiptId: originalReceipt, quantity: returned, serialNumbers, idempotencyKey })) }
        : { supplierInvoiceItemId: lineId, receiptId, quantity: Number(quantity), serialNumbers: serials.split(/[\n,]+/).map(value => value.trim()).filter(Boolean) }),
      creditNoteReference: creditNote.trim(), reason: reason.trim(), returnedAt: new Date().toISOString(), idempotencyKey: crypto.randomUUID() };
    setBusy(true); setUncertain(false); setError(""); setMessage("");
    try {
      const result = await callAdministration<object, { returnNumber?: string; creditNoteReference?: string; returns?: unknown[] }>("postSupplierReturn", pending.current);
      pending.current = null; setMessage(heldHandover ? `Credit ${result.returnNumber} recorded. Supplier account and journal updated; physical stock was not issued again.` : result.returns ? `Credit note ${result.creditNoteReference} recorded for ${result.returns.length} products. All stock, supplier balances and journals updated together.` : `Return ${result.returnNumber} recorded. Stock, supplier account and journal updated together.`);
      setCreditLines([]);
      setReceiptId(""); setLineId(""); setQuantity("1"); setSerials(""); setCreditNote(""); setReason(""); setConfirmed(false); setPages([null]); setReceiptPages([null]); setRevision((value) => value + 1); onComplete();
    } catch (cause) {
      const code = (cause as { code?: string; diagnosticCode?: string })?.diagnosticCode ?? (cause as { code?: string })?.code;
      if (["functions/invalid-argument", "functions/permission-denied", "functions/unauthenticated", "functions/failed-precondition", "functions/not-found", "functions/already-exists", "ACCOUNTING_PERIOD_LOCKED", "SUPPLIER_RETURN_ACTION_REQUIRED"].includes(code ?? "")) pending.current = null;
      setUncertain(Boolean(pending.current));
      setError(errorText(cause));
    } finally { setBusy(false); }
  }
  const locked = busy || uncertain;
  return <AppDialog role="dialog" aria-modal="true" aria-label="Supplier returns and credit notes">
    <section className="app-dialog-panel max-w-4xl rounded-2xl bg-white shadow-2xl">
      {heldHandover && <p className="border-b bg-blue-50 p-5 text-sm">Credit for goods already handed to the supplier · {heldHandover.remaining} unit(s) unsettled. No second stock deduction. Original invoice prices and tax snapshots determine the credit; differing negotiated values require accounting review.</p>}
      <header className="border-b p-5"><h2 className="text-xl font-semibold">Supplier returns & credit notes</h2><p className="text-sm text-[var(--muted)]">{data?.invoiceNumber || "Loading invoice…"} · {heldHandover ? "Settle one original handover; no second stock issue." : "Add up to 10 products to one credit note. Each product uses one original receipt / batch."}</p></header>
      <div className="space-y-5 p-5">
        {(error || page?.key === key && page.error) && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error || page?.error}</p>}
        {message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-emerald-800">{message}</p>}
        {canPost && data && <fieldset disabled={locked} className="space-y-4 rounded-xl border p-4">
          <legend className="px-2 font-semibold">Record goods returned</legend>
          <p className="text-sm text-[var(--muted)]">Use this after goods have been handed back and the supplier has accepted the credit. Credit reduces this invoice’s unpaid balance first; any excess becomes supplier credit for a later invoice or a separately recorded refund. No cash refund is assumed.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm">Invoice product<select className="mt-1 w-full rounded-lg border p-3" value={lineId} onChange={(event) => { setLineId(event.target.value); setReceiptId(""); setReceiptPages([null]); }}><option value="">Choose product</option>{data.lines.filter(item => !heldHandover || item.productId === heldHandover.productId).map((item) => <option key={item.id} value={item.id} disabled={item.returnedQuantity >= item.quantity || creditLines.some(added => added.productId === item.productId)}>{item.productName} · {item.quantity - item.returnedQuantity} not returned</option>)}</select></label>
            <label className="text-sm">Original goods-received note<select className="mt-1 w-full rounded-lg border p-3" value={receiptId} onChange={(event) => setReceiptId(event.target.value)} disabled={!receiptData}><option value="">Choose original receipt</option>{receiptData?.receipts.map((item) => <option key={item.id} value={item.id} disabled={item.returnedQuantity >= item.quantity}>{item.receiptNumber} · {date(item.receivedAt)} · {item.quantity - item.returnedQuantity} remaining</option>)}</select></label>
            <label className="text-sm">Quantity returned<input className="mt-1 w-full rounded-lg border p-3" type="number" min={1} max={maximum || 1} step={1} value={quantity} onChange={(event) => setQuantity(event.target.value)} /><small className="text-[var(--muted)]">Maximum for this receipt / invoice: {maximum}</small></label>
            <label className="text-sm">Supplier credit-note reference<input className="mt-1 w-full rounded-lg border p-3" maxLength={160} value={creditNote} onChange={(event) => setCreditNote(event.target.value)} required /></label>
            <label className="text-sm">Serial numbers, if tracked<textarea readOnly={Boolean(heldHandover)} className="mt-1 w-full rounded-lg border p-3" value={serials} onChange={(event) => setSerials(event.target.value)} /><small className="text-[var(--muted)]">One per line. Tracked goods require the exact serials from this receipt.</small></label>
            <label className="text-sm">Reason for return<textarea className="mt-1 w-full rounded-lg border p-3" minLength={5} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} required /></label>
          </div>
          {!heldHandover && <div className="space-y-3">
            <Button type="button" variant="outline" disabled={!lineValid || creditLines.length >= 10} onClick={addCreditLine}>Add product to credit note</Button>
            {creditLines.length > 0 && <section aria-label="Credit note products" className="space-y-2 rounded-lg border p-3">
              <h3 className="font-semibold">Credit note products ({creditLines.length}/10)</h3>
              <p className="text-sm text-[var(--muted)]">All products post together, or none do. Add the selected product before posting. Each line retains its own stock and journal references.</p>
              {creditLines.map(item => <div key={item.idempotencyKey} className="flex flex-wrap items-center justify-between gap-2 border-t py-2 text-sm">
                <span className="min-w-0 break-words">{item.productName} × {item.quantity}<small className="block text-[var(--muted)]">{item.receiptNumber} · {item.serialNumbers.length} serials</small></span>
                <Button type="button" variant="outline" aria-label={`Remove ${item.productName}`} onClick={() => { setCreditLines(items => items.filter(added => added.idempotencyKey !== item.idempotencyKey)); setConfirmed(false); }}>Remove</Button>
              </div>)}
            </section>}
          </div>}
          {receipts?.key === receiptKey && receipts.error && <p role="alert" className="text-red-800">{receipts.error}</p>}
          {receiptData && <CursorTablePagination page={receiptPages.length} pageSize={receiptLimit} rowCount={receiptData.receipts.length} hasNextPage={Boolean(receiptData.nextCursor)} loading={locked} onPrevious={() => { setReceiptId(""); setReceiptPages((value) => value.slice(0, -1)); }} onNext={() => { if (receiptData.nextCursor) { setReceiptId(""); setReceiptPages((value) => [...value, receiptData.nextCursor]); } }} onPageSizeChange={(size) => { setReceiptId(""); setReceiptLimit(size); setReceiptPages([null]); }} itemLabel="receipts" />}
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />Goods have physically been returned and the supplier accepted this credit note.</label>
        </fieldset>}
        {uncertain && !busy && <p role="alert" className="text-amber-900">Confirmation was not received. Retry the same request to safely check its result; do not create another return.</p>}
        {canPost && <div className="flex justify-end"><Button disabled={busy || (!uncertain && !valid)} onClick={() => void post()}>{busy ? "Recording…" : uncertain ? "Retry same return" : "Post return & credit note"}</Button></div>}
        <section><h3 className="mb-3 font-semibold">Recorded returns</h3>{!data && !page?.error && <p role="status">Loading returns…</p>}{data && <><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Date / references</th><th className="p-2">Product / quantity</th><th className="p-2 text-right">Credit</th><th className="p-2">Applied to</th></tr></thead><tbody>{data.returns.map((record) => <tr key={record.id} className="border-t"><td className="p-2">{date(record.returnedAt)}<small className="block break-all">{record.returnNumber}<br />Supplier: {record.creditNoteReference}<br />Stock: {record.inventoryTransactionNumber}<br />Journal: {record.journalNumber}</small></td><td className="p-2">{record.productName} × {record.quantity}<small className="block">{record.reason}</small></td><td className="p-2 text-right finance-income">{formatNaira(record.grossAmountMinor)}</td><td className="p-2">Invoice debt: {formatNaira(record.payableReductionMinor)}<br />Supplier credit: {formatNaira(record.supplierCreditMinor)}</td></tr>)}{!data.returns.length && <tr><td colSpan={4} className="p-3 text-[var(--muted)]">No goods returned for this invoice.</td></tr>}</tbody></table></div><CursorTablePagination page={pages.length} pageSize={limit} rowCount={data.returns.length} hasNextPage={Boolean(data.nextCursor)} loading={locked} onPrevious={() => setPages((value) => value.slice(0, -1))} onNext={() => { if (data.nextCursor) setPages((value) => [...value, data.nextCursor]); }} onPageSizeChange={(size) => { setLimit(size); setPages([null]); }} itemLabel="returns" /></>}</section>
      </div>
      {Boolean(data?.returns.length) && <section className="min-w-0 border-t p-5"><label className="text-sm font-medium">Photos for a recorded return<select className="mt-1 w-full rounded-lg border p-3" value={evidenceRecordId} onChange={event => setEvidenceRecordId(event.target.value)}><option value="">Choose return from this page</option>{data?.returns.map(record => <option key={record.id} value={record.id}>{record.returnNumber} · {record.productName}</option>)}</select></label>{data?.returns.filter(record => record.id === evidenceRecordId).map(record => <OperationalPhotos key={record.id} kind="supplier_return" recordId={record.id} stage="handover" serials={[]} serialRequired={record.serialized} canUpload={canPost} />)}</section>}
      <footer className="flex justify-end border-t p-5"><Button variant="outline" disabled={locked} onClick={onClose}>Close</Button></footer>
    </section>
  </AppDialog>;
}
