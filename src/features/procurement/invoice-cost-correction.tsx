"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { AmountInput } from "@/components/ui/amount-input";
import { callAdministration } from "@/features/administration/api";
import { useBillingOperation } from "@/features/accounting/use-billing-operation";
import { FinancialAction, FinancialInput, FinancialMessage, FinancialText, FinancialValue } from "@/features/finance/financial-privacy";
import { formatNaira, nairaToKobo } from "@/features/inventory/format";
import type { PurchaseOrderItem, SupplierInvoice } from "@/types/domain";

export function InvoiceCostCorrection({ invoice, ownerKey, onComplete, onLock }: { invoice: SupplierInvoice; ownerKey: string; onComplete: () => void; onLock: (locked: boolean) => void }) {
  const [items, setItems] = useState<PurchaseOrderItem[]>([]), [itemId, setItemId] = useState(""), [price, setPrice] = useState(""), [reason, setReason] = useState(""), [error, setError] = useState("");
  const operation = useBillingOperation(`${ownerKey}:supplier-cost:${invoice.id}`);
  const [opened, setOpened] = useState(false);
  const locked = operation.busy || Boolean(operation.pending);
  useEffect(() => { onLock(opened || locked || !operation.ready); }, [opened, locked, operation.ready, onLock]);
  useEffect(() => {
    let active = true;
    void callAdministration<object, { items: PurchaseOrderItem[] }>("getProcurementWorkspace", { view: "order_detail", purchaseOrderId: invoice.purchaseOrderId, ...(invoice.branchId ? { branchId: invoice.branchId } : { warehouseId: invoice.warehouseId }) }).then(result => { if (active) setItems(result.items); }, cause => { if (active) setError(cause instanceof Error ? cause.message : "Order lines unavailable."); });
    return () => { active = false; };
  }, [invoice.purchaseOrderId, invoice.branchId, invoice.warehouseId]);
  const item = items.find(row => row.id === itemId);
  const amount = (() => { try { return nairaToKobo(Number(price)); } catch { return NaN; } })();
  const delta = item ? (amount - item.unitCostMinor) * item.orderedQuantity : NaN;
  const vatDelta = item ? Math.round(amount * item.orderedQuantity * (item.vatRateBasisPoints ?? 0) / 10000) - Math.round(item.unitCostMinor * item.orderedQuantity * (item.vatRateBasisPoints ?? 0) / 10000) : NaN;
  const valid = Boolean(item && Number.isSafeInteger(amount) && amount > 0 && amount !== item.unitCostMinor && reason.trim().length >= 10);
  async function save() {
    if (await operation.run("approveSupplierInvoice", { command: "correct_cost", supplierInvoiceId: invoice.id, purchaseOrderItemId: itemId, expectedUnitCostMinor: item?.unitCostMinor, unitCostMinor: amount, expectedGrossAmountMinor: invoice.grossAmountMinor, reason })) onComplete();
  }
  return <details onToggle={event => setOpened(event.currentTarget.open)} className="mt-3 rounded-lg border p-3"><summary className="cursor-pointer font-semibold">Correct received cost before approval</summary>
    <p className="my-2 text-sm">Correct a fully received, unpaid invoice without receiving the goods again. Quantities and payment records stay unchanged. The original evidence is retained in the audit trail. Stock moved since receipt, split invoices, serial/batch goods and posted invoices require a separate cost reconciliation.</p>
    {(error || operation.error) && <FinancialMessage>{error || operation.error}</FinancialMessage>}
    <fieldset disabled={locked} className="grid gap-3">
      <label>Product<select className="mt-1 w-full rounded border p-2" value={itemId} onChange={event => { setItemId(event.target.value); setPrice(""); }}><option value="">Select invoice product</option>{items.map(row => <option key={row.id} value={row.id}>{row.productName} · {row.sku}</option>)}</select></label>
      {item && <p><FinancialText>{item.orderedQuantity}</FinancialText> units · Current unit cost <FinancialValue>{formatNaira(item.unitCostMinor)}</FinancialValue></p>}
      <label>Correct unit cost (₦)<FinancialInput><AmountInput className="mt-1 w-full rounded border p-2" value={price} onValueChange={setPrice} /></FinancialInput></label>
      <label>Correction reason<textarea className="mt-1 w-full rounded border p-2" value={reason} maxLength={500} onChange={event => setReason(event.target.value)} /></label>
      {valid && <p>Corrected invoice total: <FinancialValue>{formatNaira(invoice.grossAmountMinor + delta + vatDelta)}</FinancialValue>. Quantity change: 0.</p>}
    </fieldset>
    <FinancialAction retry={Boolean(operation.pending)}><Button className="mt-3" disabled={!operation.ready || operation.busy || (!operation.pending && !valid)} onClick={() => void save()}>{operation.pending ? "Retry saved cost correction" : "Save audited cost correction"}</Button></FinancialAction>
    <p className="mt-2 text-xs">This does not approve or pay the invoice. Review the corrected invoice before approving it.</p>
  </details>;
}
