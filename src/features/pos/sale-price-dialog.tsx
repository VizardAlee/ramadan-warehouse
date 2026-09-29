"use client";

import type { Ref } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import { formatNaira, nairaToKobo } from "@/features/inventory/format";

const quickReasons = ["Agreed customer price", "Promotion", "Price correction"];

export function SalePriceDialog({
  productName,
  currentPriceMinor,
  salePrice,
  reason,
  onPriceChange,
  onReasonChange,
  onApply,
  onCancel,
  formRef,
}: {
  productName: string;
  currentPriceMinor: number;
  salePrice: string;
  reason: string;
  onPriceChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onApply: () => void;
  onCancel: () => void;
  formRef: Ref<HTMLFormElement>;
}) {
  let enteredMinor = 0;
  try { enteredMinor = nairaToKobo(Number(salePrice)); } catch { /* Native form validation shows the invalid price. */ }
  const changed = enteredMinor !== currentPriceMinor;

  return (
    <AppDialog className="app-dialog-backdrop-high" role="dialog" aria-modal="true" aria-labelledby="sale-price-title">
      <form
        ref={formRef}
        className="app-dialog-panel max-w-md rounded-2xl bg-white p-5 shadow-2xl sm:p-6"
        onSubmit={(event) => { event.preventDefault(); onApply(); }}
      >
        <h2 id="sale-price-title" className="text-xl font-semibold">Price for this sale</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">{productName}. This change affects only the current order, not the branch catalogue.</p>
        <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
          Current catalogue: {formatNaira(currentPriceMinor)}. You can set a higher or lower price for this order only.
        </div>
        <label className="mt-4 block text-sm font-medium">
          Selling price before VAT (₦)
          <input type="number" min="0.01" step="0.01" inputMode="decimal" required value={salePrice} onChange={(event) => onPriceChange(event.target.value)} className="mt-1 w-full rounded-lg border p-3 text-lg" />
        </label>
        {enteredMinor > 0 && changed && (
          <p className="mt-2 text-sm font-semibold text-[var(--brand)]" role="status">New price for this sale: {formatNaira(enteredMinor)}</p>
        )}
        {changed && (
          <div className="mt-4">
            <label htmlFor="sale-price-reason" className="block text-sm font-medium">Reason for price change <span className="text-rose-700">(required)</span></label>
            <p id="sale-price-reason-help" className="mt-1 text-xs text-[var(--muted)]">Choose a reason or type your own. It is saved with the sale for audit.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {quickReasons.map((choice) => (
                <button key={choice} type="button" onClick={() => onReasonChange(choice)} className="min-h-9 rounded-full border border-slate-300 px-3 text-xs font-medium text-slate-700 hover:border-[var(--brand)] hover:text-[var(--brand)]">
                  {choice}
                </button>
              ))}
            </div>
            <textarea id="sale-price-reason" aria-describedby="sale-price-reason-help" required minLength={3} maxLength={300} value={reason} onChange={(event) => onReasonChange(event.target.value)} className="mt-2 w-full rounded-lg border p-3" placeholder="Or enter your own reason" rows={3} />
          </div>
        )}
        <p className="mt-2 text-xs text-[var(--muted)]">A lower price may reduce margin. VAT and the sale total will recalculate; the final price and reason are recorded for audit.</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button type="submit">Apply to sale</Button>
        </div>
      </form>
    </AppDialog>
  );
}
