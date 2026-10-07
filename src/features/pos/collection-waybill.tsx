"use client";

import Image from "next/image";
import { Printer } from "lucide-react";
import { AppDialog } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import type { SaleDocument } from "./types";

export function CollectionWaybill({ document, collection, onBack, onClose }: {
  document: SaleDocument;
  collection: NonNullable<SaleDocument["collections"]>[number];
  onBack: () => void;
  onClose: () => void;
}) {
  return <AppDialog role="dialog" aria-modal="true" aria-label="Collection waybill" data-sale-document-overlay>
    <section className="app-dialog-panel max-w-3xl rounded-2xl bg-white shadow-2xl" data-print-document>
      <div className="space-y-6 p-5 sm:p-8">
        <header className="flex items-start gap-4 border-b-2 border-[var(--brand)] pb-5">
          <Image src="/abr-logo.jpg" alt="AB Ramadan logo" width={64} height={76} className="h-20 w-16 object-contain" />
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold text-[var(--brand)]">{document.organization.tradingName || document.organization.legalName}</h2>
            <p className="mt-1 text-sm">{document.organization.address}</p>
            <p className="mt-1 text-xs">{[...document.organization.phoneNumbers, document.organization.contactEmail].filter(Boolean).join(" · ")}</p>
          </div>
        </header>
        <div className="flex flex-wrap justify-between gap-4">
          <div><h1 className="text-2xl font-bold tracking-wide">COLLECTION WAYBILL</h1><p className="mt-1 break-all text-sm font-semibold">{collection.waybillNumber || `WB-${collection.id}`}</p></div>
          <div className="text-sm"><p>Invoice: {document.sale.invoiceNumber}</p><p>Sale: {document.sale.saleNumber}</p><p>{collection.collectedAt ? new Date(collection.collectedAt).toLocaleString("en-NG", { timeZone: "Africa/Lagos" }) : "Recorded collection"}</p></div>
        </div>
        <section className="grid gap-5 text-sm sm:grid-cols-2">
          <div><h3 className="font-bold">Released from</h3><p>{document.branch.name}</p><p>{[document.branch.address, document.branch.state].filter(Boolean).join(", ")}</p><p>Releasing staff: {collection.releasedByName || "Authorized staff"}</p></div>
          <div><h3 className="font-bold">Customer / destination</h3><p>{document.sale.customerName || "Walk-in customer"}</p><p>{document.sale.customerPhone}</p><p>{document.sale.customerAddress || "Collected at store"}</p><p className="mt-2">Collected by: <strong>{collection.collector}</strong></p></div>
        </section>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-y-2 border-slate-700"><tr><th className="py-3 pr-3">No.</th><th className="py-3 pr-3">Goods handed over</th><th className="py-3 text-right">Quantity</th></tr></thead>
            <tbody>{collection.lines.map((line, index) => <tr key={line.saleItemId || index} className="border-b"><td className="py-3 pr-3 align-top">{index + 1}</td><td className="py-3 pr-3"><strong>{line.productName}</strong>{line.sku && <span className="mt-1 block text-xs text-slate-500">{line.sku}</span>}</td><td className="py-3 text-right align-top">{line.quantity} {line.unitOfMeasure || "unit"}</td></tr>)}</tbody>
            <tfoot><tr className="border-b-2 border-slate-700 font-bold"><td colSpan={2} className="py-3">Total units in this handover</td><td className="py-3 text-right">{collection.totalQuantity}</td></tr></tfoot>
          </table>
        </div>
        {collection.notes && <p className="whitespace-pre-wrap text-sm"><strong>Handover notes:</strong> {collection.notes}</p>}
        <p className="text-xs text-slate-600">This waybill covers only the goods recorded in this collection, not the full invoice or any goods still reserved. It is not a payment receipt. Reprinting retains the same collection reference and does not release stock again.</p>
        <div className="grid grid-cols-2 gap-8 pt-10 text-sm"><div className="border-t pt-2">Released by — signature</div><div className="border-t pt-2">Received by — signature</div></div>
      </div>
      <footer className="flex flex-wrap justify-end gap-3 border-t p-5" data-no-print>
        <Button variant="outline" onClick={onBack}>Back to invoice</Button><Button variant="secondary" onClick={onClose}>Close</Button><Button onClick={() => window.print()}><Printer className="mr-2 size-4" />Print waybill / save PDF</Button>
      </footer>
    </section>
  </AppDialog>;
}
