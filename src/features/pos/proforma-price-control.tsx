import { FinancialInput, FinancialValue } from "@/features/finance/financial-privacy";
import { formatNaira } from "@/features/inventory/format";
import type { PosProduct } from "./types";
import type { ProformaDraftLine } from "./proforma-pricing";

export function ProformaPriceControl({ line, index, product, onChange }: {
  line: ProformaDraftLine;
  index: number;
  product?: PosProduct;
  onChange: (line: ProformaDraftLine) => void;
}) {
  const preset = line.priceTier === "wholesale" ? product?.wholesalePriceMinor : product?.unitPriceMinor;
  const helpId = `quoted-price-help-${index}`;
  return <>
    <label>Price tier<select className="input mt-1 block w-full" value={line.priceTier}
      onChange={event => onChange({ ...line, priceTier: event.target.value as ProformaDraftLine["priceTier"], customUnitPrice: "" })}>
      <option value="retail">Retail</option><option value="wholesale">Wholesale (where configured)</option>
    </select></label>
    <div>
      <label>Custom quoted unit price {index + 1} (₦)<FinancialInput><input className="input mt-1 block w-full" inputMode="decimal"
        aria-label={`Custom quoted unit price ${index + 1} (₦)`} aria-describedby={helpId} value={line.customUnitPrice} maxLength={24}
        onChange={event => onChange({ ...line, customUnitPrice: event.target.value })} /></FinancialInput></label>
      <p id={helpId} className="mt-1 text-xs text-[var(--muted)]">Leave blank to use the selected preset{preset != null ? <>: <FinancialValue>{formatNaira(preset)}</FinancialValue></> : " (where configured)"}. Custom prices apply only to this quotation. Changing the price tier clears the custom price.</p>
    </div>
  </>;
}
