"use client";

import { useRef, useState } from "react";
import { AmountInput } from "@/components/ui/amount-input";
import { Button } from "@/components/ui/button";
import { FinancialAction, FinancialInput, FinancialText, FinancialValue } from "@/features/finance/financial-privacy";
import { formatNaira, nairaToKobo } from "@/features/inventory/format";
import type { PurchaseOrderItem } from "@/types/domain";

/** Submitted quantities are reserved until approval or rejection, not matchable again. */
export function availableForMatching(item: PurchaseOrderItem) {
  return item.matchableQuantity ?? Math.max(0, item.receivedQuantity - (item.invoicedQuantity ?? 0) - (item.pendingInvoiceQuantity ?? 0));
}

export interface InvoiceMatchInput {
  supplierInvoiceNumber: string;
  invoiceDate: string;
  dueDate?: string;
  lines: Array<{ purchaseOrderItemId: string; quantity: number }>;
}

export function SupplierInvoiceMatch({ items, busy, onMatch }: {
  items: PurchaseOrderItem[];
  busy: boolean;
  onMatch: (input: InvoiceMatchInput) => Promise<unknown>;
}) {
  const [number, setNumber] = useState("");
  const [date, setDate] = useState(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
  const [dueDate, setDueDate] = useState("");
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const submitting = useRef(false);
  const lines = items.filter(item => availableForMatching(item) > 0).map(item => {
    const raw = prices[item.id] ?? "";
    let actual: number | null = null;
    try { if (raw.trim()) actual = nairaToKobo(Number(raw)); } catch { /* Invalid prices cannot match. */ }
    return { item, actual, quantity: availableForMatching(item) };
  });
  const invalidAmounts = lines.some(({ item, actual, quantity }) =>
    !Number.isSafeInteger(quantity) || quantity <= 0 ||
    !Number.isSafeInteger(item.unitCostMinor) || item.unitCostMinor < 0 ||
    !Number.isSafeInteger(quantity * item.unitCostMinor) ||
    !Number.isSafeInteger(item.vatRateBasisPoints ?? 0) || (item.vatRateBasisPoints ?? 0) < 0 ||
    (actual !== null && (!Number.isSafeInteger(quantity * actual) || !Number.isSafeInteger(quantity * (actual - item.unitCostMinor)))));
  const differences = lines.some(({ item, actual }) => actual !== null && actual !== item.unitCostMinor);
  const reason = number.trim().length < 2 || number.trim().length > 160 ? "Enter the supplier's actual invoice number (2–160 characters)."
    : !date ? "Enter the supplier invoice date."
    : dueDate && dueDate < date ? "Payment due date cannot be before the supplier invoice date."
    : !lines.length ? "No received goods remain to invoice."
    : invalidAmounts ? "The quantities or prices cannot be safely matched. Ask purchasing / finance to review this order."
    : lines.some(line => line.actual === null) ? "Enter each actual supplier unit price with no more than two decimal places."
    : differences ? "Supplier prices differ from the purchase order. Resolve the differences before matching."
    : !confirmed ? "Confirm the quantities and VAT also match the supplier invoice." : undefined;
  async function submit() {
    if (busy || submitting.current || reason) return;
    submitting.current = true;
    try {
      await onMatch({ supplierInvoiceNumber: number.trim(), invoiceDate: date, dueDate: dueDate || undefined,
        lines: lines.map(({ item, quantity }) => ({ purchaseOrderItemId: item.id, quantity })) });
    } finally { submitting.current = false; }
  }
  return <fieldset disabled={busy} className="mt-4 space-y-3 border-t pt-4">
    <legend className="font-semibold">Check supplier invoice prices</legend>
    <p className="text-sm text-[var(--muted)]">Enter the actual net unit prices from the supplier invoice, before VAT. This check does not change stock cost or accounting. Only matching prices can be submitted. This action matches all received quantities still available for matching shown below, excluding invoices awaiting approval; do not proceed if the invoice covers only some of them.</p>
    <div className="grid gap-3 md:grid-cols-3">
      <label className="text-sm">Supplier invoice number<input maxLength={160} value={number} onChange={event => setNumber(event.target.value)} className="block min-h-10 w-full rounded-lg border px-3" /></label>
      <label className="text-sm">Invoice date<input type="date" value={date} onChange={event => setDate(event.target.value)} className="block min-h-10 w-full rounded-lg border px-3" /></label>
      <label className="text-sm">Payment due date (optional)<input type="date" min={date} value={dueDate} onChange={event => setDueDate(event.target.value)} className="block min-h-10 w-full rounded-lg border px-3" /></label>
    </div>
    {lines.map(({ item, actual, quantity }) => <div key={item.id} className="rounded-lg border p-3 text-sm">
      <p className="font-medium"><FinancialText>{item.productName}</FinancialText></p>
      <p>Quantity to match: {quantity} · PO unit price: <FinancialValue>{formatNaira(item.unitCostMinor)}</FinancialValue> · PO VAT: <FinancialValue>{(item.vatRateBasisPoints ?? 0) / 100}%</FinancialValue></p>
      <label className="mt-2 block">Actual supplier unit price (₦) for <FinancialText>{item.productName}</FinancialText><FinancialInput><AmountInput type="number" min="0" step="0.01" value={prices[item.id] ?? ""} onValueChange={value => { setPrices(previous => ({ ...previous, [item.id]: value })); setConfirmed(false); }} className="mt-1 block min-h-10 w-full rounded-lg border px-3" /></FinancialInput></label>
      {!invalidAmounts && actual !== null && actual !== item.unitCostMinor && <p role="status" className="mt-2 text-amber-900">Price difference: <FinancialValue>{formatNaira(actual - item.unitCostMinor)}</FinancialValue> per unit; <FinancialValue>{formatNaira((actual - item.unitCostMinor) * quantity)}</FinancialValue> before VAT for these goods. Review required.</p>}
    </div>)}
    {differences && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm">Invoice price review required. Nothing has been submitted or saved by this check. Ask purchasing / finance to resolve the difference with the supplier using the authorized correction process, then reopen this order. Do not replace the actual price just to match the PO. This screen cannot approve a variance or revalue stock.</p>}
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />The quantities and VAT shown above match the actual supplier invoice, with no additional charges or discounts.</label>
    <FinancialAction><Button aria-busy={busy} disabled={busy || Boolean(reason)} disabledReason={reason} onClick={() => void submit()}>Match received goods to invoice</Button></FinancialAction>
  </fieldset>;
}
