"use client";

import { Printer, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatNaira } from "@/features/inventory/format";
import type { SaleDocument } from "@/features/pos/types";

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
  const issuedAt = document.sale.recordedAt
    ? new Date(document.sale.recordedAt).toLocaleString("en-NG", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Pending synchronization";

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/55 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Official sale invoice and receipt"
      data-sale-document-overlay
    >
      <section
        className="mx-auto w-full max-w-3xl rounded-2xl bg-white shadow-2xl"
        data-print-document
      >
        <header className="flex items-start justify-between gap-4 border-b p-5 sm:p-7">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.16em] text-[var(--brand)]">
              {document.official ? "Official sales document" : "Provisional offline document"}
            </p>
            <h2 className="mt-1 text-2xl font-semibold">
              {document.organization.tradingName || document.organization.legalName}
            </h2>
            {document.organization.tradingName && (
              <p className="text-sm text-[var(--muted)]">{document.organization.legalName}</p>
            )}
            <p className="mt-2 max-w-xl text-sm text-[var(--muted)]">
              {[document.organization.address, document.organization.contactEmail, ...document.organization.phoneNumbers]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {document.organization.registrationNumber && (
              <p className="mt-1 text-xs text-[var(--muted)]">
                Registration: {document.organization.registrationNumber}
              </p>
            )}
          </div>
          <Button variant="ghost" size="icon" aria-label="Close document" onClick={onClose} data-no-print>
            <X className="size-5" />
          </Button>
        </header>

        {!document.official && (
          <div className="border-b bg-amber-50 px-5 py-3 text-sm font-semibold text-amber-950 sm:px-7">
            Not yet posted. This provisional receipt is replaced by the official server document after synchronization.
          </div>
        )}

        <div className="space-y-6 p-5 sm:p-7">
          <section className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border p-4">
              <p className="text-xs font-semibold uppercase text-[var(--muted)]">Sales invoice</p>
              <p className="mt-1 font-mono font-semibold">{document.sale.invoiceNumber}</p>
              <p className="mt-2 text-sm">Issued {issuedAt}</p>
              <p className="text-sm">Status: <span className="capitalize">{label(document.sale.paymentStatus)}</span></p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-xs font-semibold uppercase text-[var(--muted)]">Payment receipt</p>
              <p className="mt-1 font-mono font-semibold">{document.sale.receiptNumber}</p>
              <p className="mt-2 text-sm">Amount received: <strong>{formatNaira(document.sale.amountPaidMinor)}</strong></p>
              {document.sale.creditAmountMinor > 0 && (
                <p className="text-sm text-amber-800">Outstanding: {formatNaira(document.sale.creditAmountMinor)}</p>
              )}
            </div>
          </section>

          <section className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <p className="font-semibold">Seller</p>
              <p>{document.branch.name}</p>
              <p className="text-[var(--muted)]">{[document.branch.address, document.branch.state, document.branch.contactPhone].filter(Boolean).join(" · ")}</p>
            </div>
            <div>
              <p className="font-semibold">Customer</p>
              <p>{document.sale.customerName || "Walk-in customer"}</p>
              <p className="text-[var(--muted)]">{[document.sale.customerNumber, document.sale.customerPhone, document.sale.customerEmail, document.sale.customerTaxId].filter(Boolean).join(" · ")}</p>
              {document.sale.customerAddress && <p className="text-[var(--muted)]">{document.sale.customerAddress}</p>}
            </div>
          </section>

          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[38rem] text-left text-sm">
              <thead className="bg-slate-50">
                <tr><th className="p-3">Item</th><th className="p-3 text-right">Qty</th><th className="p-3 text-right">Unit price</th><th className="p-3 text-right">VAT</th><th className="p-3 text-right">Total</th></tr>
              </thead>
              <tbody>
                {document.items.map((item) => (
                  <tr key={item.id} className="border-t">
                    <td className="p-3"><strong>{item.productName}</strong><span className="block font-mono text-xs text-[var(--muted)]">{item.sku}</span></td>
                    <td className="p-3 text-right">{item.quantity} {item.unitOfMeasure}</td>
                    <td className="p-3 text-right">{formatNaira(item.unitPriceMinor)}</td>
                    <td className="p-3 text-right">{formatNaira(item.vatAmountMinor)}</td>
                    <td className="p-3 text-right font-medium">{formatNaira(item.grossAmountMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <section className="ml-auto max-w-sm space-y-2 text-sm">
            <div className="flex justify-between"><span>Net sales</span><span>{formatNaira(document.sale.netAmountMinor)}</span></div>
            <div className="flex justify-between"><span>VAT</span><span>{formatNaira(document.sale.vatAmountMinor)}</span></div>
            <div className="flex justify-between border-t pt-2 text-lg font-semibold"><span>Invoice total</span><span>{formatNaira(document.sale.grossAmountMinor)}</span></div>
          </section>

          <section>
            <h3 className="font-semibold">Payment evidence</h3>
            <div className="mt-2 space-y-2 text-sm">
              {document.payments.map((payment) => (
                <div key={payment.id} className="flex flex-wrap justify-between gap-2 rounded-lg bg-slate-50 p-3">
                  <span className="capitalize">{label(payment.method)}{payment.reference ? ` · ${payment.reference}` : ""}</span>
                  <strong>{formatNaira(payment.amountMinor)}</strong>
                </div>
              ))}
              {!document.payments.length && <p className="rounded-lg bg-amber-50 p-3 text-amber-950">No payment was received. The invoice remains on customer credit.</p>}
            </div>
          </section>

          <p className="border-t pt-4 text-xs text-[var(--muted)]">
            This document is generated from immutable server-posted sale, item, payment and receipt evidence. VAT is stated separately. Returns and corrections are issued as linked records and do not rewrite this document.
          </p>
        </div>

        <footer className="flex flex-col gap-3 border-t p-5 sm:flex-row sm:justify-end sm:p-7" data-no-print>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button onClick={() => window.print()}><Printer className="mr-2 size-4" /> Print or save PDF</Button>
        </footer>
      </section>
    </div>
  );
}
