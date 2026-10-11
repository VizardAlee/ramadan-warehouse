"use client";

import Link from "next/link";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Building2, Compass, RefreshCw, Search, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { callAdministration } from "@/features/administration/api";
import { useAuth } from "@/features/auth/auth-context";
import { formatNaira } from "@/features/inventory/format";
import { hasPermission } from "@/lib/permissions/roles";
import { canReadCeoView, ceoDrilldown, permittedCeoDestinations } from "./ceo-directory";
import type { CeoDashboard, CeoMetric } from "../../../functions/src/dashboard/ceo-model";
import "./ceo.css";

export function ceoToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function ceoPreset(days: number, today = ceoToday()) {
  return { fromDate: new Date(Date.parse(`${today}T12:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10), toDate: today };
}
const metricValue = (metric: CeoMetric) => metric.state === "not_configured" ? "Not configured" : metric.value === null ? "Unavailable" : metric.money ? formatNaira(metric.value) : metric.value.toLocaleString("en-NG");
const panel = "ceo-panel p-5 sm:p-7";

export function CeoView() {
  const { profile, setOperatingContext } = useAuth();
  const allowed = canReadCeoView(profile);
  const accessKey = JSON.stringify([profile?.organizationId, profile?.uid, profile?.authorizationVersion, profile?.roleId, profile?.roleIds, profile?.effectivePermissions]);
  const [filters, setFilters] = useState({ ...ceoPreset(30), branchId: "" });
  const [draft, setDraft] = useState(filters);
  const [initialized, setInitialized] = useState(false);
  const [loadedWorkspace, setWorkspace] = useState<{ accessKey: string; data: CeoDashboard } | null>(null);
  const workspace = loadedWorkspace?.accessKey === accessKey ? loadedWorkspace.data : null;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [cursor, setCursor] = useState("");
  const [search, setSearch] = useState("");
  const [series, setSeries] = useState<"invoicedMinor" | "checkoutReceiptsMinor">("invoicedMinor");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search), defaults = ceoPreset(30);
    const date = (key: string, fallback: string) => /^\d{4}-\d{2}-\d{2}$/.test(params.get(key) ?? "") ? params.get(key)! : fallback;
    const restored = { fromDate: date("fromDate", defaults.fromDate), toDate: date("toDate", defaults.toDate), branchId: params.get("branchId") ?? "" };
    queueMicrotask(() => { setFilters(restored); setDraft(restored); setInitialized(true); });
  }, []);
  useEffect(() => {
    if (!allowed || !initialized) return;
    let active = true;
    queueMicrotask(() => { if (active) { setLoading(true); setError(""); setWorkspace(null); } });
    const params = new URLSearchParams({ fromDate: filters.fromDate, toDate: filters.toDate });
    if (filters.branchId) params.set("branchId", filters.branchId);
    window.history.replaceState(null, "", `/dashboard/ceo?${params}`);
    try { window.sessionStorage.setItem(`warehouse-ceo-view:${profile?.organizationId}:${profile?.uid}`, `/dashboard/ceo?${params}`); } catch { /* Filters still work without storage. */ }
    void callAdministration<object, CeoDashboard>("getDashboardWorkspace", { section: "ceo", ...filters, branchId: filters.branchId || undefined, branchCursor: cursor || undefined })
      .then(data => { if (active) setWorkspace({ accessKey, data }); })
      .catch(() => { if (active) setError("The overview could not be refreshed. Try again, or open a register below."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [allowed, initialized, filters, cursor, refresh, accessKey, profile?.organizationId, profile?.uid]);
  if (!profile) return <p role="status">Loading your access…</p>;
  if (!allowed) return <section className="surface p-6"><h1 className="text-2xl font-semibold">CEO view</h1><p className="mt-3">This overview requires existing organization-wide access. Your usual workspace remains available.</p><Link className="mt-4 inline-block underline" href="/dashboard">Return to usual dashboard</Link></section>;
  const destinations = permittedCeoDestinations(profile, search);
  const salesAllowed = hasPermission(profile, "sales.read.all") && hasPermission(profile, "reports.sales.read");
  const groups = [...new Set(destinations.map(item => item.group))];
  const current = workspace?.metrics.filter(item => item.basis === "current") ?? [];
  const period = workspace?.metrics.filter(item => item.basis === "period") ?? [];
  const invoiced = period.find(item => item.id === "invoiced");
  const previous = workspace?.comparison;
  const change = invoiced?.value !== null && invoiced?.value !== undefined && previous && previous.invoicedMinor > 0
    ? ((invoiced.value - previous.invoicedMinor) / previous.invoicedMinor) * 100 : null;
  const trend = workspace?.trend;
  const max = Math.max(1, ...(trend ?? []).map(item => item[series]));
  const go = (branchId = filters.branchId) => setOperatingContext(branchId ? { type: "branch", id: branchId } : null);
  const href = (path: string, from = filters.fromDate, to = filters.toDate, branch = filters.branchId) => ceoDrilldown(path, from, to, branch);
  const apply = (next: typeof filters) => { setFilters(next); setDraft(next); setCursor(""); };
  const card = (metric: CeoMetric) => <Link key={metric.id} href={href(metric.href)} onClick={() => go()} className="ceo-metric group">
    <span className="flex items-start justify-between gap-3 text-sm text-slate-300">{metric.label}<ArrowUpRight className="size-4 shrink-0 text-teal-300" aria-hidden="true" /></span>
    <strong className="mt-4 block break-words text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">{metricValue(metric)}</strong>
    <span className="mt-3 block text-xs leading-5 text-slate-400">{metric.detail}</span>
  </Link>;
  return <div className="ceo-view -mx-2 rounded-[2rem] p-4 sm:p-7 lg:p-9">
    <header className="flex flex-wrap items-start justify-between gap-5">
      <div><p className="ceo-eyebrow"><Sparkles className="size-4" aria-hidden="true" /> THE BIG PICTURE</p><h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Your business.<br /><span className="text-teal-300">In focus.</span></h1><p className="mt-4 max-w-xl text-sm leading-6 text-slate-300">CEO view · See what matters, follow what needs attention, and explore the detail.</p></div>
      <div className="flex flex-wrap gap-2"><Link href="/dashboard" className="ceo-button">Usual dashboard <ArrowRight className="size-4" /></Link><Link href="/guide#ceo-view" className="ceo-button">How to read this</Link><button className="ceo-button" aria-label="Refresh overview" disabled={loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw className="size-4" /></button></div>
    </header>
    <form className={`${panel} mt-7`} onSubmit={event => { event.preventDefault(); apply(draft); }} aria-label="Overview filters">
      <div className="flex flex-wrap items-end gap-3">
        <label className="ceo-label">From<input required type="date" max={ceoToday()} value={draft.fromDate} onChange={event => setDraft({ ...draft, fromDate: event.target.value })} /></label>
        <label className="ceo-label">To<input required type="date" min={draft.fromDate} max={ceoToday()} value={draft.toDate} onChange={event => setDraft({ ...draft, toDate: event.target.value })} /></label>
        <label className="ceo-label min-w-40 flex-1">Branch<select value={draft.branchId} onChange={event => setDraft({ ...draft, branchId: event.target.value })}><option value="">All branches</option>{draft.branchId && !workspace?.branches.some(item => item.id === draft.branchId) && <option value={draft.branchId}>Selected branch</option>}{workspace?.branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
        <button className="ceo-button ceo-primary" type="submit" disabled={loading}>Apply filters</button><button className="ceo-button" type="button" onClick={() => setDraft(filters)}>Cancel changes</button>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">{[["Today", 1], ["7 days", 7], ["30 days", 30], ["90 days", 90]] .map(([label, days]) => <button type="button" className="ceo-chip" key={label} onClick={() => apply({ ...filters, ...ceoPreset(Number(days)) })}>{label}</button>)}<span className="ml-auto text-xs text-slate-400">Africa/Lagos · Up to 366 days</span></div>
    </form>
    <div className="my-5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400" role="status"><span>{filters.branchId ? "Selected branch" : "Organization-wide"} · {filters.fromDate} — {filters.toDate}</span><span>{loading ? "Refreshing recorded data…" : workspace ? `Updated ${new Intl.DateTimeFormat("en-NG", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" }).format(new Date(workspace.asOf))}` : "No current snapshot"}</span></div>
    {error && <p role="alert" className="ceo-warning mb-5">{error}</p>}
    {workspace?.metrics.some(item => item.state === "unavailable") && <p role="alert" className="ceo-warning mb-5">Some figures are unavailable. Open the relevant register for detail or refresh the overview.</p>}
    <section aria-label="Period overview" aria-busy={loading}>
      <div className="ceo-section-heading"><h2>During this period</h2><span>Recorded activity, not today’s balances</span></div>
      {loading ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[1, 2, 3, 4].map(key => <div key={key} className="ceo-metric min-h-44" aria-label="Figure loading"><div className="h-3 w-28 rounded bg-slate-700" /><div className="mt-7 h-8 w-40 rounded bg-slate-800" /></div>)}</div> : period.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{period.map(card)}</div> : !error && <p className={panel}>No period metrics are included in your current access. Explore permitted areas below.</p>}
    </section>
    <section className="mt-7" aria-label="Needs attention now"><div className="ceo-section-heading"><h2>Keep an eye on</h2><span>Current position · date filters do not change these balances</span></div>
      {workspace?.billingConfigured === false && <Link onClick={() => go()} href="/finance" className="ceo-warning mb-4 block">Mixed billing needs its account setup. Review the controls before the first mixed transaction. <ArrowRight className="inline size-4" /></Link>}
      {filters.branchId && <p className="mb-4 text-sm text-slate-400">Customer debt is maintained across branches. Open Customers for the full balance and statement; no branch debt estimate is shown here.</p>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{current.map(card)}</div>
    </section>
    {salesAllowed && <section className="mt-7 grid gap-5 xl:grid-cols-[1.6fr_1fr]" aria-label="Trends and comparisons">
      <div className={panel}><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="ceo-eyebrow">THE DIRECTION</p><h2 className="mt-2 text-xl font-semibold">Activity over time</h2></div><div className="flex flex-wrap gap-2" role="group" aria-label="Chart measure"><button className="ceo-chip" aria-pressed={series === "invoicedMinor"} onClick={() => setSeries("invoicedMinor")}>Invoiced sales</button><button className="ceo-chip" aria-pressed={series === "checkoutReceiptsMinor"} onClick={() => setSeries("checkoutReceiptsMinor")}>Checkout receipts</button></div></div>
        {loading ? <p role="status" className="py-20 text-slate-400">Loading chart…</p> : !trend ? <p className="py-14 text-slate-400">This chart is unavailable or outside your access. Open a permitted report below.</p> : !trend.some(item => item[series] > 0) ? <p className="py-14 text-slate-300">No recorded {series === "invoicedMinor" ? "invoiced sales" : "checkout receipts"} in this period.</p> : <>
          <p className="mt-4 text-xs text-slate-400">NGN · Select a bar to open sales for that interval. Checkout receipts are gross before refunds.</p>
          <div className="ceo-plot mt-6"><div className="ceo-axis" aria-hidden="true"><span>{formatNaira(max)}</span><span>{formatNaira(Math.round(max / 2))}</span><span>₦0</span></div><div className="ceo-bars" aria-label={`${series === "invoicedMinor" ? "Invoiced sales" : "Checkout receipts"} chart`}>
            {trend.map((item, index) => <Link key={item.fromDate} onClick={() => go()} href={href("/reports", item.fromDate, item.toDate)} aria-label={`${item.fromDate} to ${item.toDate}: ${formatNaira(item[series])}. Open sales detail.`} className="ceo-bar-link"><span className="ceo-bar-value" aria-hidden="true">{formatNaira(item[series])}<br />{item.fromDate} — {item.toDate}</span><span className="ceo-bar" style={{ height: `${item[series] / max * 100}%` }} />{(index % Math.ceil(trend.length / 4) === 0 || index === trend.length - 1) && <span className="ceo-bar-date">{item.fromDate.slice(5)}</span>}</Link>)}
          </div></div>
        </>}
        {trend && <details className="mt-8 text-sm"><summary className="cursor-pointer text-teal-300">View chart figures & open details</summary><div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><caption className="sr-only">Recorded invoiced sales and checkout receipts by interval</caption><thead><tr><th className="p-2">Period</th><th className="p-2">Invoiced</th><th className="p-2">Checkout receipts</th></tr></thead><tbody>{trend.map(item => <tr key={item.fromDate} className="border-t border-slate-700"><td className="p-2"><Link onClick={() => go()} className="underline" href={href("/reports", item.fromDate, item.toDate)}>{item.fromDate} — {item.toDate}</Link></td><td className="p-2">{formatNaira(item.invoicedMinor)}</td><td className="p-2">{formatNaira(item.checkoutReceiptsMinor)}</td></tr>)}</tbody></table></div></details>}
      </div>
      <div className={panel}><p className="ceo-eyebrow">A LITTLE PERSPECTIVE</p><h2 className="mt-2 text-xl font-semibold">Against the previous period</h2><p className="mt-3 text-sm leading-6 text-slate-400">Invoiced sales compared with the preceding period of the same length. The current day may still be incomplete.</p><p className="mt-8 flex items-center gap-2 text-4xl font-semibold tabular-nums text-teal-300">{change === null ? "—" : <>{change >= 0 ? <ArrowUpRight /> : <ArrowDownLeft />}{Math.abs(change).toFixed(1)}%</>}</p><p className="mt-4 text-sm text-slate-300">{previous ? `${previous.fromDate} — ${previous.toDate}` : loading ? "Loading comparison…" : "Comparison unavailable"}</p><p className="mt-2 text-xl tabular-nums">{previous ? formatNaira(previous.invoicedMinor) : "—"}</p>{previous?.invoicedMinor === 0 && <p className="mt-3 text-sm text-slate-400">No prior invoiced value. A percentage change would be misleading.</p>}<div className="mt-7 flex flex-wrap gap-2"><Link className="ceo-button" onClick={() => go()} href={href("/reports")}>Explore sales <ArrowRight className="size-4" /></Link>{previous && <Link className="ceo-button" onClick={() => go()} href={href("/reports", previous.fromDate, previous.toDate)}>Open previous period</Link>}</div></div>
    </section>}
    <section className={`${panel} mt-7`} aria-label="Branch overview"><div className="ceo-section-heading"><div><p className="ceo-eyebrow">ACROSS YOUR BUSINESS</p><h2 className="mt-2">Branch overview</h2></div><span>Invoiced sales · selected period · six branches per page</span></div>{workspace?.branchError && <p role="alert" className="ceo-warning">Branch comparison could not be loaded.</p>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{workspace?.branches.map(branch => <div className="ceo-branch" key={branch.id}><Building2 className="size-5 text-teal-300" /><h3 className="mt-3 font-semibold">{branch.name}</h3>{salesAllowed && <p className="mt-3 text-2xl tabular-nums">{branch.invoicedMinor === null ? "Unavailable" : formatNaira(branch.invoicedMinor)}</p>}<div className="mt-4 flex flex-wrap gap-3"><button className="ceo-chip" onClick={() => apply({ ...filters, branchId: branch.id })}>View branch overview</button>{salesAllowed && <Link className="ceo-chip" href={href("/reports", filters.fromDate, filters.toDate, branch.id)} onClick={() => go(branch.id)}>Open sales</Link>}</div></div>)}</div>
      {!loading && !workspace?.branchError && workspace?.branches.length === 0 && <p className="text-sm text-slate-400">No branches recorded.</p>}
      <div className="mt-5 flex gap-3">{cursor && <button className="ceo-button" onClick={() => setCursor("")}>First branches</button>}{workspace?.nextBranchCursor && <button className="ceo-button" onClick={() => setCursor(workspace.nextBranchCursor!)}>Next branches <ArrowRight className="size-4" /></button>}</div>
    </section>
    <section className="mt-9" aria-label="Explore the business"><div className="ceo-section-heading"><div><p className="ceo-eyebrow"><Compass className="size-4" /> EXPLORE THE BUSINESS</p><h2 className="mt-2">Every detail has a home.</h2></div><span>{destinations.length} permitted destinations</span></div><p className="mb-5 max-w-3xl text-sm leading-6 text-slate-400">Open a card for its register, history or report. Sales reports keep your dates and branch. Other areas use the selected working branch and their own current-position or history filters. Viewing does not add editing or approval access.</p>
      <label className="ceo-search"><Search className="size-5 text-slate-400" /><span className="sr-only">Find a report, record or setting</span><input type="search" placeholder="Find customers, provider funds, attendance, audit…" value={search} onChange={event => setSearch(event.target.value)} /></label>
      {!destinations.length && <p role="status" className="mt-5 text-slate-300">No permitted destinations match. Try another search.</p>}
      {groups.map(group => <div key={group} className="mt-7"><h3 className="mb-3 text-sm font-semibold text-slate-300">{group}</h3><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{destinations.filter(item => item.group === group).map(item => <Link key={item.title} href={href(item.href)} onClick={() => go()} className="ceo-destination"><div className="flex items-start justify-between gap-4"><strong className="text-sm">{item.title}</strong><ArrowUpRight className="size-4 shrink-0 text-teal-300" /></div><p className="mt-2 text-xs leading-5 text-slate-400">{item.detail}</p></Link>)}</div></div>)}
    </section>
    <footer className="mt-9 border-t border-slate-700 pt-5 text-xs leading-6 text-slate-400">Read-only overview of recorded information. Each section respects your existing access. Figures refresh on request and may have slightly different read times. For reconciled company cash flow and earned income, open Financial statements. Provider funds, stock transfers and advances are not sales income.</footer>
  </div>;
}
