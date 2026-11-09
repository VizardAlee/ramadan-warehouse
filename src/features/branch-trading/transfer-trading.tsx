"use client";
import { AmountInput } from "@/components/ui/amount-input";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FinancialAction, FinancialActionScope, FinancialInput, FinancialMessage, FinancialValue } from "@/features/finance/financial-privacy";
import type { StockTransfer } from "../../../functions/src/transfers/simple-model";
import type { InternalTradeInvoice } from "../../../functions/src/branch-trading/model";

export const tradingField = "mt-1 min-h-12 w-full rounded-xl border bg-white px-3 py-2";
export const tradingPanel = "rounded-2xl border bg-white p-5 sm:p-6";
export const tradeMoney = (minor: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(minor / 100);
export function moneyInputMinor(value: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ""] = value.trim().split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(minor) ? minor : null;
}
export function HQTransferPricing(props: { transfer: StockTransfer; canPrice: boolean; disabled: boolean; onPrice: (lines: { id: string; unitPriceMinor: number }[]) => Promise<void> }) {
  if (!props.transfer.tradeAgreement) return null;
  return <PricingForm key={`${props.transfer.id}:${props.transfer.version}`} {...props} />;
}
function PricingForm({ transfer, canPrice, disabled, onPrice }: Parameters<typeof HQTransferPricing>[0]) {
  const agreement = transfer.tradeAgreement!;
  const [prices, setPrices] = useState<Record<string, string>>(() => Object.fromEntries(transfer.items.map(line => [line.id, agreement.pricesByLineId[line.id] === undefined ? "" : String(agreement.pricesByLineId[line.id]! / 100)])));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const editable = canPrice && transfer.status === "requested";
  async function save() {
    const lines = transfer.items.map(line => ({ id: line.id, unitPriceMinor: moneyInputMinor(prices[line.id] ?? "") }));
    if (lines.some(line => line.unitPriceMinor === null || line.unitPriceMinor <= 0)) { setError("Enter a positive unit price with no more than two decimal places for every item."); return; }
    setBusy(true); setError("");
    try { await onPrice(lines as {id: string; unitPriceMinor: number}[]); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save prices."); }
    finally { setBusy(false); }
  }
  return <FinancialActionScope><section className={tradingPanel} aria-label="Head-office transfer pricing">
    <h3 className="font-semibold">Head-office internal prices</h3>
    <p className="mt-2 text-sm">Good units are charged at these prices when receipt is confirmed. Damaged-unit charges wait for administrator review. Prices cannot change after source confirmation.</p>
    <p className="text-sm">This is internal purchasing, not an external sale or VAT invoice.</p>
    {agreement.pricingStatus === "required" && <p className="mt-2 text-amber-900">Prices are required before source confirmation.</p>}
    <fieldset disabled={disabled || busy} className="mt-4 space-y-3">
      {transfer.items.map(line => <div key={line.id}><label className="block text-sm">{line.productName} · {line.sku}{editable ? <FinancialInput><AmountInput aria-label={`Internal unit price for ${line.productName} (₦)`} className={tradingField} inputMode="decimal" value={prices[line.id] ?? ""} onValueChange={rawAmount => setPrices(old => ({...old, [line.id]: rawAmount}))} /></FinancialInput> : <span className="block font-semibold"><FinancialValue>{agreement.pricesByLineId[line.id] === undefined ? agreement.pricingStatus === "priced" ? "Restricted" : "Not recorded" : tradeMoney(agreement.pricesByLineId[line.id]!)}</FinancialValue></span>}</label></div>)}
      {editable && <FinancialAction><Button type="button" onClick={save}>Save internal prices</Button></FinancialAction>}
    </fieldset>
    {error && <p role="alert"><FinancialMessage>{error}</FinancialMessage></p>}
  </section></FinancialActionScope>;
}
export function TradeInvoiceAmounts({ invoice }: {invoice: InternalTradeInvoice}) {
  return <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">{[["Invoiced", invoice.totalMinor], ["Returned goods credit", invoice.returnedMinor], ["Paid", invoice.paidMinor], [invoice.balanceMinor < 0 ? "Branch credit" : "Outstanding", Math.abs(invoice.balanceMinor)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="font-semibold"><FinancialValue>{tradeMoney(Number(value))}</FinancialValue></dd></div>)}</dl>;
}
export function InternalTradeInvoiceCard({ invoice }: {invoice: InternalTradeInvoice}) {
  return <section className={tradingPanel}><h3 className="font-semibold"><Link href={`/transfers/accounts?invoice=${encodeURIComponent(invoice.id)}`} className="underline">Internal invoice {invoice.number}</Link></h3><p className="my-2 text-sm">{invoice.branchName} · Internal branch purchase, not an external sale or VAT invoice.</p><TradeInvoiceAmounts invoice={invoice} />{invoice.lines.some(line => (line.pendingDamagedQuantity ?? 0) > 0) && <p className="mt-3 text-sm text-amber-900">Damaged arrivals are awaiting administrator review. Their charges are held and excluded from the outstanding balance.</p>}</section>;
}
