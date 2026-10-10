"use client";

import { fitInvoiceToPage } from "./invoice-print";
import { Printer, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { AppDialog } from "@/components/ui/app-dialog";
import { formatNaira } from "@/features/inventory/format";
import type { SaleDocument } from "@/features/pos/types";
import { CollectionWaybill } from "./collection-waybill";
import { CollectionPhotoViewer } from "./collection-photos";
import { useAuth } from "@/features/auth/auth-context";
import { hasPermission } from "@/lib/permissions/roles";
import { callAdministration } from "@/features/administration/api";

function label(value: string) {
  return value.replaceAll("_", " ");
}

export function SaleDocumentDialog({
  document,
  onClose,
}: {
  document: SaleDocument;
  onClose: () => void;
}) {
  return <SaleDocumentContent key={`${document.sale.id}:${document.official}:${document.collections?.map(row => row.id).join(",")}`} document={document} onClose={onClose} />;
}

function SaleDocumentContent({ document, onClose }: { document: SaleDocument; onClose: () => void }) {
  const { profile } = useAuth();
  const printRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const fit = () => {
      const element = printRef.current;
      if (!element) return;
      fitInvoiceToPage(element);
    };
    window.addEventListener("beforeprint", fit);
    return () => window.removeEventListener("beforeprint", fit);
  }, []);
  const [waybillId, setWaybillId] = useState<string | null>(null);
  const [page, setPage] = useState(document);
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [pageNumber, setPageNumber] = useState(0);
  const [limit, setLimit] = useState(25);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function loadCollectionPage(cursor: string | undefined, target: number, size = limit) {
    if (flight.current || !document.official) return;
    flight.current = true; setBusy(true); setError(null);
    try {
      const result = await callAdministration<object, SaleDocument>("getSaleDocument", {
        saleId: document.sale.id, collectionLimit: size, ...(cursor ? { collectionCursorId: cursor } : {}),
      });
      if (!result.official || result.sale.id !== document.sale.id || result.branch.id !== document.branch.id)
        throw new Error("This collection page does not belong to this invoice.");
      if (!mounted.current) return;
      setPage(result); setPageNumber(target); setLimit(size); setWaybillId(null);
      setCursors(previous => [...previous.slice(0, target), cursor]);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Collection history could not be loaded. Try again.");
    } finally { flight.current = false; if (mounted.current) setBusy(false); }
  }
  const selectedCollection = document.official ? page.collections?.find((collection) => collection.id === waybillId) : undefined;
  if (selectedCollection) return <CollectionWaybill document={document} collection={selectedCollection} onBack={() => setWaybillId(null)} onClose={onClose} />;
  const issuedAt = document.sale.recordedAt
    ? new Date(document.sale.recordedAt).toLocaleString("en-NG", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Pending synchronization";

  return (
    <AppDialog
      role="dialog"
      aria-modal="true"
      aria-label="Official sale invoice and receipt"
      data-sale-document-overlay
    >
      <section
        className="app-dialog-panel max-w-3xl rounded-2xl bg-white shadow-2xl"
        ref={printRef}
        data-invoice-document
        data-print-document
      >
        <header className="flex items-start justify-between gap-4 border-b p-5 sm:p-7">
          <div className="flex min-w-0 items-start gap-3 sm:gap-5">
            <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-lg border bg-white p-1 sm:size-20">
              <Image src="/abr-logo.jpg" alt="AB Ramadan logo" width={384} height={455} className="brand-logo" />
            </span>
            <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[.16em] text-[var(--brand)]">
              {document.official
                ? "Official sales document"
                : "Provisional offline document"}
            </p>
            <h2 className="mt-1 text-2xl font-semibold">
              {document.organization.tradingName ||
                document.organization.legalName}
            </h2>
            {document.organization.tradingName && (
              <p className="text-sm text-[var(--muted)]">
                {document.organization.legalName}
              </p>
            )}
            <p className="mt-2 max-w-xl text-sm text-[var(--muted)]">
              {[
                document.organization.address,
                document.organization.contactEmail,
                ...document.organization.phoneNumbers,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {document.organization.registrationNumber && (
              <p className="mt-1 text-xs text-[var(--muted)]">
                Registration: {document.organization.registrationNumber}
              </p>
            )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close document"
            onClick={onClose}
            data-no-print
          >
            <X className="size-5" />
          </Button>
        </header>

        {!document.official && (
          <div className="border-b bg-amber-50 px-5 py-3 text-sm font-semibold text-amber-950 sm:px-7">
            Not yet posted. This provisional receipt is replaced by the official
            server document after synchronization.
          </div>
        )}

        <div className="space-y-6 p-5 sm:p-7">
          <section className="rounded-xl border p-4 text-sm" data-no-print>
            <p className="font-semibold">Collection: {label(document.sale.collectionStatus ?? "collected")}</p>
            {document.items.map((item) => <p key={item.id}>{item.productName}: sold {item.quantity}, collected {item.collectedQuantity ?? item.quantity}, cancelled {item.cancelledQuantity ?? 0}, awaiting collection {item.quantity - (item.collectedQuantity ?? item.quantity) - (item.cancelledQuantity ?? 0)}</p>)}
            {page.collections?.map((collection) => <div key={collection.id} className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3"><p>{collection.collectedAt ? new Date(collection.collectedAt).toLocaleString("en-NG") : "—"} · {collection.totalQuantity} collected by {collection.collector} · {collection.releasedByName || "Authorized staff"}</p>{document.official && <Button type="button" variant="outline" size="sm" data-no-print onClick={() => setWaybillId(collection.id)}>View waybill</Button>}{document.official && <CollectionPhotoViewer saleId={document.sale.id} evidenceIds={collection.evidenceIds ?? []} />}</div>)}
            {document.official && <div className="mt-3 flex flex-wrap items-center gap-3 border-t pt-3" data-no-print>
              <label>Collections per page <select aria-label="Collections per page" className="rounded border p-2" value={limit} disabled={busy} onChange={event => void loadCollectionPage(undefined, 0, Number(event.target.value))}>{[25, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}</select></label>
              <span aria-live="polite">{busy ? "Loading collection history…" : `Page ${pageNumber + 1} · ${page.collections?.length ?? 0} handovers`}</span>
              <Button type="button" variant="outline" size="sm" disabled={busy || pageNumber === 0} onClick={() => void loadCollectionPage(cursors[pageNumber - 1], pageNumber - 1)}>Newer collections</Button>
              <Button type="button" variant="outline" size="sm" disabled={busy || !page.collectionsNextCursorId} onClick={() => void loadCollectionPage(page.collectionsNextCursorId ?? undefined, pageNumber + 1)}>Older collections</Button>
              {error && <p role="alert" className="w-full text-red-700">{error}</p>}
            </div>}
          </section>
          <section className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border p-4">
              <p className="text-xs font-semibold uppercase text-[var(--muted)]">
                Sales invoice
              </p>
              <p className="mt-1 font-mono font-semibold">
                {document.sale.invoiceNumber}
              </p>
              <p className="mt-2 text-sm">Issued {issuedAt}</p>
              <p className="text-sm">
                Status:{" "}
                <span className="capitalize">
                  {label(document.sale.paymentStatus)}
                </span>
              </p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-xs font-semibold uppercase text-[var(--muted)]">
                Payment receipt
              </p>
              <p className="mt-1 font-mono font-semibold">
                {document.sale.receiptNumber}
              </p>
              <p className="mt-2 text-sm">
                Amount received:{" "}
                <strong>{formatNaira(document.sale.amountPaidMinor)}</strong>
              </p>
              {document.sale.creditAmountMinor > 0 && (
                <p className="text-sm text-amber-800">
                  Outstanding: {formatNaira(document.sale.creditAmountMinor)}
                </p>
              )}
            </div>
          </section>

          <section className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <p className="font-semibold">Seller</p>
              <p>{document.branch.name}</p>
              <p className="text-[var(--muted)]">
                {[
                  document.branch.address,
                  document.branch.state,
                  document.branch.contactPhone,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <div>
              <p className="font-semibold">Customer</p>
              <p>{document.sale.customerName || "Walk-in customer"}</p>
              <p className="text-[var(--muted)]">
                {[
                  document.sale.customerNumber,
                  document.sale.customerPhone,
                  document.sale.customerEmail,
                  document.sale.customerTaxId,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {document.sale.customerAddress && (
                <p className="text-[var(--muted)]">
                  {document.sale.customerAddress}
                </p>
              )}
            </div>
          </section>

          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[38rem] text-left text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="p-3">Item</th>
                  <th className="p-3 text-right">Qty</th>
                  <th className="p-3 text-right">Unit price</th>
                  <th className="p-3 text-right">Discount</th>
                  <th className="p-3 text-right">VAT</th>
                  <th className="p-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {document.items.map((item) => (
                  <tr key={item.id} className="border-t">
                    <td className="p-3">
                      <strong>{item.productName}</strong>{Boolean(item.serialNumbers?.length) && <p className="mt-1 break-all text-xs">Allocated serials: {item.serialNumbers!.join(", ")}<br />Collected: {item.collectedSerialNumbers?.join(", ") || "None"}<br />Cancelled: {item.cancelledSerialNumbers?.join(", ") || "None"}</p>}
                      <span className="block font-mono text-xs text-[var(--muted)]">
                        {item.sku}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      {item.quantity} {item.unitOfMeasure}
                    </td>
                    <td className="p-3 text-right">
                      {formatNaira(item.unitPriceMinor)}
                    </td>
                    <td className="p-3 text-right">
                      {formatNaira(item.discountAmountMinor)}
                    </td>
                    <td className="p-3 text-right">
                      {formatNaira(item.vatAmountMinor)}
                    </td>
                    <td className="p-3 text-right font-medium">
                      {formatNaira(item.grossAmountMinor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <section className="ml-auto max-w-sm space-y-2 text-sm">
            <div className="flex justify-between">
              <span>Product subtotal</span>
              <span>{formatNaira(document.sale.subtotalAmountMinor)}</span>
            </div>
            {document.sale.discountAmountMinor > 0 && (
              <div className="flex justify-between text-emerald-800">
                <span>
                  Discount
                  {document.sale.discountReason
                    ? ` · ${document.sale.discountReason}`
                    : ""}
                </span>
                <span>−{formatNaira(document.sale.discountAmountMinor)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span>Net sales</span>
              <span>{formatNaira(document.sale.netAmountMinor)}</span>
            </div>
            <div className="flex justify-between">
              <span>VAT</span>
              <span>{formatNaira(document.sale.vatAmountMinor)}</span>
            </div>
            <div className="flex justify-between border-t pt-2 text-lg font-semibold">
              <span>Invoice total</span>
              <span>{formatNaira(document.sale.grossAmountMinor)}</span>
            </div>
          </section>

          <section>
            <h3 className="font-semibold">Payment evidence</h3>
            <div className="mt-2 space-y-2 text-sm">
              {document.payments.map((payment) => (
                <div
                  key={payment.id}
                  className="flex flex-wrap justify-between gap-2 rounded-lg bg-slate-50 p-3"
                >
                  <span className="capitalize">
                    {label(payment.method)}
                    {payment.reference ? ` · ${payment.reference}` : ""}
                  </span>
                  <strong>{formatNaira(payment.amountMinor)}</strong>
                </div>
              ))}
              {!document.payments.length && (
                <p className="rounded-lg bg-amber-50 p-3 text-amber-950">
                  No payment was received. The invoice remains on customer
                  credit.
                </p>
              )}
            </div>
          </section>

          <p className="border-t pt-4 text-xs text-[var(--muted)]">
            This document is generated from immutable server-posted sale, item,
            payment and receipt evidence. VAT is stated separately. Returns and
            corrections are issued as linked records and do not rewrite this
            document.
          </p>
        </div>

        <footer
          className="flex flex-col gap-3 border-t p-5 sm:flex-row sm:justify-end sm:p-7"
          data-no-print
        >
          {document.official && profile && hasPermission(profile, "expenses.create") && hasPermission(profile, "expenses.read") && <Link className="self-center text-sm font-semibold underline" href={`/expenses?saleId=${encodeURIComponent(document.sale.id)}&branchId=${encodeURIComponent(document.branch.id)}`}>Record delivery / service provider cost</Link>}
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => window.print()}>
            <Printer className="mr-2 size-4" /> Print or save PDF
          </Button>
        </footer>
      </section>
    </AppDialog>
  );
}
