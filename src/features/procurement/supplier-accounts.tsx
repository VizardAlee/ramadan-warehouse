"use client";

import { useEffect, useRef, useState } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import { CursorTablePagination } from "@/components/ui/table-pagination";
import { callAdministration } from "@/features/administration/api";
import { downloadCsv, formatNaira, nairaToKobo } from "@/features/inventory/format";
import type { Supplier, SupplierInvoice } from "@/types/domain";

interface Scope { branchId?: string; warehouseId?: string }
interface Bank { id: string; bankName: string; accountName: string; accountNumberLast4: string }
interface Entry { id: string; entryType: string; referenceNumber: string; amountMinor: number; advanceAmountMinor?: number; effectiveAt: { _seconds?: number; seconds?: number }; journalEntryId?: string }
interface Statement {
  entries: Entry[]; nextCursor: string | null; scopeNote: string;
  openingPayableMinor: number; closingPayableMinor: number;
  openingAdvanceMinor: number; closingAdvanceMinor: number;
}
const labels: Record<string, string> = {
  supplier_invoice: "Invoice approved", supplier_payment: "Payment made",
  supplier_advance: "Advance paid", supplier_advance_applied: "Advance applied to invoice",
  supplier_advance_refund: "Advance / credit refunded by supplier",
  supplier_return: "Goods returned — supplier credit note",
};

interface Payables {
  asOfDate: string; totalOutstandingMinor: number; note: string;
  aging: Array<{ name: string; amountMinor: number }>;
  invoices: SupplierInvoice[]; nextCursor: string | null;
}
function SupplierPayables({ supplierId, scope, canPay, onPay }: {
  supplierId: string; scope: Scope; canPay: boolean; onPay: (invoice: SupplierInvoice) => void;
}) {
  const [limit, setLimit] = useState(25);
  const [pages, setPages] = useState<Array<string | null>>([null]);
  const [response, setResponse] = useState<{ key: string; data?: Payables; error?: string }>();
  const cursor = pages.at(-1);
  const key = JSON.stringify([supplierId, scope, limit, cursor]);
  const data = response?.key === key ? response.data : undefined;
  const error = response?.key === key ? response.error : undefined;
  useEffect(() => {
    let active = true;
    void callAdministration<object, Payables>("getProcurementWorkspace", { view: "supplier_payables", supplierId, ...scope, limit, cursor: cursor || undefined })
      .then((value) => { if (active) setResponse({ key, data: value }); })
      .catch((cause) => { if (active) setResponse({ key, error: cause instanceof Error ? cause.message : "Unpaid supplier invoices could not be loaded." }); });
    return () => { active = false; };
  }, [supplierId, scope, limit, cursor, key]);
  return <section aria-label="Supplier unpaid invoices" className="mt-4 space-y-3 rounded-xl border p-4">
    <h3 className="font-semibold">Unpaid invoices &amp; debt aging</h3>
    {error && <p role="alert" className="text-red-800">{error}</p>}
    {!data && !error && <p role="status">Loading unpaid invoices…</p>}
    {data && <>
      <p className="text-sm">Outstanding approved invoices: <strong className="finance-attention">{formatNaira(data.totalOutstandingMinor)}</strong> · as at {data.asOfDate}</p>
      <p className="text-xs text-[var(--muted)]">{data.note}</p>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">{data.aging.map((bucket) => <div className="rounded-lg bg-slate-50 p-3" key={bucket.name}><p className="text-xs">{bucket.name}</p><strong className={bucket.name === "Current" ? "finance-balance" : "finance-attention"}>{formatNaira(bucket.amountMinor)}</strong></div>)}</div>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Invoice</th><th className="p-2">Invoice date</th><th className="p-2">Due date</th><th className="p-2 text-right">Still owed</th><th className="p-2">Action</th></tr></thead><tbody>
        {data.invoices.map((invoice) => <tr className="border-t" key={invoice.id}><td className="p-2">{invoice.supplierInvoiceNumber}</td><td className="p-2 whitespace-nowrap">{invoice.invoiceDate ?? "Not recorded"}</td><td className={`p-2 whitespace-nowrap ${invoice.dueDate && invoice.dueDate < data.asOfDate ? "finance-outflow" : ""}`}>{invoice.dueDate ?? "Not recorded"}</td><td className="p-2 text-right finance-attention">{formatNaira(invoice.outstandingAmountMinor)}</td><td className="p-2">{canPay && <Button variant="outline" onClick={() => onPay(invoice)}>Pay / apply advance</Button>}</td></tr>)}
        {!data.invoices.length && <tr><td colSpan={5} className="p-3">No approved unpaid invoices.</td></tr>}
      </tbody></table></div>
      <CursorTablePagination page={pages.length} pageSize={limit} rowCount={data.invoices.length} hasNextPage={Boolean(data.nextCursor)} loading={false} onPrevious={() => setPages((value) => value.slice(0, -1))} onNext={() => { if (data.nextCursor) setPages((value) => [...value, data.nextCursor]); }} onPageSizeChange={(size) => { setLimit(size); setPages([null]); }} itemLabel="unpaid invoices" />
    </>}
  </section>;
}

