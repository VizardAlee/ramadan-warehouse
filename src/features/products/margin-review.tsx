"use client";
import { FinancialValue } from "@/features/finance/financial-privacy";

// Advisory review threshold, not a business rule or an accounting valuation.
export const MARGIN_REVIEW_PERCENT = 50;
export interface MarginReviewCost { unitCostNaira?: number; available: boolean }
export function marginReview(cost: number | undefined, price: number | undefined): "missing" | "zero" | "high" | null {
  if (price == null || !Number.isFinite(price) || price <= 0) return null;
  if (cost == null || !Number.isFinite(cost)) return "missing";
  if (cost < 0) return null; // The amount field owns invalid-input validation.
  if (cost === 0) return "zero";
  return (price - cost) / price * 100 >= MARGIN_REVIEW_PERCENT ? "high" : null;
}
export function MarginReview({ cost, retail, wholesale }: { cost?: MarginReviewCost; retail?: number; wholesale?: number }) {
  if (!cost?.available) return null;
  const flagged = ([ ["Retail", retail], ["Wholesale", wholesale] ] as const)
    .map(([label, price]) => ({ label, price, reason: marginReview(cost.unitCostNaira, price) }))
    .filter(row => row.reason !== null);
  if (!flagged.length) return null;
  return <aside role="status" aria-label="Review product margin" className="col-span-full mt-3 rounded-lg bg-amber-50 p-3 text-sm">
    <FinancialValue><div>
      <p className="font-semibold">Review product cost and prices</p>
      {flagged.map(row => <p key={row.label}>{row.reason === "missing"
        ? `${row.label}: catalogue cost is missing. Estimated margin cannot be checked.`
        : row.reason === "zero"
          ? `${row.label}: catalogue cost is zero. Check the cost before relying on a margin estimate.`
          : `${row.label}: estimated gross margin is ${((row.price! - cost.unitCostNaira!) / row.price! * 100).toFixed(1)}%, meeting the ${MARGIN_REVIEW_PERCENT}% review threshold.`}</p>)}
      <p className="mt-2">Check for missing zeros, unit mismatches and genuine pricing differences. This is an advisory based on catalogue default cost and prices before VAT, not actual profit or historical cost of goods sold. Existing inventory costs may differ. Saving does not change stock valuations or past sales.</p>
    </div></FinancialValue>
  </aside>;
}
