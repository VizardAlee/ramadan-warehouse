"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import { CursorTablePagination } from "@/components/ui/table-pagination";
import { callAdministration } from "@/features/administration/api";

interface ReceiptRow {
  id: string; receiptNumber: string; productName: string; quantity: number;
  receivedAt: string; unitOfMeasure: string;
}
interface ReceiptDocument extends ReceiptRow {
  purchaseOrderNumber: string; supplierName: string; receivingStore: string;
  receivingLocationName: string; receivedByName: string; inventoryReference: string;
  supplierReference: string | null; serialNumbers: string[]; lotNumber: string | null;
  notes: string | null;
  organization: { legalName: string; tradingName: string | null; address: string | null; contactEmail: string | null; phoneNumbers: string[] };
}
interface ReceiptPage { receipts: ReceiptRow[]; nextCursor: string | null }
const receivedDate = (value: string) => value ? new Date(value).toLocaleString("en-GB", { timeZone: "Africa/Lagos" }) : "Date not recorded";

/** Reprinting an existing receiving event never posts another stock movement. */
export function GoodsReceivedNotes({ purchaseOrderId, onClose }: { purchaseOrderId: string; onClose: () => void }) {
  const [limit, setLimit] = useState(25);
  const [pages, setPages] = useState<Array<string | null>>([null]);
  const [page, setPage] = useState<{ key: string; data?: ReceiptPage; error?: string }>();
  const [document, setDocument] = useState<ReceiptDocument | null>(null);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState("");
  const cursor = pages.at(-1);
  const key = JSON.stringify([purchaseOrderId, limit, cursor]);
  const data = page?.key === key ? page.data : undefined;
  const error = page?.key === key ? page.error : undefined;
  useEffect(() => {
    let active = true;
    void callAdministration<object, ReceiptPage>("getProcurementWorkspace", { view: "purchase_receipts", purchaseOrderId, limit, cursor: cursor || undefined })
      .then((result) => { if (active) setPage({ key, data: result }); })
      .catch((cause) => { if (active) setPage({ key, error: cause instanceof Error ? cause.message : "Receiving history could not be loaded." }); });
    return () => { active = false; };
  }, [purchaseOrderId, limit, cursor, key]);
  async function open(receiptId: string) {
    setOpening(true); setOpenError("");
    try {
      const result = await callAdministration<object, { document: ReceiptDocument }>("getProcurementWorkspace", { view: "purchase_receipts", purchaseOrderId, receiptId });
      setDocument(result.document);
    } catch (cause) { setOpenError(cause instanceof Error ? cause.message : "The goods-received note could not be loaded."); }
    finally { setOpening(false); }
  }
  return <AppDialog role="dialog" aria-modal="true" aria-label={document ? "Goods received note" : "Receiving history"} data-print-document-overlay>
    <section className="app-dialog-panel max-w-3xl rounded-2xl bg-white shadow-2xl" {...(document ? { "data-print-document": true } : {})}>
      {document ? <>
        <div className="space-y-6 p-5 sm:p-8">
          <header className="flex gap-4 border-b-2 border-[var(--brand)] pb-5">
            <Image src="/abr-logo.jpg" alt="AB Ramadan logo" width={64} height={76} className="h-20 w-16 object-contain" />
            <div><h2 className="text-xl font-bold text-[var(--brand)]">{document.organization.tradingName || document.organization.legalName}</h2><p className="text-sm">{document.organization.address}</p><p className="text-xs">{[...document.organization.phoneNumbers, document.organization.contactEmail].filter(Boolean).join(" · ")}</p></div>
          </header>
          <div><h1 className="text-2xl font-bold">GOODS RECEIVED NOTE</h1><p className="break-all font-semibold">{document.receiptNumber}</p><p className="text-sm">Received: {receivedDate(document.receivedAt)}</p></div>
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div><dt className="font-semibold">Supplier / purchase order</dt><dd>{document.supplierName}</dd><dd>{document.purchaseOrderNumber}</dd>{document.supplierReference && <dd>Supplier reference: {document.supplierReference}</dd>}</div>
            <div><dt className="font-semibold">Received into</dt><dd>{document.receivingStore}</dd><dd>{document.receivingLocationName}</dd><dd>Received by: {document.receivedByName}</dd></div>
          </dl>
          <table className="w-full text-left text-sm"><thead className="border-y-2"><tr><th className="py-3">Goods received</th><th className="py-3 text-right">Quantity</th></tr></thead><tbody><tr className="border-b"><td className="py-4">{document.productName}</td><td className="py-4 text-right">{document.quantity} {document.unitOfMeasure}</td></tr></tbody></table>
          {document.serialNumbers.length > 0 && <section><h3 className="font-semibold">Recorded serial numbers</h3><p className="mt-2 break-words text-sm">{document.serialNumbers.join(", ")}</p></section>}
          {document.lotNumber && <p className="text-sm">Batch / lot: {document.lotNumber}</p>}
          {document.notes && <p className="whitespace-pre-wrap text-sm">{document.notes}</p>}
          <p className="break-words text-xs text-[var(--muted)]">Stock ledger reference: {document.inventoryReference}. This note covers this receiving event only, not every item on the purchase order. It is not a supplier invoice or proof of payment. Reprinting does not receive goods again.</p>
          <div className="grid grid-cols-2 gap-8 pt-10 text-sm"><div className="border-t pt-2">Received by — signature</div><div className="border-t pt-2">Delivered by — signature</div></div>
        </div>
        <footer className="flex flex-wrap justify-end gap-3 border-t p-5" data-no-print><Button variant="outline" onClick={() => setDocument(null)}>Back to history</Button><Button variant="outline" onClick={onClose}>Close</Button><Button onClick={() => window.print()}>Print / save PDF</Button></footer>
      </> : <div className="space-y-4 p-5 sm:p-7">
        <h2 className="text-xl font-semibold">Receiving history</h2><p className="text-sm text-[var(--muted)]">Open a recorded receipt to print its goods-received note. Each entry represents one actual handover.</p>
        {(error || openError) && <p role="alert" className="text-red-800">{error || openError}</p>}
        {!data && !error && <p role="status">Loading receiving history…</p>}
        {data && <><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Date / reference</th><th className="p-2">Goods</th><th className="p-2">Quantity</th><th className="p-2">Note</th></tr></thead><tbody>{data.receipts.map((receipt) => <tr key={receipt.id} className="border-t"><td className="p-2">{receivedDate(receipt.receivedAt)}<small className="block break-all">{receipt.receiptNumber}</small></td><td className="p-2">{receipt.productName}</td><td className="p-2">{receipt.quantity} {receipt.unitOfMeasure}</td><td className="p-2"><Button variant="outline" disabled={opening} onClick={() => void open(receipt.id)}>Open note</Button></td></tr>)}{!data.receipts.length && <tr><td colSpan={4} className="p-3">No goods received for this order yet.</td></tr>}</tbody></table></div>
          <CursorTablePagination page={pages.length} pageSize={limit} rowCount={data.receipts.length} hasNextPage={Boolean(data.nextCursor)} loading={opening} onPrevious={() => setPages((value) => value.slice(0, -1))} onNext={() => { if (data.nextCursor) setPages((value) => [...value, data.nextCursor]); }} onPageSizeChange={(size) => { setLimit(size); setPages([null]); }} itemLabel="receipts" /></>}
        <div className="flex justify-end border-t pt-4"><Button variant="outline" disabled={opening} onClick={onClose}>Close</Button></div>
      </div>}
    </section>
  </AppDialog>;
}