function SupplierStatement({ supplierId, scope }: { supplierId: string; scope: Scope }) {
  const [from, setFrom] = useState("");
  const [through, setThrough] = useState("");
  const [limit, setLimit] = useState(25);
  const [pages, setPages] = useState<Array<string | null>>([null]);
  const [response, setResponse] = useState<{ key: string; data?: Statement; error?: string }>();
  const cursor = pages.at(-1);
  const key = JSON.stringify([supplierId, scope, from, through, limit, cursor]);
  const data = response?.key === key ? response.data : undefined;
  const error = response?.key === key ? response.error : undefined;
  useEffect(() => {
    let active = true;
    void callAdministration<object, Statement>("getProcurementWorkspace", {
      view: "supplier_account", supplierId, ...scope, from: from || undefined,
      through: through || undefined, limit, cursor: cursor || undefined,
    }).then((result) => { if (active) setResponse({ key, data: result }); })
      .catch((cause) => { if (active) setResponse({ key, error: cause instanceof Error ? cause.message : "Supplier history could not be loaded." }); });
    return () => { active = false; };
  }, [supplierId, scope, from, through, limit, cursor, key]);
  return <section aria-label="Supplier account statement" className="mt-4 space-y-3">
    <div className="grid gap-3 sm:grid-cols-2">
      <label>From<input aria-label="Supplier statement from" type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPages([null]); }} className="mt-1 w-full rounded-lg border p-2" /></label>
      <label>Through<input aria-label="Supplier statement through" type="date" value={through} onChange={(event) => { setThrough(event.target.value); setPages([null]); }} className="mt-1 w-full rounded-lg border p-2" /></label>
    </div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
    {!data && !error && <p role="status">Loading supplier statement…</p>}
    {data && <>
      <p className="text-xs text-[var(--muted)]">{data.scopeNote} Dates use Nigerian business time. Totals cover the full selected period, not just this page.</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[ ["Opening payable", data.openingPayableMinor], ["Closing payable", data.closingPayableMinor], ["Opening advance", data.openingAdvanceMinor], ["Closing advance", data.closingAdvanceMinor] ].map(([label, amount]) => <div key={String(label)} className="rounded-lg bg-slate-50 p-3"><p className="text-xs">{label}</p><strong className={String(label).includes("payable") ? "finance-attention" : "finance-balance"}>{formatNaira(Number(amount))}</strong></div>)}
      </div>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Date</th><th className="p-2">Activity / reference</th><th className="p-2 text-right">Payable change</th><th className="p-2 text-right">Advance change</th></tr></thead><tbody>
        {data.entries.map((entry) => <tr key={entry.id} className="border-t"><td className="p-2 whitespace-nowrap">{new Date(Number(entry.effectiveAt?._seconds ?? entry.effectiveAt?.seconds ?? 0) * 1000).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos" })}</td><td className="p-2">{labels[entry.entryType] ?? entry.entryType.replaceAll("_", " ")}<small className="block text-[var(--muted)]">{entry.referenceNumber}</small></td><td className={`p-2 text-right ${entry.amountMinor > 0 ? "finance-attention" : "finance-income"}`}>{formatNaira(entry.amountMinor)}</td><td className="p-2 text-right finance-balance">{formatNaira(entry.advanceAmountMinor ?? 0)}</td></tr>)}
        {!data.entries.length && <tr><td colSpan={4} className="p-4">No supplier activity in this period.</td></tr>}
      </tbody></table></div>
      <p className="text-xs text-[var(--muted)]">A positive payable change increases what we owe. A negative change reduces it. Advances remain separate from debt until applied.</p>
      <CursorTablePagination page={pages.length} pageSize={limit} rowCount={data.entries.length} hasNextPage={Boolean(data.nextCursor)} loading={false} onPrevious={() => setPages((value) => value.slice(0, -1))} onNext={() => { if (data.nextCursor) setPages((value) => [...value, data.nextCursor]); }} onPageSizeChange={(size) => { setLimit(size); setPages([null]); }} itemLabel="supplier entries" />
      <Button variant="outline" disabled={!data.entries.length} onClick={() => downloadCsv("supplier-statement-page.csv", data.entries.map((entry) => ({ activity: labels[entry.entryType] ?? entry.entryType, reference: entry.referenceNumber, payableChangeNaira: entry.amountMinor / 100, advanceChangeNaira: (entry.advanceAmountMinor ?? 0) / 100, journal: entry.journalEntryId ?? "" })))}>Export this page</Button>
    </>}
  </section>;
}

function SupplierPaymentDialog({ supplier, invoice, refund = false, scope, banks, branches, onClose, onComplete }: {
  supplier: Supplier; invoice?: SupplierInvoice; refund?: boolean; scope: Scope; banks: Bank[];
  branches: Array<{ id: string; name: string }>; onClose: () => void; onComplete: () => void;
}) {
  const [amount, setAmount] = useState(invoice ? String(invoice.outstandingAmountMinor / 100) : "");
  const [source, setSource] = useState<"disbursement" | "advance_balance">("disbursement");
  const [method, setMethod] = useState<"cash" | "card" | "bank_transfer">("bank_transfer");
  const [bankAccountId, setBank] = useState("");
  const [branchId, setBranch] = useState(invoice?.branchId ?? scope.branchId ?? "");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<Record<string, unknown> | null>(null);
  let amountMinor = 0;
  let amountError = "";
  try { amountMinor = nairaToKobo(Number(amount)); }
  catch { amountError = "Enter an amount with no more than two decimal places."; }
  const paymentScope = invoice ? { branchId: invoice.branchId, warehouseId: invoice.warehouseId }
    : scope.warehouseId ? scope : { branchId };
  const scopeKey = paymentScope.branchId ? `branch:${paymentScope.branchId}` : `warehouse:${paymentScope.warehouseId}`;
  const availableAdvance = supplier.advanceBalancesByLocation?.[scopeKey] ?? 0;
  const valid = Number.isSafeInteger(amountMinor) && amountMinor > 0 &&
    (!refund || (amountMinor <= availableAdvance && Boolean(notes.trim()))) &&
    (!invoice || amountMinor <= invoice.outstandingAmountMinor) && Boolean(paymentScope.branchId || paymentScope.warehouseId) &&
    (source === "advance_balance" ? amountMinor <= availableAdvance : method === "cash" || Boolean(bankAccountId && reference.trim()));
  async function submit() {
    if (!valid && !pending.current) return;
    setBusy(true); setError(""); setUncertain(true);
    pending.current ??= {
      supplierId: supplier.id, purpose: refund ? "advance_refund" : invoice ? "payment" : "advance", source, ...paymentScope,
      method, bankAccountId: source === "disbursement" && method !== "cash" ? bankAccountId : undefined,
      reference: reference || undefined, notes: notes || undefined,
      amountMinor: invoice ? undefined : amountMinor,
      allocations: invoice ? [{ supplierInvoiceId: invoice.id, amountMinor }] : [],
      paidAt: new Date().toISOString(), idempotencyKey: crypto.randomUUID(),
    };
    try {
      await callAdministration("recordSupplierPayment", pending.current);
      onComplete();
    } catch (cause) {
      const code = typeof cause === "object" && cause && "diagnosticCode" in cause ? String(cause.diagnosticCode) : "";
      if (["functions/invalid-argument", "functions/failed-precondition", "functions/permission-denied", "functions/not-found", "functions/unauthenticated", "functions/aborted"].includes(code)) { pending.current = null; setUncertain(false); }
      setError(cause instanceof Error ? cause.message : "Supplier payment could not be confirmed.");
    } finally { setBusy(false); }
  }
  return <AppDialog role="dialog" aria-modal="true" aria-labelledby="supplier-payment-title"><div className="app-dialog-panel w-full max-w-lg rounded-2xl bg-white p-6">
    <h2 id="supplier-payment-title" className="text-xl font-semibold">{refund ? "Receive supplier advance refund" : invoice ? "Pay supplier invoice" : "Record supplier advance"}</h2>
    <p className="mt-2 text-sm text-[var(--muted)]">{supplier.name}{refund ? " · money returned to the company" : invoice ? ` · ${invoice.supplierInvoiceNumber}` : " · money paid before invoice settlement"}</p>
    {refund && <p className="mt-3 rounded-lg bg-blue-50 p-3 text-sm">Record only money actually returned by the supplier. Unused advance / supplier credit in this store: {formatNaira(availableAdvance)}. This reduces that credit balance, not invoice debt, and does not return goods or change stock. Goods must be recorded separately under Returns &amp; credit notes.</p>}
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
    {uncertain && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm">Details are locked until the result is confirmed. Retry the same transaction; do not record the money again. If this page is closed, check supplier history first.</p>}
    <fieldset disabled={busy || uncertain} className="mt-4 space-y-3">
      {!paymentScope.warehouseId && <label className="block text-sm">Funding / recording store<select aria-label="Supplier payment store" disabled={Boolean(invoice)} value={branchId} onChange={(event) => setBranch(event.target.value)} className="mt-1 w-full rounded-lg border p-3"><option value="">Choose store</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}
      {invoice && <label className="block text-sm">Payment source<select aria-label="Payment source" value={source} onChange={(event) => setSource(event.target.value as typeof source)} className="mt-1 w-full rounded-lg border p-3"><option value="disbursement">New company payment</option><option value="advance_balance">Apply unused supplier advance</option></select><small className="block">Unused advance in this store: {formatNaira(availableAdvance)}. Applying it does not pay money twice.</small></label>}
      <label className="block text-sm">Amount (₦)<input aria-label="Supplier payment amount" type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} className="mt-1 w-full rounded-lg border p-3" /></label>
      {amountError && <p role="alert" className="text-sm text-red-800">{amountError}</p>}
      {source === "disbursement" && <>
        <label className="block text-sm">Payment method<select aria-label="Supplier payment method" value={method} onChange={(event) => setMethod(event.target.value as typeof method)} className="mt-1 w-full rounded-lg border p-3"><option value="bank_transfer">Bank transfer</option><option value="card">Card / POS</option><option value="cash">Cash</option></select></label>
        {method !== "cash" && <label className="block text-sm">{refund ? "Company account money received into" : "Company account paid from"}<select aria-label={refund ? "Supplier refund receiving account" : "Supplier funding account"} value={bankAccountId} onChange={(event) => setBank(event.target.value)} className="mt-1 w-full rounded-lg border p-3"><option value="">Choose account</option>{banks.map((bank) => <option key={bank.id} value={bank.id}>{bank.bankName} · {bank.accountName} · ••••{bank.accountNumberLast4}</option>)}</select></label>}
        <label className="block text-sm">Payment reference{method === "cash" ? " (optional)" : ""}<input value={reference} onChange={(event) => setReference(event.target.value)} className="mt-1 w-full rounded-lg border p-3" /></label>
      </>}
      <label className="block text-sm">{refund ? "Refund reason (required)" : "Notes (optional)"}<textarea value={notes} maxLength={500} onChange={(event) => setNotes(event.target.value)} className="mt-1 w-full rounded-lg border p-3" /></label>
    </fieldset>
    <div className="mt-5 flex flex-wrap justify-end gap-2 border-t pt-4"><Button variant="outline" disabled={busy || uncertain} onClick={onClose}>Cancel</Button><Button disabled={busy || (!valid && !uncertain)} onClick={() => void submit()}>{uncertain ? "Retry same transaction" : refund ? "Record refund received" : source === "advance_balance" ? "Apply advance" : invoice ? "Record payment" : "Record advance"}</Button></div>
  </div></AppDialog>;
}

export function SupplierAccounts({ suppliers, scope, banks, branches, canPay, invoice, closeInvoice, onComplete }: {
  suppliers: Supplier[]; scope: Scope; banks: Bank[]; branches: Array<{ id: string; name: string }>;
  canPay: boolean; invoice: SupplierInvoice | null; closeInvoice: () => void; onComplete: () => void;
}) {
  const [supplierId, setSupplierId] = useState("");
  const [advanceSupplier, setAdvanceSupplier] = useState<string | null>(null);
  const [refund, setRefund] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<SupplierInvoice | null>(null);
  const [refresh, setRefresh] = useState(0);
  const selected = suppliers.find((supplier) => supplier.id === supplierId);
  const activeInvoice = invoice ?? selectedInvoice;
  const paying = suppliers.find((supplier) => supplier.id === (activeInvoice?.supplierId ?? advanceSupplier));
  function close() { setAdvanceSupplier(null); setRefund(false); setSelectedInvoice(null); closeInvoice(); }
  return <section className="rounded-xl border bg-white p-5">
    <h2 className="text-xl font-semibold">Supplier accounts &amp; statements</h2>
    <p className="text-sm text-[var(--muted)]">Payables and unused advances / supplier credits are separate. Filter history below; invoice payments support part payment. Return-credit balances can be applied to another invoice in the same store or refunded through Receive advance refund.</p>
    <div className="mt-3 flex flex-wrap gap-3"><label className="min-w-0 flex-1 text-sm">Supplier<select aria-label="Supplier account" value={supplierId} onChange={(event) => setSupplierId(event.target.value)} className="mt-1 w-full rounded-lg border p-3"><option value="">Choose supplier</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.supplierNumber} · {supplier.name}{supplier.active ? "" : " (inactive)"}</option>)}</select></label>{canPay && selected?.active && <Button className="self-end" onClick={() => { setRefund(false); setAdvanceSupplier(selected.id); }}>Record advance</Button>}{canPay && selected && (selected.advanceBalanceMinor ?? 0) > 0 && <Button variant="outline" className="self-end" onClick={() => { setRefund(true); setAdvanceSupplier(selected.id); }}>Receive advance refund</Button>}</div>
    {selected && <SupplierPayables key={`payables-${JSON.stringify([selected.id, scope, refresh])}`} supplierId={selected.id} scope={scope} canPay={canPay} onPay={setSelectedInvoice} />}
    {selected && <SupplierStatement key={JSON.stringify([selected.id, scope, refresh])} supplierId={selected.id} scope={scope} />}
    {paying && <SupplierPaymentDialog key={activeInvoice?.id ?? `${refund ? "refund" : "advance"}-${paying.id}`} supplier={paying} invoice={activeInvoice ?? undefined} refund={refund && !activeInvoice} scope={scope} banks={banks} branches={branches} onClose={close} onComplete={() => { close(); setRefresh((value) => value + 1); onComplete(); }} />}
  </section>;
}
