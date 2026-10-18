"use client";

import { useRef, useState } from "react";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";
import { AppDialog } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { formatNaira } from "@/features/inventory/format";

interface Receipt {
  id: string; party: "customer" | "supplier"; companyName: string; partyName: string | null; partyNumber: string | null;
  paymentNumber: string; purpose: string; direction: string; source: string | null; amountMinor: number | null; at: string | null;
  reference: string | null; notes: string | null; journalEntryId: string | null; balanceScope: string;
  outstandingAfterMinor: number | null; advanceAfterMinor: number | null;
  tenders: Array<{ method: string | null; amountMinor: number | null; bankName: string | null; accountName: string | null; accountNumberLast4: string | null; reference: string | null }>;
  allocations: Array<{ invoiceNumber: string | null; amountMinor: number | null; outstandingAfterMinor: number | null }>;
  arrangements: Array<{ name: string | null; amountMinor: number | null }>;
}
const money = (value: number | null) => value === null ? "Not recorded at payment" : formatNaira(value);
const readable = (value: string | null) => value ? value.replaceAll("_", " ") : "Not recorded";
export function AccountReceiptButton({ party, partyId, paymentId, branchId, warehouseId }: { party: "customer" | "supplier"; partyId: string; paymentId: string; branchId?: string; warehouseId?: string }) {
  const [receipt, setReceipt] = useState<Receipt>(), [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  const flight = useRef(false);
  async function open() {
    if (flight.current) return;
    flight.current = true; setBusy(true); setError(undefined);
    try {
      const result = await callAdministration<object, Receipt>(party === "customer" ? "getCustomerHistory" : "getProcurementWorkspace", { view: party === "customer" ? "payment_receipt" : "supplier_payment_receipt", ...(party === "customer" ? { customerId: partyId } : { supplierId: partyId }), paymentId, branchId: branchId || undefined, warehouseId: warehouseId || undefined });
      if (result.id !== paymentId || result.party !== party) throw new Error("This receipt does not match the selected payment.");
      setReceipt(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Receipt could not be loaded."); }
    finally { flight.current = false; setBusy(false); }
  }
  return <><Button variant="outline" size="sm" disabled={busy} onClick={() => void open()}>Print receipt</Button>{error && <p role="alert" className="text-sm">{error}</p>}{receipt?.id === paymentId && receipt.party === party && <AccountReceiptDialog receipt={receipt} onClose={() => setReceipt(undefined)} />}</>;
}
export function AccountReceiptDialog({ receipt, onClose }: { receipt: Receipt; onClose: () => void }) {
  const dialogRef = useDialogFocus<HTMLElement>(true, onClose);
  const noncash = receipt.direction === "non_cash" || receipt.source === "advance_balance";
  const title = noncash ? "Advance application record" : receipt.purpose === "advance_refund" ? receipt.party === "supplier" ? "Supplier advance / credit refund receipt" : "Advance refund receipt" : receipt.purpose === "advance" ? receipt.party === "customer" ? "Customer deposit receipt" : "Supplier advance receipt" : "Account payment receipt";
  return <AppDialog role="dialog" aria-modal="true" aria-label={title} data-print-document-overlay><section ref={dialogRef} className="app-dialog-panel min-w-0 max-w-3xl space-y-5 [overflow-wrap:anywhere] rounded-2xl bg-white p-5 sm:p-7" data-print-document>
    <header className="border-b pb-4"><h2 className="text-xl font-bold">{receipt.companyName}</h2><h1 className="mt-2 text-2xl font-semibold">{title}</h1><p className="break-all font-mono">{receipt.paymentNumber}</p></header>
    <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="font-semibold">{receipt.party === "customer" ? "Customer" : "Supplier"}</dt><dd>{receipt.partyName || "Name not recorded"} · {receipt.partyNumber}</dd></div><div><dt className="font-semibold">Recorded date (Lagos)</dt><dd>{receipt.at ? new Date(receipt.at).toLocaleString("en-NG", { timeZone: "Africa/Lagos" }) : "Not recorded"}</dd></div><div><dt className="font-semibold">{noncash ? "Advance applied" : receipt.direction === "inflow" ? "Money received by company" : "Money paid by company"}</dt><dd className="text-xl font-bold">{money(receipt.amountMinor)}</dd></div><div><dt className="font-semibold">Reference</dt><dd className="break-words">{receipt.reference || "Not recorded"}</dd></div></dl>
    {noncash ? <p className="rounded-lg border p-3 text-sm">This applies money received or paid earlier. No new cash, card or bank payment was recorded.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="text-left font-semibold">Payment methods / accounts</caption><thead><tr><th className="p-2">Method / account</th><th className="p-2">Reference</th><th className="p-2 whitespace-nowrap text-right">Amount</th></tr></thead><tbody>{receipt.tenders.map((part, index) => <tr key={index} className="border-t"><td className="p-2 capitalize">{readable(part.method)}<span className="block break-words text-xs">{[part.bankName, part.accountName, part.accountNumberLast4 ? `••••${part.accountNumberLast4}` : null].filter(Boolean).join(" · ")}</span></td><td className="break-words p-2">{part.reference || "Not recorded"}</td><td className="p-2 whitespace-nowrap text-right">{money(part.amountMinor)}</td></tr>)}</tbody></table></div>}
    {receipt.allocations.length > 0 && <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="text-left font-semibold">Applied to invoices</caption><thead><tr><th className="p-2">Invoice</th><th className="p-2 whitespace-nowrap text-right">Applied</th><th className="p-2 whitespace-nowrap text-right">Still unpaid immediately after</th></tr></thead><tbody>{receipt.allocations.map((line, index) => <tr key={index} className="border-t"><td className="break-words p-2">{line.invoiceNumber || "Reference not recorded"}</td><td className="p-2 whitespace-nowrap text-right">{money(line.amountMinor)}</td><td className="p-2 whitespace-nowrap text-right">{money(line.outstandingAfterMinor)}</td></tr>)}</tbody></table></div>}
    {receipt.arrangements.length > 0 && <section className="text-sm"><h3 className="font-semibold">Customer arrangements</h3>{receipt.arrangements.map((line, index) => <p key={index}>{line.name}: {money(line.amountMinor)}</p>)}</section>}
    <section className="space-y-1 rounded-xl border p-4 text-sm"><h3 className="font-semibold">{receipt.balanceScope}</h3><p>Gross unpaid debt: {money(receipt.outstandingAfterMinor)}</p><p>Unused advances / credits: {money(receipt.advanceAfterMinor)}</p><p className="text-xs text-[var(--muted)]">Historical missing balances are not reconstructed from current balances. Later repayments, refunds and corrections appear separately in the account statement.</p></section>
    {receipt.notes && <p className="whitespace-pre-wrap break-words text-sm">Notes: {receipt.notes}</p>}<p className="break-all text-xs text-[var(--muted)]">Journal: {receipt.journalEntryId || "Not recorded"}. Reprinting this record does not collect money, change debt, issue stock or create another transaction.</p>
    <footer className="flex flex-wrap justify-end gap-3 border-t pt-4" data-no-print><Button variant="secondary" onClick={onClose}>Close</Button><Button onClick={() => window.print()}>Print receipt / save PDF</Button></footer>
  </section></AppDialog>;
}
