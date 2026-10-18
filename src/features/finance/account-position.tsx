import { formatNaira } from "@/features/inventory/format";

export function accountPosition(debt: number | null | undefined, credit: number | null | undefined, party: "customer" | "supplier") {
  if (typeof debt !== "number" || typeof credit !== "number" || ![debt, credit].every(value => Number.isSafeInteger(value) && value >= 0)) return { net: null, label: "Net position needs reconciliation" };
  const net = debt - credit;
  if (!net) return { net, label: debt ? "Net settled · allocation pending" : "No balance recorded" };
  return { net, label: net > 0 ? party === "customer" ? "Customer owes company" : "Company owes supplier" : party === "customer" ? "Company holds customer funds" : "Supplier holds company credit" };
}
export function AccountPosition({ debt, credit, party, scope }: { debt: number | null | undefined; credit: number | null | undefined; party: "customer" | "supplier"; scope: string }) {
  const position = accountPosition(debt, credit, party);
  const money = (value: number | null | undefined) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? formatNaira(value) : "Not established";
  return <section className="space-y-2 rounded-xl border p-4" aria-label={`${party === "customer" ? "Customer" : "Supplier"} net position`}>
    <p className="text-xs text-[var(--muted)]">{scope}</p><dl className="grid gap-3 sm:grid-cols-3">
      <div><dt className="text-sm">Gross unpaid debt</dt><dd className="font-semibold finance-attention">{money(debt)}</dd></div>
      <div><dt className="text-sm">{party === "customer" ? "Unapplied deposits / advances" : "Unused advances / supplier credits"}</dt><dd className="font-semibold finance-balance">{money(credit)}</dd></div>
      <div><dt className="text-sm">{position.label}</dt><dd className="font-semibold">{position.net === null ? "Not established" : formatNaira(Math.abs(position.net))}</dd></div>
    </dl><p className="text-xs text-[var(--muted)]">Comparison only. Debt and credit remain separate until an authorized allocation or refund is recorded. Existing credit limits, arrangement and store rules still apply. Other return/exchange credits or provider-fund obligations are separate.</p>
  </section>;
}
