"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { downloadCsv, formatNaira } from "@/features/inventory/format";

interface Row { id: string; month: string; accountCode: string; accountName: string; amountMinor: number; actualMinor: number; varianceMinor: number; variancePercent: number | null; favorable: boolean; kind: string }
interface Comparison { rows: Row[]; months: string[] }
type Props = { branchId?: string; month: string };
export function BudgetComparison(props: Props) {
  return <BudgetComparisonReport key={props.branchId ?? "organization"} {...props} />;
}
function BudgetComparisonReport({ branchId, month }: Props) {
  const [fromMonth, setFrom] = useState(month), [toMonth, setTo] = useState(month);
  const [data, setData] = useState<Comparison | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const sequence = useRef(0);
  useEffect(() => () => { sequence.current++; }, []);
  async function compare() {
    const current = ++sequence.current; setBusy(true); setError(""); setData(null);
    try { const result = await callAdministration<object, Comparison>("budgetWorkspace", { action: "comparison", branchId, fromMonth, toMonth }); if (current === sequence.current) setData(result); }
    catch (cause) { if (current === sequence.current) setError(cause instanceof Error ? cause.message : "Comparison could not be loaded."); }
    finally { if (current === sequence.current) setBusy(false); }
  }
  return <section aria-label="Multi-month budget comparison" className="space-y-3 rounded-xl border bg-white p-4">
    <h3 className="font-semibold">Compare monthly budgets</h3><p className="text-sm text-[var(--muted)]">Compare up to 12 months. Only saved targets appear; a month without a target is not a zero budget. Actuals include posted journals for each target account.</p>
    <div className="flex flex-wrap items-end gap-3"><label>From month<input type="month" className="input block" value={fromMonth} disabled={busy} onChange={e => { setFrom(e.target.value); setData(null); }}/></label><label>To month<input type="month" className="input block" value={toMonth} disabled={busy} onChange={e => { setTo(e.target.value); setData(null); }}/></label><Button disabled={busy || !fromMonth || !toMonth || fromMonth > toMonth} onClick={() => void compare()}>{busy ? "Comparing…" : "Compare months"}</Button><Button variant="outline" disabled={busy || !data?.rows.length} onClick={() => downloadCsv(`budget-comparison-${fromMonth}-${toMonth}.csv`, data!.rows.map(row => ({ storeScope: branchId ?? "Organization", fromMonth, toMonth, month: row.month, accountCode: row.accountCode, account: row.accountName, kind: row.kind, targetNaira: row.amountMinor / 100, actualNaira: row.actualMinor / 100, favorableVarianceNaira: row.varianceMinor / 100, variancePercent: row.variancePercent ?? "" })))}>Export comparison CSV</Button></div>
    {error && <p role="alert" className="text-red-800">{error}</p>}
    {data && <><p className="text-sm">{data.months.filter(month => !data.rows.some(row => row.month === month)).map(month => `${month}: no saved targets`).join(" · ")}</p><div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead><tr>{["Month", "Account", "Budget", "Actual", "Favorable / (unfavorable)"].map(label => <th className="p-2" key={label}>{label}</th>)}</tr></thead><tbody>{data.rows.map(row => <tr key={row.id} className="border-t"><td className="p-2">{row.month}</td><td className="p-2">{row.accountCode} · {row.accountName}</td><td className="p-2">{formatNaira(row.amountMinor)}</td><td className="p-2">{formatNaira(row.actualMinor)}</td><td className={`p-2 ${row.favorable ? "text-emerald-800" : "text-red-800"}`}>{formatNaira(row.varianceMinor)}</td></tr>)}</tbody></table></div></>}
  </section>;
}
