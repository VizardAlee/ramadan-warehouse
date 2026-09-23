import { formatNaira } from "@/features/inventory/format";

interface ChartDatum {
  label: string;
  value: number;
  color: string;
}

function donutGradient(data: readonly ChartDatum[]) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  if (!total) return "conic-gradient(#e5ebe7 0deg 360deg)";
  let current = 0;
  const stops = data.flatMap((item) => {
    const start = current;
    current += (item.value / total) * 360;
    return [`${item.color} ${start}deg`, `${item.color} ${current}deg`];
  });
  return `conic-gradient(${stops.join(", ")})`;
}

export function OperationalMixChart({ data }: { data: readonly ChartDatum[] }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  return (
    <figure className="rounded-xl border bg-white p-5 sm:p-6">
      <figcaption>
        <h2 className="section-title">Operational mix</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">Current workload and active catalogue at a glance.</p>
      </figcaption>
      <div className="mt-5 grid items-center gap-6 sm:grid-cols-[minmax(9rem,12rem)_1fr]">
        <div
          className="relative mx-auto aspect-square w-full max-w-44 rounded-full"
          style={{ background: donutGradient(data) }}
          role="img"
          aria-label={data.map((item) => `${item.label}: ${item.value}`).join(", ")}
        >
          <div className="absolute inset-[22%] grid place-items-center rounded-full bg-white text-center shadow-inner">
            <div><strong className="block text-3xl tabular-nums">{total}</strong><span className="text-xs text-[var(--muted)]">total signals</span></div>
          </div>
        </div>
        <ul className="grid gap-3" aria-label="Operational mix legend">
          {data.map((item) => (
            <li key={item.label} className="flex items-center justify-between gap-4 rounded-lg bg-[#f5f7fc] px-3 py-2.5">
              <span className="flex min-w-0 items-center gap-2.5 text-sm"><span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} /><span className="truncate">{item.label}</span></span>
              <strong className="tabular-nums">{item.value}</strong>
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
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-[var(--brand)]">{total} active</span>
      </figcaption>
      <div className="mt-6 grid gap-4" role="img" aria-label={data.map((item) => `${item.label}: ${item.value}`).join(", ")}>
        {data.map((item) => (
          <div key={item.label} className="grid grid-cols-[7.5rem_minmax(0,1fr)_2rem] items-center gap-3 text-sm sm:grid-cols-[9rem_minmax(0,1fr)_2.5rem]">
            <span className="truncate text-[var(--muted)]">{item.label}</span>
            <div className="h-3 overflow-hidden rounded-full bg-[#e9edf7]">
              <div className="h-full min-w-0 rounded-full transition-[width] duration-500" style={{ backgroundColor: item.color, width: item.value ? `${Math.max(8, (item.value / maximum) * 100)}%` : "0%" }} />
            </div>
            <strong className="text-right tabular-nums">{item.value}</strong>
          </div>
        ))}
      </div>
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
  const maximum = Math.max(1, ...data.map((item) => item.value));
  const total = data.reduce((sum, item) => sum + item.value, 0);
  return (
    <figure className="rounded-xl border bg-white p-5 sm:p-6">
      <figcaption>
        <h2 className="section-title">Sales trend</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Daily invoice value for the last seven days.
        </p>
        <p className="mt-3 text-2xl font-semibold">{formatNaira(total)}</p>
      </figcaption>
      <div className="mt-6 grid h-52 grid-cols-7 items-end gap-2" role="img" aria-label={data.map((item) => `${item.date}: ${formatNaira(item.value)}`).join(", ")}>
        {data.map((item) => (
          <div key={item.date} className="flex h-full min-w-0 flex-col justify-end text-center">
            <span className="mb-1 truncate text-[10px] font-semibold text-[var(--muted)] sm:text-xs">
              {item.value > 0 ? formatNaira(item.value) : "—"}
            </span>
            <div className="flex h-36 items-end justify-center rounded-lg bg-emerald-50 px-1">
              <div
                className="w-full rounded-t-md bg-gradient-to-t from-emerald-800 to-emerald-400 transition-[height] duration-500"
                style={{ height: item.value ? `${Math.max(8, (item.value / maximum) * 100)}%` : "0%" }}
              />
            </div>
            <span className="mt-2 text-xs font-semibold">{item.label}</span>
            <span className="text-[10px] text-[var(--muted)]">{item.count} sale{item.count === 1 ? "" : "s"}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}

export function SalesPaymentMixChart({ data }: { data: readonly ChartDatum[] }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  return (
    <figure className="rounded-xl border bg-white p-5 sm:p-6">
      <figcaption>
        <h2 className="section-title">How customers paid</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">Paid, part-paid, and customer-credit invoices in the loaded period.</p>
      </figcaption>
      <div className="mt-5 grid items-center gap-6 sm:grid-cols-[minmax(9rem,12rem)_1fr]">
        <div className="relative mx-auto aspect-square w-full max-w-44 rounded-full" style={{ background: donutGradient(data) }} role="img" aria-label={data.map((item) => `${item.label}: ${item.value}`).join(", ")}>
          <div className="absolute inset-[22%] grid place-items-center rounded-full bg-white text-center shadow-inner">
            <div><strong className="block text-3xl tabular-nums">{total}</strong><span className="text-xs text-[var(--muted)]">sales</span></div>
          </div>
        </div>
        <ul className="grid gap-3">
          {data.map((item) => (
            <li key={item.label} className="flex items-center justify-between gap-4 rounded-lg bg-[#f5f7fc] px-3 py-2.5 text-sm">
              <span className="flex items-center gap-2.5"><span className="size-2.5 rounded-full" style={{ backgroundColor: item.color }} />{item.label}</span>
              <strong>{item.value}</strong>
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}
