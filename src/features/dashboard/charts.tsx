"use client";
import { FinancialAttributes, FinancialText, FinancialValue, useFinancialPrivacy } from "@/features/finance/financial-privacy";

import { formatNaira } from "@/features/inventory/format";

interface ChartDatum {
  label: string;
  value: number;
  color: string;
}

// Retain existing category meanings while resolving their colors in either theme.
function themedChartColor(color: string) {
  const palette: Record<string, string> = { "#34458f": "var(--chart-invoiced)", "#6074bd": "var(--chart-receipts)", "#f6b333": "var(--warning)", "#c8563d": "var(--negative)" };
  return palette[color] ?? color;
}

function donutGradient(data: readonly ChartDatum[]) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  if (!total) return "conic-gradient(var(--chart-track) 0deg 360deg)";
  let current = 0;
  const stops = data.flatMap((item) => {
    const start = current;
    current += (item.value / total) * 360;
    return [`${themedChartColor(item.color)} ${start}deg`, `${themedChartColor(item.color)} ${current}deg`];
  });
  return `conic-gradient(${stops.join(", ")})`;
}

export function OperationalMixChart({ data }: { data: readonly ChartDatum[] }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  return (
    <figure className="rounded-xl border bg-white p-5 sm:p-6">
      <figcaption>
        <h2 className="section-title">Open work by type</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">Requests, active transfers, and discrepancies in your current view.</p>
      </figcaption>
      <div className="mt-5 grid items-center gap-6 sm:grid-cols-[minmax(9rem,12rem)_1fr]">
        <FinancialAttributes><div
          className="relative mx-auto aspect-square w-full max-w-44 rounded-full"
          style={{ background: donutGradient(data) }}
          role="img"
          aria-label={data.map((item) => `${item.label}: ${item.value}`).join(", ")}
        >
          <div className="absolute inset-[22%] grid place-items-center rounded-full bg-white text-center shadow-inner">
            <div><strong className="block text-3xl tabular-nums"><FinancialText>{total}</FinancialText></strong><span className="text-xs text-[var(--muted)]">total signals</span></div>
          </div>
        </div></FinancialAttributes>
        <ul className="grid gap-3" aria-label="Operational mix legend">
          {data.map((item) => (
            <li key={item.label} className="flex items-center justify-between gap-4 rounded-lg bg-[var(--surface-soft)] px-3 py-2.5">
              <span className="flex min-w-0 items-center gap-2.5 text-sm"><span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: themedChartColor(item.color) }} /><span className="truncate"><FinancialText>{item.label}</FinancialText></span></span>
              <strong className="tabular-nums"><FinancialText>{item.value}</FinancialText></strong>
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}

export function TransferPipelineChart({ data }: { data: readonly ChartDatum[] }) {
  const maximum = Math.max(1, ...data.map((item) => item.value));
  const total = data.reduce((sum, item) => sum + item.value, 0);
  return (
    <figure className="rounded-xl border bg-white p-5 sm:p-6">
      <figcaption className="flex items-start justify-between gap-4">
        <div><h2 className="section-title">Transfer pipeline</h2><p className="mt-1 text-sm text-[var(--muted)]">Where active store-to-store movements need attention.</p></div>
        <span className="rounded-full bg-indigo-50 px-3 py-1 text-sm font-semibold text-[var(--brand)]"><FinancialText>{total}</FinancialText> active</span>
      </figcaption>
      <FinancialAttributes><div className="mt-6 grid gap-4" role="img" aria-label={data.map((item) => `${item.label}: ${item.value}`).join(", ")}>
        {data.map((item) => (
          <div key={item.label} className="grid grid-cols-[7.5rem_minmax(0,1fr)_2rem] items-center gap-3 text-sm sm:grid-cols-[9rem_minmax(0,1fr)_2.5rem]">
            <span className="truncate text-[var(--muted)]"><FinancialText>{item.label}</FinancialText></span>
            <div className="h-3 overflow-hidden rounded-full bg-[var(--chart-track)]">
              <div className="h-full min-w-0 rounded-full transition-[width] duration-500" style={{ backgroundColor: themedChartColor(item.color), width: item.value ? `${Math.max(8, (item.value / maximum) * 100)}%` : "0%" }} />
            </div>
            <strong className="text-right tabular-nums"><FinancialText>{item.value}</FinancialText></strong>
          </div>
        ))}
      </div></FinancialAttributes>
    </figure>
  );
}

interface SalesTrendDatum {
  date: string;
  label: string;
  value: number;
  count: number;
}

export function SalesTrendChart({ data }: { data: readonly SalesTrendDatum[] }) {
  const { hidden } = useFinancialPrivacy();
  if (hidden) return <figure className="rounded-xl border bg-white p-5" aria-label="Sales trend with financial values hidden"><figcaption className="font-semibold">Sales trend · financial values hidden</figcaption><p className="text-sm text-[var(--muted)]">Money bars, axes and tooltips are hidden. Sale counts remain visible.</p><ul>{data.map(item => <li key={item.date}><FinancialText>{item.label}</FinancialText>: <FinancialText>{item.count}</FinancialText> sales</li>)}</ul></figure>;
  const maximum = Math.max(1, ...data.map((item) => item.value));
  const total = data.reduce((sum, item) => sum + item.value, 0);
  return (
    <figure className="rounded-xl border bg-white p-5 sm:p-6">
      <figcaption>
        <h2 className="section-title">Sales trend</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Daily invoice value for the last seven days.
        </p>
        <p className="mt-3 text-2xl font-semibold"><FinancialValue>{formatNaira(total)}</FinancialValue></p>
      </figcaption>
      <FinancialAttributes financial><div className="mt-6 grid h-52 grid-cols-7 items-end gap-2" role="img" aria-label={data.map((item) => `${item.date}: ${formatNaira(item.value)}`).join(", ")}>
        {data.map((item) => (
          <div key={item.date} className="flex h-full min-w-0 flex-col justify-end text-center">
            <span className="mb-1 truncate text-[10px] font-semibold text-[var(--muted)] sm:text-xs">
              <FinancialValue>{item.value > 0 ? formatNaira(item.value) : "—"}</FinancialValue>
            </span>
            <div className="flex h-36 items-end justify-center rounded-lg bg-indigo-50 px-1">
              <div
                className="w-full rounded-t-md bg-gradient-to-t from-[var(--brand-fill)] to-[var(--chart-invoiced)] transition-[height] duration-500"
                style={{ height: item.value ? `${Math.max(8, (item.value / maximum) * 100)}%` : "0%" }}
              />
            </div>
            <span className="mt-2 text-xs font-semibold"><FinancialText>{item.label}</FinancialText></span>
            <span className="text-[10px] text-[var(--muted)]"><FinancialText>{item.count}</FinancialText> sale<FinancialText>{item.count === 1 ? "" : "s"}</FinancialText></span>
          </div>
        ))}
      </div></FinancialAttributes>
    </figure>
  );
}

export function SalesPaymentMixChart({ data }: { data: readonly ChartDatum[] }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  return (
    <figure className="rounded-xl border bg-white p-5 sm:p-6">
      <figcaption>
        <h2 className="section-title">Payment position at checkout</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">Original full-payment, part-payment and credit invoices in the last 30 Nigerian business days. Later repayments and returns are shown in customer accounts and reports.</p>
      </figcaption>
      <div className="mt-5 grid items-center gap-6 sm:grid-cols-[minmax(9rem,12rem)_1fr]">
        <FinancialAttributes><div className="relative mx-auto aspect-square w-full max-w-44 rounded-full" style={{ background: donutGradient(data) }} role="img" aria-label={data.map((item) => `${item.label}: ${item.value}`).join(", ")}>
          <div className="absolute inset-[22%] grid place-items-center rounded-full bg-white text-center shadow-inner">
            <div><strong className="block text-3xl tabular-nums"><FinancialText>{total}</FinancialText></strong><span className="text-xs text-[var(--muted)]">sales</span></div>
          </div>
        </div></FinancialAttributes>
        <ul className="grid gap-3">
          {data.map((item) => (
            <li key={item.label} className="flex items-center justify-between gap-4 rounded-lg bg-[var(--surface-soft)] px-3 py-2.5 text-sm">
              <span className="flex items-center gap-2.5"><span className="size-2.5 rounded-full" style={{ backgroundColor: themedChartColor(item.color) }} /><FinancialText>{item.label}</FinancialText></span>
              <strong><FinancialText>{item.value}</FinancialText></strong>
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}
