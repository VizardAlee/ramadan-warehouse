"use client";
import { FinancialDocument, FinancialMessage, FinancialPrintAction, FinancialText, FinancialValue } from "@/features/finance/financial-privacy";

import { fitInvoiceToPage } from "./invoice-print";
import { Printer, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { AppDialog } from "@/components/ui/app-dialog";
import { formatNaira } from "@/features/inventory/format";
import type { SaleDocument } from "@/features/pos/types";
import { SaleWaybills } from "./sale-waybills";
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
  const [waybillSelector, setWaybillSelector] = useState(false);
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
  if (waybillSelector) return <SaleWaybills document={page} onClose={() => setWaybillSelector(false)} onUpdated={(id, details) => setPage(previous => ({ ...previous, collections: previous.collections?.map(row => row.id === id ? { ...row, ...details } : row) }))} />;
  if (selectedCollection) return <CollectionWaybill document={document} collection={selectedCollection} onBack={() => setWaybillId(null)} onClose={onClose} onUpdated={details => setPage(previous => ({ ...previous, collections: previous.collections?.map(row => row.id === selectedCollection.id ? { ...row, ...details } : row) }))} />;
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
      ><FinancialDocument>
        <header className="flex items-start justify-between gap-4 border-b p-5 sm:p-7">
          <div className="flex min-w-0 items-start gap-3 sm:gap-5">
            <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-lg border bg-white p-1 sm:size-20">
              <Image src="/abr-logo.jpg" alt="AB Ramadan logo" width={384} height={455} className="brand-logo" />
            </span>
            <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[.16em] text-[var(--brand)]">
              <FinancialText>{document.official
                ? "Official sales document"
                : "Provisional offline document"}</FinancialText>
            </p>
            <h2 className="mt-1 text-2xl font-semibold">
              <FinancialText>{document.organization.tradingName ||
                document.organization.legalName}</FinancialText>
            </h2>
            {document.organization.tradingName && (
              <p className="text-sm text-[var(--muted)]">
                <FinancialText>{document.organization.legalName}</FinancialText>
              </p>
            )}
            <p className="mt-2 max-w-xl text-sm text-[var(--muted)]">
              <FinancialText>{[
                document.organization.address,
                document.organization.contactEmail,
                ...document.organization.phoneNumbers,
              ]
                .filter(Boolean)
                .join(" · ")}</FinancialText>
            </p>
            {document.organization.registrationNumber && (
              <p className="mt-1 text-xs text-[var(--muted)]">
                Registration: <FinancialText>{document.organization.registrationNumber}</FinancialText>
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
            <p className="font-semibold">Collection: <FinancialText>{label(document.sale.collectionStatus ?? "collected")}</FinancialText></p>
            {document.items.filter(item => item.itemKind !== "service").map((item) => <p key={item.id}><FinancialText>{item.productName}</FinancialText>: sold <FinancialText>{item.quantity}</FinancialText>, collected <FinancialText>{item.collectedQuantity ?? item.quantity}</FinancialText>, cancelled <FinancialText>{item.cancelledQuantity ?? 0}</FinancialText>, awaiting collection <FinancialText>{item.quantity - (item.collectedQuantity ?? item.quantity) - (item.cancelledQuantity ?? 0)}</FinancialText></p>)}
            {page.collections?.map((collection) => <div key={collection.id} className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3"><p><FinancialText>{collection.collectedAt ? new Date(collection.collectedAt).toLocaleString("en-NG") : "—"}</FinancialText> · <FinancialText>{collection.totalQuantity}</FinancialText> collected by <FinancialText>{collection.collector}</FinancialText> · <FinancialText>{collection.releasedByName || "Authorized staff"}</FinancialText></p>{document.official && <Button type="button" variant="outline" size="sm" data-no-print onClick={() => setWaybillId(collection.id)}>View waybill</Button>}{document.official && <CollectionPhotoViewer saleId={document.sale.id} evidenceIds={collection.evidenceIds ?? []} />}</div>)}
            {document.official && <div className="mt-3 flex flex-wrap items-center gap-3 border-t pt-3" data-no-print>
              <label>Collections per page <select aria-label="Collections per page" className="rounded border p-2" value={limit} disabled={busy} onChange={event => void loadCollectionPage(undefined, 0, Number(event.target.value))}>{[25, 50, 100].map(size => <option key={size} value={size}><FinancialText>{size}</FinancialText></option>)}</select></label>
              <span aria-live="polite"><FinancialText>{busy ? "Loading collection history…" : `Page ${pageNumber + 1} · ${page.collections?.length ?? 0} handovers`}</FinancialText></span>
              <Button type="button" variant="outline" size="sm" disabled={busy || pageNumber === 0} onClick={() => void loadCollectionPage(cursors[pageNumber - 1], pageNumber - 1)}>Newer collections</Button>
              <Button type="button" variant="outline" size="sm" disabled={busy || !page.collectionsNextCursorId} onClick={() => void loadCollectionPage(page.collectionsNextCursorId ?? undefined, pageNumber + 1)}>Older collections</Button>
              {error && <p role="alert" className="w-full text-red-700"><FinancialMessage>{error}</FinancialMessage></p>}
            </div>}
          </section>
          <section className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border p-4">
              <p className="text-xs font-semibold uppercase text-[var(--muted)]">
                Sales invoice
              </p>
              <p className="mt-1 font-mono font-semibold">
                <FinancialText>{document.sale.invoiceNumber}</FinancialText>
              </p>
              <p className="mt-2 text-sm">Issued <FinancialText>{issuedAt}</FinancialText></p>
              <p className="text-sm">
                Status:{" "}
                <span className="capitalize">
                  <FinancialText>{label(document.sale.paymentStatus)}</FinancialText>
                </span>
              </p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-xs font-semibold uppercase text-[var(--muted)]">
                Payment receipt
              </p>
              <p className="mt-1 font-mono font-semibold">
                <FinancialText>{document.sale.receiptNumber}</FinancialText>
              </p>
              <p className="mt-2 text-sm">
                Amount received:{" "}
                <strong><FinancialValue>{formatNaira(document.sale.amountPaidMinor)}</FinancialValue></strong>
              </p>
              {document.sale.creditAmountMinor > 0 && (
                <p className="text-sm text-amber-800">
                  Credit issued at checkout: <FinancialValue>{formatNaira(document.sale.creditAmountMinor)}</FinancialValue>
                </p>
              )}
            </div>
          </section>

          <section className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <p className="font-semibold">Seller</p>
              <p><FinancialText>{document.branch.name}</FinancialText></p>
              <p className="text-[var(--muted)]">
                <FinancialText>{[
                  document.branch.address,
                  document.branch.state,
                  document.branch.contactPhone,
                ]
                  .filter(Boolean)
                  .join(" · ")}</FinancialText>
              </p>
            </div>
            <div>
              <p className="font-semibold">Customer</p>
              <p><FinancialText>{document.sale.customerName || "Walk-in customer"}</FinancialText></p>
              <p className="text-[var(--muted)]">
                <FinancialText>{[
                  document.sale.customerNumber,
                  document.sale.customerPhone,
                  document.sale.customerEmail,
                  document.sale.customerTaxId,
                ]
                  .filter(Boolean)
                  .join(" · ")}</FinancialText>
              </p>
              {document.sale.customerAddress && (
                <p className="text-[var(--muted)]">
                  <FinancialText>{document.sale.customerAddress}</FinancialText>
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
                      <strong><FinancialText>{item.productName}</FinancialText></strong>{item.itemKind === "service" && <span className="block text-xs">Service fee<FinancialText>{item.aftersalesCaseId ? ` · Case ${item.aftersalesCaseId}` : ""}</FinancialText></span>}{item.includedParts?.length ? <p className="text-xs">Included parts: <FinancialText>{item.includedParts.map(part => `${part.productName} × ${part.quantity}${part.serialNumbers?.length ? ` (${part.serialNumbers.join(", ")})` : ""}`).join("; ")}</FinancialText></p> : null}{item.providerFunds && <p className="text-xs">Provider funds: <FinancialText>{item.providerFunds.supplierName}</FinancialText> · <FinancialValue>{formatNaira(item.providerFunds.amountMinor)}</FinancialValue> (separate payable)</p>}{Boolean(item.serialNumbers?.length) && <p className="mt-1 break-all text-xs">Allocated serials: <FinancialText>{item.serialNumbers!.join(", ")}</FinancialText><br />Collected: <FinancialText>{item.collectedSerialNumbers?.join(", ") || "None"}</FinancialText><br />Cancelled: <FinancialText>{item.cancelledSerialNumbers?.join(", ") || "None"}</FinancialText></p>}
                      <span className="block font-mono text-xs text-[var(--muted)]">
                        <FinancialText>{item.sku}</FinancialText>
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <FinancialText>{item.quantity}</FinancialText> <FinancialText>{item.unitOfMeasure}</FinancialText>
                    </td>
                    <td className="p-3 text-right">
                      <FinancialValue>{formatNaira(item.unitPriceMinor)}</FinancialValue>
                    </td>
                    <td className="p-3 text-right">
                      <FinancialValue>{formatNaira(item.discountAmountMinor)}</FinancialValue>
                    </td>
                    <td className="p-3 text-right">
                      <FinancialValue>{formatNaira(item.vatAmountMinor)}</FinancialValue>
                    </td>
                    <td className="p-3 text-right font-medium">
                      <FinancialValue>{formatNaira(item.grossAmountMinor)}</FinancialValue>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <section className="ml-auto max-w-sm space-y-2 text-sm">
            <div className="flex justify-between">
              <span>Product subtotal</span>
              <span><FinancialValue>{formatNaira(document.sale.subtotalAmountMinor)}</FinancialValue></span>
            </div>
            {document.sale.discountAmountMinor > 0 && (
              <div className="flex justify-between text-emerald-800">
                <span>
                  Discount
                  <FinancialText>{document.sale.discountReason
                    ? ` · ${document.sale.discountReason}`
                    : ""}</FinancialText>
                </span>
                <span>−<FinancialValue>{formatNaira(document.sale.discountAmountMinor)}</FinancialValue></span>
              </div>
            )}
            <div className="flex justify-between">
              <span>Net sales</span>
              <span><FinancialValue>{formatNaira(document.sale.netAmountMinor)}</FinancialValue></span>
            </div>
            <div className="flex justify-between">
              <span>VAT</span>
              <span><FinancialValue>{formatNaira(document.sale.vatAmountMinor)}</FinancialValue></span>
            </div>
            {!!document.sale.providerFundsMinor && <div className="flex justify-between"><span>Provider funds (pass-through)</span><span><FinancialValue>{formatNaira(document.sale.providerFundsMinor)}</FinancialValue></span></div>}
            <div className="flex justify-between border-t pt-2 text-lg font-semibold">
              <span>Invoice total</span>
              <span><FinancialValue>{formatNaira(document.sale.grossAmountMinor)}</FinancialValue></span>
            </div>
          </section>

          <section>
            <h3 className="font-semibold">Payment evidence</h3>
            {!!document.sale.priorServicePaidMinor && <p className="text-sm">Previously received on linked service cases: <FinancialValue>{formatNaira(document.sale.priorServicePaidMinor)}</FinancialValue>. Carried forward without a new cash receipt.</p>}
            <div className="mt-2 space-y-2 text-sm">
              {document.payments.map((payment) => (
                <div
                  key={payment.id}
                  className="flex flex-wrap justify-between gap-2 rounded-lg bg-slate-50 p-3"
                >
                  <span className="capitalize">
                    <FinancialText>{label(payment.method)}</FinancialText>
                    <FinancialText>{payment.reference ? ` · ${payment.reference}` : ""}</FinancialText>
                  </span>
                  <strong><FinancialValue>{formatNaira(payment.amountMinor)}</FinancialValue></strong>
                </div>
              ))}
              {!document.payments.length && (
                <p className="rounded-lg bg-amber-50 p-3 text-amber-950">
                  <FinancialText>{(document.sale.priorServicePaidMinor ?? 0) >= document.sale.grossAmountMinor ? "This invoice is covered by previous service receipts. No additional payment is due." : "No new payment was received. The remaining invoice amount is on customer credit."}</FinancialText>
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
          {document.official && <Button variant="outline" onClick={() => setWaybillSelector(true)}>Print waybill</Button>}
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <FinancialPrintAction><Button onClick={() => window.print()}>
            <Printer className="mr-2 size-4" /> Print or save PDF
          </Button></FinancialPrintAction>
        </footer>
      </FinancialDocument></section>
    </AppDialog>
  );
}
