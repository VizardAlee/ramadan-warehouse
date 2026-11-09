"use client";
import type { MarginReviewCost } from "./margin-review";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/auth-context";
import { useOperatingContextOptions } from "@/features/auth/use-operating-context-options";
import { useOrganizationCollection } from "@/features/administration/use-organization-collection";
import { BranchPriceEditor, type BranchPriceRecord } from "./branch-price-editor";
import type { CentralSalesPrice } from "../../../functions/src/sales/pricing";
export function BranchPrices({ productId, productName, central, marginCost, onClose }: { productId: string; productName: string; central: CentralSalesPrice | null; marginCost?: MarginReviewCost; onClose: () => void }) {
  const { profile, operatingContext } = useAuth();
  const { options: contexts } = useOperatingContextOptions();
  const [branchId, setBranchId] = useState(operatingContext?.type === "branch" ? operatingContext.id : "");
  const records = useOrganizationCollection<BranchPriceRecord>("branchSalesPrices", Boolean(branchId), { field: "branchId", id: branchId });
  const [editing, setEditing] = useState(false);
  const options = contexts.filter(context => context.type === "branch" && profile && (!operatingContext || (operatingContext.type === "branch" && context.id === operatingContext.id)));
  return <section className="surface mb-4 p-4" aria-label="Manage branch prices">
    <h2 className="font-semibold">Branch selling prices · {productName}</h2>
    <p className="mt-1 text-sm text-[var(--muted)]">Choose the branch whose future retail and wholesale prices you want to manage. A stock location is not required. Assigned staff can switch their branch using the app’s operating context.</p>
    <label className="mt-3 block text-sm">Pricing branch<select className="input mt-1 w-full" value={branchId} onChange={event => { setBranchId(event.target.value); setEditing(false); }}><option value="">Choose a branch…</option>{options.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
    {records.error && <p role="alert" className="mt-2 text-sm text-red-700">{records.error}</p>}
    <div className="mt-3 flex gap-2"><Button disabled={!options.some(branch => branch.id === branchId) || records.loading || Boolean(records.error)} onClick={() => setEditing(true)}>Review branch prices</Button><Button variant="secondary" onClick={onClose}>Close</Button></div>
    {editing && <BranchPriceEditor key={`${branchId}:${productId}`} branchId={branchId} branchName={options.find(branch => branch.id === branchId)?.name ?? branchId} productId={productId} productName={productName} central={central} marginCost={marginCost} current={records.data.find(price => price.productId === productId) ?? {}} onClose={() => setEditing(false)} onSaved={() => {}} />}
  </section>;
}
