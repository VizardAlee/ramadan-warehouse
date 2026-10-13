"use client";
import { hasWholesalePrice } from "./calculations";
import type { PosCartLine } from "./types";
export function PriceLevelControl({ line, onChange }: { line: PosCartLine; onChange: (tier: "retail" | "wholesale") => void }) {
  const available = hasWholesalePrice(line.product);
  return <div>
    <label className="mt-2 block text-xs font-medium">Price level
      <select aria-label={`Price level for ${line.product.name}`} className="mt-1 w-full rounded-lg border p-2" value={line.priceTier ?? "retail"} disabled={Boolean(line.serviceCase)}
        onChange={event => onChange(event.target.value as "retail" | "wholesale")}>
        <option value="retail">Retail / store price</option>
        <option value="wholesale" disabled={!available}>Wholesale</option>
      </select>
    </label>
    {!available && <p className="mt-1 text-xs text-[var(--muted)]">Wholesale is unavailable: no current wholesale price is configured. Ask an authorized catalogue manager to set Wholesale selling price in Products, then refresh POS.</p>}
    {line.serviceCase ? <p className="mt-1 text-xs text-[var(--muted)]">This linked service uses its confirmed charge; price level cannot change.</p>
      : line.sellingPriceMinor !== undefined && <p className="mt-1 text-xs text-[var(--muted)]">A this-sale-only price is applied. Choosing a price level replaces that override with the configured price.</p>}
  </div>;
}
