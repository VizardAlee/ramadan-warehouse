"use client";
import { FinancialAttributes, FinancialDetails, FinancialDocument, FinancialMessage, FinancialPrintAction, FinancialText, FinancialValue } from "@/features/finance/financial-privacy";

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
  return <><Button variant="outline" size="sm" disabled={busy} onClick={() => void open()}>Print receipt</Button>{error && <p role="alert" className="text-sm"><FinancialMessage>{error}</FinancialMessage></p>}{receipt?.id === paymentId && receipt.party === party && <AccountReceiptDialog receipt={receipt} onClose={() => setReceipt(undefined)} />}</>;
}
export function AccountReceiptDialog({ receipt, onClose }: { receipt: Receipt; onClose: () => void }) {
  const dialogRef = useDialogFocus<HTMLElement>(true, onClose);
  const noncash = receipt.direction === "non_cash" || receipt.source === "advance_balance";
  const title = noncash ? "Advance application record" : receipt.purpose === "advance_refund" ? receipt.party === "supplier" ? "Supplier advance / credit refund receipt" : "Advance refund receipt" : receipt.purpose === "advance" ? receipt.party === "customer" ? "Customer deposit receipt" : "Supplier advance receipt" : "Account payment receipt";
  return <FinancialAttributes><AppDialog role="dialog" aria-modal="true" aria-label={title} data-print-document-overlay><section ref={dialogRef} className="app-dialog-panel min-w-0 max-w-3xl space-y-5 [overflow-wrap:anywhere] rounded-2xl bg-white p-5 sm:p-7" data-print-document><FinancialDocument>
    <header className="border-b pb-4"><h2 className="text-xl font-bold"><FinancialText>{receipt.companyName}</FinancialText></h2><h1 className="mt-2 text-2xl font-semibold"><FinancialText>{title}</FinancialText></h1><p className="break-all font-mono"><FinancialText>{receipt.paymentNumber}</FinancialText></p></header>
    <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="font-semibold"><FinancialText>{receipt.party === "customer" ? "Customer" : "Supplier"}</FinancialText></dt><dd><FinancialText>{receipt.partyName || "Name not recorded"}</FinancialText> · <FinancialText>{receipt.partyNumber}</FinancialText></dd></div><div><dt className="font-semibold">Recorded date (Lagos)</dt><dd><FinancialText>{receipt.at ? new Date(receipt.at).toLocaleString("en-NG", { timeZone: "Africa/Lagos" }) : "Not recorded"}</FinancialText></dd></div><div><dt className="font-semibold"><FinancialText>{noncash ? "Advance applied" : receipt.direction === "inflow" ? "Money received by company" : "Money paid by company"}</FinancialText></dt><dd className="text-xl font-bold"><FinancialValue>{money(receipt.amountMinor)}</FinancialValue></dd></div><div><dt className="font-semibold">Reference</dt><dd className="break-words"><FinancialText>{receipt.reference || "Not recorded"}</FinancialText></dd></div></dl>
    {noncash ? <p className="rounded-lg border p-3 text-sm">This applies money received or paid earlier. No new cash, card or bank payment was recorded.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="text-left font-semibold">Payment methods / accounts</caption><thead><tr><th className="p-2">Method / account</th><th className="p-2">Reference</th><th className="p-2 whitespace-nowrap text-right">Amount</th></tr></thead><tbody>{receipt.tenders.map((part, index) => <tr key={index} className="border-t"><td className="p-2 capitalize"><FinancialText>{readable(part.method)}</FinancialText><span className="block break-words text-xs"><FinancialText>{[part.bankName, part.accountName, part.accountNumberLast4 ? `••••${part.accountNumberLast4}` : null].filter(Boolean).join(" · ")}</FinancialText></span></td><td className="break-words p-2"><FinancialText>{part.reference || "Not recorded"}</FinancialText></td><td className="p-2 whitespace-nowrap text-right"><FinancialValue>{money(part.amountMinor)}</FinancialValue></td></tr>)}</tbody></table></div>}
    {receipt.allocations.length > 0 && <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="text-left font-semibold">Applied to invoices</caption><thead><tr><th className="p-2">Invoice</th><th className="p-2 whitespace-nowrap text-right">Applied</th><th className="p-2 whitespace-nowrap text-right">Still unpaid immediately after</th></tr></thead><tbody>{receipt.allocations.map((line, index) => <tr key={index} className="border-t"><td className="break-words p-2"><FinancialText>{line.invoiceNumber || "Reference not recorded"}</FinancialText></td><td className="p-2 whitespace-nowrap text-right"><FinancialValue>{money(line.amountMinor)}</FinancialValue></td><td className="p-2 whitespace-nowrap text-right"><FinancialValue>{money(line.outstandingAfterMinor)}</FinancialValue></td></tr>)}</tbody></table></div>}
    {receipt.arrangements.length > 0 && <section className="text-sm"><h3 className="font-semibold">Customer arrangements</h3>{receipt.arrangements.map((line, index) => <p key={index}><FinancialText>{line.name}</FinancialText>: <FinancialValue>{money(line.amountMinor)}</FinancialValue></p>)}</section>}
    <section className="space-y-1 rounded-xl border p-4 text-sm"><h3 className="font-semibold"><FinancialText>{receipt.balanceScope}</FinancialText></h3><p>Gross unpaid debt: <FinancialValue>{money(receipt.outstandingAfterMinor)}</FinancialValue></p><p>Unused advances / credits: <FinancialValue>{money(receipt.advanceAfterMinor)}</FinancialValue></p><p className="text-xs text-[var(--muted)]">Historical missing balances are not reconstructed from current balances. Later repayments, refunds and corrections appear separately in the account statement.</p></section>
    {receipt.notes && <p className="whitespace-pre-wrap break-words text-sm">Notes: <FinancialDetails>{receipt.notes}</FinancialDetails></p>}<p className="break-all text-xs text-[var(--muted)]">Journal: <FinancialText>{receipt.journalEntryId || "Not recorded"}</FinancialText>. Reprinting this record does not collect money, change debt, issue stock or create another transaction.</p>
    <footer className="flex flex-wrap justify-end gap-3 border-t pt-4" data-no-print><Button variant="secondary" onClick={onClose}>Close</Button><FinancialPrintAction><Button onClick={() => window.print()}>Print receipt / save PDF</Button></FinancialPrintAction></footer>
  </FinancialDocument></section></AppDialog></FinancialAttributes>;
}
