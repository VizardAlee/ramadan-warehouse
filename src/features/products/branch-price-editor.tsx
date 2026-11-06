"use client";
import { useState, type FormEvent } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";
import { FinancialAction, FinancialActionScope, FinancialInput, FinancialMessage, FinancialText, FinancialValue } from "@/features/finance/financial-privacy";
import { callAdministration } from "@/features/administration/api";
import { formatNaira, nairaToKobo } from "@/features/inventory/format";
import { resolveCatalogPrice, type BranchSalesPrice, type CentralSalesPrice } from "../../../functions/src/sales/pricing";

export interface BranchPriceRecord extends BranchSalesPrice { id: string; productId: string; branchId: string }
export function BranchPriceEditor({ branchId, branchName, productId, productName, central, current, onClose, onSaved }: {
  branchId: string; branchName: string; productId: string; productName: string;
  central: CentralSalesPrice | null; current: BranchSalesPrice; onClose: () => void; onSaved: () => void | Promise<void>;
}) {
  const ref = useDialogFocus<HTMLFormElement>(true, onClose);
  const [retail, setRetail] = useState(current.active && current.sellingPriceMinor != null ? String(current.sellingPriceMinor / 100) : "");
  const [wholesale, setWholesale] = useState(current.active && current.wholesalePriceMinor != null ? String(current.wholesalePriceMinor / 100) : "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Hold the version shown when the editor opened: never overwrite another editor's save.
  const [expectedVersion] = useState(current.version ?? 0);
  const [expectedCentralVersion] = useState(central?.version ?? 0);
  const [vat, setVat] = useState(current.vatRateBasisPoints != null ? String(current.vatRateBasisPoints / 100) : "");
  const below = (retail !== "" && (!central || Number(retail) * 100 < central.basePriceMinor)) ||
    (wholesale !== "" && (!central?.wholesalePriceMinor || Number(wholesale) * 100 < central.wholesalePriceMinor)) ||
    (!central && (vat.trim() === "" ? null : Number(vat) * 100) !== (current.vatRateBasisPoints ?? null));
  let effective: ReturnType<typeof resolveCatalogPrice> | undefined;
  try { effective = resolveCatalogPrice(central, current); } catch { /* Retail is not configured yet. */ }
  async function save(event: FormEvent) {
    event.preventDefault(); setError(null);
    try {
      const sellingPriceMinor = retail.trim() ? nairaToKobo(Number(retail)) : null;
      const wholesalePriceMinor = wholesale.trim() ? nairaToKobo(Number(wholesale)) : null;
      if ((sellingPriceMinor !== null && sellingPriceMinor <= 0) || (wholesalePriceMinor !== null && wholesalePriceMinor <= 0)) throw new Error("Enter positive prices, or leave a level blank to use the central default.");
      const vatRateBasisPoints = central ? undefined : vat.trim() ? nairaToKobo(Number(vat)) : null;
      if (vatRateBasisPoints != null && vatRateBasisPoints > 10000) throw new Error("VAT must be from 0% through 100%.");
      setBusy(true);
      await callAdministration("saveBranchSalesPrice", { branchId, productId, sellingPriceMinor, wholesalePriceMinor,
        expectedVersion, expectedCentralVersion, vatRateBasisPoints, active: true, reason: reason.trim() || undefined, idempotencyKey: crypto.randomUUID() });
      await onSaved(); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Branch prices could not be saved."); }
    finally { setBusy(false); }
  }
  return <AppDialog role="dialog" aria-modal="true" aria-label="Branch selling prices"><FinancialActionScope>
    <form ref={ref} onSubmit={save} className="app-dialog-panel w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl sm:p-6">
      <h2 className="text-xl font-semibold">Branch selling prices</h2>
      <p className="mt-2 text-sm"><FinancialText>{productName}</FinancialText> · {branchName}</p>
      <p className="mt-2 text-sm text-[var(--muted)]">Applies to future sales and quotations at this branch. Leave either level blank to use its central default where configured; otherwise that level is unavailable. VAT is added only when a rate is provided.</p>
      {([ ["Retail", retail, setRetail, central?.basePriceMinor], ["Wholesale", wholesale, setWholesale, central?.wholesalePriceMinor] ] as const).map(([label, value, setter, base]) => <div key={label} className="mt-4">
        <label className="block text-sm font-medium">{label} branch price (₦)<FinancialInput><input aria-label={`${label} branch price (₦)`} type="number" min="0.01" step="0.01" inputMode="decimal" value={value} onChange={event => setter(event.target.value)} className="mt-1 w-full rounded-lg border p-3" disabled={busy} /></FinancialInput></label>
        <p className="mt-1 text-xs text-[var(--muted)]">Central {label.toLowerCase()}: <FinancialValue>{base ? formatNaira(base) : "Not configured"}</FinancialValue>. Blank = {base ? "use central" : "unavailable"}.</p>
      </div>)}
      {!central && <label className="mt-4 block text-sm font-medium">Branch VAT (%) — optional<FinancialInput><input aria-label="Branch VAT (%) — optional" type="number" min="0" max="100" step="0.01" inputMode="decimal" value={vat} onChange={event => setVat(event.target.value)} disabled={busy} className="mt-1 w-full rounded-lg border p-3" /></FinancialInput><span className="mt-1 block text-xs text-[var(--muted)]">No central price exists. Leave blank for VAT not provided; no VAT will be added. This is distinct from a configured 0% rate. No central record will be created.</span></label>}
      <p className="mt-3 text-xs text-[var(--muted)]">Current effective retail: <FinancialValue>{effective ? formatNaira(effective.unitPriceMinor) : "Not configured"}</FinancialValue>{effective ? ` · ${effective.priceSource}` : ""}. {central ? "VAT follows the central configuration. " : ""}Inventory cost and Head Office transfer prices are managed separately.</p>
      {below && <p role="status" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm">A price below its central level, or a branch-only level without a central default, requires a system administrator and an approval reason. Approval is reviewed again when central pricing changes.</p>}
      <label className="mt-4 block text-sm font-medium">Approval reason {below ? "(required)" : "(optional)"}<textarea minLength={3} maxLength={500} required={below} value={reason} onChange={event => setReason(event.target.value)} className="mt-1 w-full rounded-lg border p-3" disabled={busy} /></label>
      {error && <p role="alert" className="mt-3 text-sm text-red-700"><FinancialMessage>{error}</FinancialMessage></p>}
      <div className="mt-5 flex flex-wrap justify-end gap-2"><Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button><FinancialAction><Button type="submit" disabled={busy || (below && reason.trim().length < 3)}>{busy ? "Saving…" : "Save branch prices"}</Button></FinancialAction></div>
    </form></FinancialActionScope></AppDialog>;
}
