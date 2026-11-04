"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FinancialAction, FinancialActionScope, FinancialInput, FinancialMessage, FinancialValue } from "@/features/finance/financial-privacy";
import { useStockTransferAction, type StockTransferAction } from "@/features/transfers/use-stock-transfer-action";
import type { InternalTradeInvoice, InternalTradeWorkspace } from "../../../functions/src/branch-trading/model";
import { moneyInputMinor, tradeMoney, tradingField, tradingPanel } from "./transfer-trading";

import { DamageReviewForm } from "./damage-review-form";

type Method = "cash" | "bank_transfer";
export function InvoiceTradingActions({ invoice, workspace, owner, scope, onComplete }: {invoice: InternalTradeInvoice; workspace: InternalTradeWorkspace; owner: string; scope: string; onComplete: () => Promise<void>}) {
  const action = useStockTransferAction(owner, scope);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [settling, setSettling] = useState(false);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  async function submit(input?: StockTransferAction) {
    setError(""); setSuccess(""); setSettling(true);
    try { await action.run(input); if (!live.current) return; setSuccess("Internal account updated."); await onComplete(); }
    catch (cause) { if (live.current) setError(cause instanceof Error ? cause.message : "Unable to confirm the result. Retry the saved action."); }
    finally { if (live.current) setSettling(false); }
  }
  const disabled = !action.ready || action.busy || settling || Boolean(action.pending);
  return <div className="space-y-4" data-no-print>
    {(error || action.error) && <p role="alert"><FinancialMessage>{error || action.error}</FinancialMessage></p>}
    {success && <p role="status">{success}</p>}
    {action.pending && <section className={tradingPanel}><p>A previous action needs its result checked. Inputs are locked to prevent a duplicate payment or return.</p>{action.scopeChanged && <p role="alert">Return to the original working location before retrying the saved action.</p>}<FinancialAction retry><Button disabled={action.busy || settling || action.scopeChanged || !action.ready} onClick={() => void submit()}>Retry saved action</Button></FinancialAction></section>}
    {workspace.canReviewDamage && <DamageReviewForm key={`damage:${invoice.version}`} invoice={invoice} disabled={disabled} onSubmit={submit} />}
    {workspace.canRecordPayment && <PaymentForm key={`payment:${invoice.version}`} invoice={invoice} accounts={workspace.accounts} disabled={disabled} onSubmit={submit} />}
    {workspace.canReturn && <ReturnForm key={`return:${invoice.version}`} invoice={invoice} disabled={disabled} onSubmit={submit} />}
  </div>;
}
function PaymentForm({ invoice, accounts, disabled, onSubmit }: {invoice: InternalTradeInvoice; accounts: InternalTradeWorkspace["accounts"]; disabled: boolean; onSubmit: (input: StockTransferAction) => Promise<void>}) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [reference, setReference] = useState("");
  const [sourceMethod, setSourceMethod] = useState<Method>("bank_transfer");
  const [destinationMethod, setDestinationMethod] = useState<Method>("bank_transfer");
  const [sourceBank, setSourceBank] = useState("");
  const [destinationBank, setDestinationBank] = useState("");
  const [existingId, setExistingId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    const amountMinor = moneyInputMinor(amount);
    if (!amountMinor || amountMinor > invoice.balanceMinor) { setError("Enter a positive payment no greater than the outstanding amount."); return; }
    if (!confirmed || !date || !Number.isFinite(new Date(date).getTime()) || reference.trim().length < 2 || (!existingId.trim() && ((sourceMethod === "bank_transfer" && !sourceBank) || (destinationMethod === "bank_transfer" && !destinationBank)))) { setError("Confirm the money has moved, then complete the date, reference and relevant bank accounts."); return; }
    setError("");
    await onSubmit({action: "record_payment", invoiceId: invoice.id, amountMinor, confirmedCompleted: true, paymentDate: new Date(date).toISOString(), reference: reference.trim(), sourceMethod, destinationMethod, ...(sourceMethod === "bank_transfer" && sourceBank ? {sourceBankAccountId: sourceBank} : {}), ...(destinationMethod === "bank_transfer" && destinationBank ? {destinationBankAccountId: destinationBank} : {}), ...(existingId.trim() ? {existingFundsTransferId: existingId.trim()} : {}), idempotencyKey: crypto.randomUUID()});
  }
  return <FinancialActionScope><section className={tradingPanel}><h2 className="font-semibold">Record payment to head office</h2><p className="text-sm">Record money already moved from this branch to head office. This does not send money or create an external sale.</p><p>Outstanding: <FinancialValue>{tradeMoney(Math.max(0, invoice.balanceMinor))}</FinancialValue></p><fieldset disabled={disabled || invoice.balanceMinor <= 0} className="mt-4 space-y-3">
    <label className="block">Amount (₦)<FinancialInput><input aria-label="Internal payment amount (₦)" className={tradingField} inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} /></FinancialInput></label>
    <label className="block">Date money moved<input aria-label="Date money moved" className={tradingField} type="datetime-local" step="0.001" value={date} onChange={event => setDate(event.target.value)} /></label>
    <label className="block">Payment reference<input aria-label="Payment reference" className={tradingField} maxLength={160} value={reference} onChange={event => setReference(event.target.value)} /></label>
    <label className="block">Already-recorded company funds transfer ID (optional)<input aria-label="Already-recorded company funds transfer ID" className={tradingField} value={existingId} onChange={event => setExistingId(event.target.value)} /></label><p className="text-sm">Use the original journal entry ID and exact original date and time to allocate that movement without creating another company funds transfer.</p>
    {!existingId.trim() && <div className="grid gap-4 sm:grid-cols-2"><MethodFields label="Branch source" method={sourceMethod} setMethod={setSourceMethod} account={sourceBank} setAccount={setSourceBank} accounts={accounts.filter(account => account.branchId === invoice.branchId || account.branchId === null)} /><MethodFields label="Head-office destination" method={destinationMethod} setMethod={setDestinationMethod} account={destinationBank} setAccount={setDestinationBank} accounts={accounts.filter(account => account.branchId === invoice.headOfficeBranchId || account.branchId === null)} /></div>}
    <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1" />I confirm this payment has completed and is not a planned transfer.</label>
    <FinancialAction><Button disabled={!confirmed} onClick={save}>Record completed internal payment</Button></FinancialAction>
  </fieldset>{error && <p role="alert">{error}</p>}</section></FinancialActionScope>;
}
function MethodFields({label, method, setMethod, account, setAccount, accounts}: {label: string; method: Method; setMethod: (value: Method) => void; account: string; setAccount: (value: string) => void; accounts: InternalTradeWorkspace["accounts"]}) {
  return <div><label>{label} method<select aria-label={`${label} method`} className={tradingField} value={method} onChange={event => setMethod(event.target.value as Method)}><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option></select></label>{method === "bank_transfer" && <label>{label} bank account<select aria-label={`${label} bank account`} className={tradingField} value={account} onChange={event => setAccount(event.target.value)}><option value="">Select bank account</option>{accounts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}</div>;
}
function ReturnForm({invoice, disabled, onSubmit}: {invoice: InternalTradeInvoice; disabled: boolean; onSubmit: (input: StockTransferAction) => Promise<void>}) {
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [serials, setSerials] = useState<Record<string, string[]>>({});
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const availableLines = invoice.lines.filter(line => line.receivedQuantity > line.returnedQuantity);
  const selectedLines = availableLines.map(line => ({id: line.id, quantity: line.trackingType === "serial" ? (serials[line.id] ?? []).length : Number(quantities[line.id] || 0), serialItemIds: serials[line.id] ?? []})).filter(line => line.quantity !== 0);
  const validQuantities = selectedLines.every(line => Number.isSafeInteger(line.quantity) && line.quantity > 0 && line.quantity <= (availableLines.find(item => item.id === line.id)!.receivedQuantity - availableLines.find(item => item.id === line.id)!.returnedQuantity));
  const creditMinor = selectedLines.reduce((total, line) => total + line.quantity * availableLines.find(item => item.id === line.id)!.unitPriceMinor, 0);
  const validCredit = validQuantities && Number.isSafeInteger(creditMinor) && creditMinor >= 0;
  async function save() {
    const lines = selectedLines;
    if (!confirmed || !validCredit || note.trim().length < 3 || !lines.length || lines.length > 10 || lines.some(line => !Number.isInteger(line.quantity) || line.quantity <= 0 || line.quantity > (availableLines.find(item => item.id === line.id)!.receivedQuantity - availableLines.find(item => item.id === line.id)!.returnedQuantity)) || lines.reduce((sum, line) => sum + line.serialItemIds.length, 0) > 50) { setError("Confirm receipt at the original source, add a note, and select valid quantities (up to 10 products and 50 serial items)."); return; }
    setError(""); await onSubmit({action: "return_goods", invoiceId: invoice.id, confirmedReceived: true, confirmedResellable: true, lines, note: note.trim(), idempotencyKey: crypto.randomUUID()});
  }
  if (!availableLines.length) return null;
  return <FinancialActionScope><section className={tradingPanel}><h2 className="font-semibold">Receive goods returned to head office</h2><p className="text-sm">Only record good, inspected, resellable goods physically received back at the original HQ source. Damaged goods require a separate disposition process. Credit uses the original internal price; company inventory cost stays unchanged. This is not a request to move stock.</p><fieldset disabled={disabled} className="mt-4 space-y-4">{availableLines.map(line => <div key={line.id} className="rounded-xl border p-3"><p className="font-medium">{line.productName} · {line.sku}</p><p className="text-sm">Available to return: {line.receivedQuantity - line.returnedQuantity} · Original unit price: <FinancialValue>{tradeMoney(line.unitPriceMinor)}</FinancialValue></p>{line.trackingType === "serial" ? <div className="max-h-48 space-y-2 overflow-y-auto">{line.serialItemIds.filter(id => !line.returnedSerialItemIds.includes(id)).map(id => <label key={id} className="flex gap-2"><input type="checkbox" checked={(serials[line.id] ?? []).includes(id)} onChange={event => setSerials(old => ({...old, [line.id]: event.target.checked ? [...(old[line.id] ?? []), id] : (old[line.id] ?? []).filter(value => value !== id)}))} />Serial {line.serialNumbers?.[id] ?? id}</label>)}</div> : <label>Quantity received back<input aria-label={`Return quantity for ${line.productName}`} className={tradingField} type="number" min="0" max={line.receivedQuantity - line.returnedQuantity} step="1" value={quantities[line.id] ?? ""} onChange={event => setQuantities(old => ({...old, [line.id]: event.target.value}))} /></label>}</div>)}<p className="font-semibold">Proposed returned-goods credit: <FinancialValue>{validCredit ? tradeMoney(creditMinor) : "Needs review"}</FinancialValue></p><p className="text-sm">Selected quantities × original internal unit prices. This reduces the branch balance; it does not send a cash refund.</p><label className="block">Return note<textarea aria-label="Return note" maxLength={1000} className={tradingField} value={note} onChange={event => setNote(event.target.value)} /></label><label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1" />I confirm these goods are physically back at the original head-office source, inspected and resellable.</label><FinancialAction><Button disabled={!confirmed} onClick={save}>Record received return</Button></FinancialAction></fieldset>{error && <p role="alert">{error}</p>}</section></FinancialActionScope>;
}
