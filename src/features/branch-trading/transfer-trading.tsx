"use client";
import { AmountInput } from "@/components/ui/amount-input";

import Link from "next/link";
import { useState } from "react";
import { allocateTransport } from "../../../functions/src/branch-trading/landed-cost";
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
export interface TransportPricing { totalMinor:number; payer:"source"|"destination"; payee:string; reference:string; expenseNumber:string; allocationByLineId?:Record<string,number> }
export function HQTransferPricing(props: { transfer: StockTransfer; canPrice: boolean; disabled: boolean; onPrice: (lines: { id: string; unitPriceMinor: number }[], transport?:TransportPricing) => Promise<void> }) {
  if (!props.transfer.tradeAgreement) return null;
  return <PricingForm key={`${props.transfer.id}:${props.transfer.version}`} {...props} />;
}
function PricingForm({ transfer, canPrice, disabled, onPrice }: Parameters<typeof HQTransferPricing>[0]) {
  const agreement = transfer.tradeAgreement!;
  const [prices, setPrices] = useState<Record<string, string>>(() => Object.fromEntries(transfer.items.map(line => [line.id, agreement.pricesByLineId[line.id] === undefined ? "" : String(agreement.pricesByLineId[line.id]! / 100)])));
  const savedTransport = agreement.transport;
  const [transportAmount,setTransportAmount] = useState(String((savedTransport?.totalMinor ?? 0)/100));
  const [payer,setPayer] = useState<"source"|"destination">(savedTransport?.payer ?? "destination");
  const [payee,setPayee] = useState(savedTransport?.payee ?? "");
  const [reference,setReference] = useState(savedTransport?.reference ?? "");
  const [expenseNumber,setExpenseNumber] = useState(savedTransport?.expenseNumber ?? "");
  const [manual,setManual] = useState(false);
  const [allocations,setAllocations] = useState<Record<string,string>>(()=>Object.fromEntries(transfer.items.map(line=>[line.id,String((savedTransport?.allocationByLineId[line.id] ?? 0)/100)])));
  let preview:Record<string,number> = {};
  let allocationError = "";
  try {
    const amount=moneyInputMinor(transportAmount);
    if(amount===null) throw new Error("Enter a valid transport amount.");
    const weights=transfer.items.map(line=>({id:line.id,weight:(moneyInputMinor(prices[line.id] ?? "") ?? 0)*line.requested}));
    const override=manual?Object.fromEntries(transfer.items.map(line=>{const value=moneyInputMinor(allocations[line.id] ?? "");if(value===null)throw new Error("Enter each manual transport allocation.");return [line.id,value];})):undefined;
    preview=allocateTransport(amount,weights,override);
  } catch(cause) { allocationError=cause instanceof Error?cause.message:"Check the allocation."; }
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const editable = canPrice && transfer.status === "requested";
  async function save() {
    const lines = transfer.items.map(line => ({ id: line.id, unitPriceMinor: moneyInputMinor(prices[line.id] ?? "") }));
    if (lines.some(line => line.unitPriceMinor === null || line.unitPriceMinor <= 0)) { setError("Enter a positive unit price with no more than two decimal places for every item."); return; }
    if(allocationError) {setError(allocationError);return;}
    const totalMinor=moneyInputMinor(transportAmount)!;
    if(totalMinor>0 && (!payee.trim() || !reference.trim() || !expenseNumber.trim())) {setError("Enter the transporter, external reference and approved expense number.");return;}
    setBusy(true); setError("");
    try {
      const pricedLines = lines as {id: string; unitPriceMinor: number}[];
      if (totalMinor > 0) await onPrice(pricedLines,{totalMinor,payer,payee:payee.trim(),reference:reference.trim(),expenseNumber:expenseNumber.trim(),...(manual?{allocationByLineId:preview}:{})});
      else await onPrice(pricedLines);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save prices."); }
    finally { setBusy(false); }
  }
  return <FinancialActionScope><section className={tradingPanel} aria-label="Interbranch transfer pricing">
    <h3 className="font-semibold">Interbranch internal prices</h3>
    <p className="mt-2 text-sm">Good units are charged at these prices when receipt is confirmed. Damaged-unit charges wait for administrator review. Prices cannot change after source confirmation.</p>
    <p className="text-sm">This is internal purchasing, not an external sale or VAT invoice.</p>
    {agreement.pricingStatus === "required" && <p className="mt-2 text-amber-900">Prices are required before source confirmation.</p>}
    <fieldset disabled={disabled || busy} className="mt-4 space-y-3">
      {transfer.items.map(line => <div key={line.id}><label className="block text-sm">{line.productName} · {line.sku}{editable ? <FinancialInput><AmountInput aria-label={`Internal unit price for ${line.productName} (₦)`} className={tradingField} inputMode="decimal" value={prices[line.id] ?? ""} onValueChange={rawAmount => setPrices(old => ({...old, [line.id]: rawAmount}))} /></FinancialInput> : <span className="block font-semibold"><FinancialValue>{agreement.pricesByLineId[line.id] === undefined ? agreement.pricingStatus === "priced" ? "Restricted" : "Not recorded" : tradeMoney(agreement.pricesByLineId[line.id]!)}</FinancialValue></span>}</label></div>)}
      <div className="rounded-xl border p-3 space-y-3">
        <h4 className="font-semibold">External transportation cost</h4>
        <p className="text-sm">Receiving branch cost = transfer price + allocated transport. Company cost excludes internal markup. Record and approve transportation once in Expenses, then link its EXP number here. Saving does not make a bank payment or duplicate the expense.</p>
        <p className="text-sm">Prices and transport freeze after source confirmation. Late costs, refunds or allocation changes need administrator review.</p>
        {editable ? <>
          <label className="block text-sm">Transport total (₦)<FinancialInput><AmountInput className={tradingField} value={transportAmount} onValueChange={setTransportAmount} /></FinancialInput></label>
          <label className="block text-sm">Transport payer<select className={tradingField} value={payer} onChange={event=>setPayer(event.target.value as "source"|"destination")}><option value="destination">Receiving branch pays transporter directly</option><option value="source">Supplying branch pays, receiving branch reimburses</option></select></label>
          <label className="block text-sm">Transporter / payee<input maxLength={160} className={tradingField} value={payee} onChange={event=>setPayee(event.target.value)} /></label>
          <label className="block text-sm">External invoice / cost reference<input maxLength={160} className={tradingField} value={reference} onChange={event=>setReference(event.target.value)} /></label>
          <label className="block text-sm">Approved logistics expense number<input maxLength={160} placeholder="EXP-…" className={tradingField} value={expenseNumber} onChange={event=>setExpenseNumber(event.target.value)} /></label>
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={manual} onChange={event=>setManual(event.target.checked)} /> Override proportional line-value allocation</label>
          {transfer.items.map(line=><div key={line.id} className="text-sm"><p>{line.productName} · planned quantity {line.requested}</p>{manual && <FinancialInput><AmountInput aria-label={`Transport allocation for ${line.productName} (₦)`} className={tradingField} value={allocations[line.id] ?? ""} onValueChange={value=>setAllocations(old=>({...old,[line.id]:value}))} /></FinancialInput>}{preview[line.id]!==undefined && line.requested>0 && <FinancialValue>Transport: {tradeMoney(preview[line.id]!)} · average receiving cost/unit: {tradeMoney((moneyInputMinor(prices[line.id] ?? "") ?? 0)+preview[line.id]!/line.requested)}</FinancialValue>}</div>)}
          {allocationError && <p role="status" className="text-amber-900">{allocationError}</p>}
          <p className="text-xs">Partial receipts consume only their allocated share. Per-unit previews are averages; stored totals retain every kobo.</p>
        </> : savedTransport ? <FinancialValue><p>Total {tradeMoney(savedTransport.totalMinor)} · {savedTransport.payer === "source" ? "Supplying branch pays; recharge due" : "Receiving branch pays directly; no supplier recharge"}</p><p>{savedTransport.payee} · {savedTransport.reference} · {savedTransport.expenseNumber}</p>{transfer.items.map(line=><p key={line.id}>{line.productName}: transport {tradeMoney(savedTransport.allocationByLineId[line.id] ?? 0)}</p>)}</FinancialValue> : <p className="text-sm">No transport plan recorded. Legacy receipts are unchanged.</p>}
      </div>
      {editable && <FinancialAction><Button type="button" onClick={save}>Save prices and transport plan</Button></FinancialAction>}
    </fieldset>
    {error && <p role="alert"><FinancialMessage>{error}</FinancialMessage></p>}
  </section></FinancialActionScope>;
}
export function TradeInvoiceAmounts({ invoice }: {invoice: InternalTradeInvoice}) {
  return <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">{[["Invoiced", invoice.totalMinor], ["Returned goods credit", invoice.returnedMinor], ["Paid", invoice.paidMinor], [invoice.balanceMinor < 0 ? "Branch credit" : "Outstanding", Math.abs(invoice.balanceMinor)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="font-semibold"><FinancialValue>{tradeMoney(Number(value))}</FinancialValue></dd></div>)}</dl>;
}
export function InternalTradeInvoiceCard({ invoice }: {invoice: InternalTradeInvoice}) {
  return <section className={tradingPanel}><h3 className="font-semibold"><Link href={`/transfers/accounts?invoice=${encodeURIComponent(invoice.id)}`} className="underline">Internal invoice {invoice.number}</Link></h3><p className="my-2 text-sm">{invoice.headOfficeBranchName ?? invoice.headOfficeBranchId} → {invoice.branchName} · Internal branch purchase, not an external sale or VAT invoice.</p><TradeInvoiceAmounts invoice={invoice} />{invoice.lines.some(line => (line.pendingDamagedQuantity ?? 0) > 0) && <p className="mt-3 text-sm text-amber-900">Damaged arrivals are awaiting administrator review. Their charges are held and excluded from the outstanding balance.</p>}</section>;
}
