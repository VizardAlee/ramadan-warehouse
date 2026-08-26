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
            <li key={item.label} className="flex items-center justify-between gap-4 rounded-lg bg-[#f7faf8] px-3 py-2.5">
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
        <div><h2 className="section-title">Transfer pipeline</h2><p className="mt-1 text-sm text-[var(--muted)]">Where active warehouse movements need attention.</p></div>
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-[var(--brand)]">{total} active</span>
      </figcaption>
      <div className="mt-6 grid gap-4" role="img" aria-label={data.map((item) => `${item.label}: ${item.value}`).join(", ")}>
        {data.map((item) => (
          <div key={item.label} className="grid grid-cols-[7.5rem_minmax(0,1fr)_2rem] items-center gap-3 text-sm sm:grid-cols-[9rem_minmax(0,1fr)_2.5rem]">
            <span className="truncate text-[var(--muted)]">{item.label}</span>
            <div className="h-3 overflow-hidden rounded-full bg-[#edf2ef]">
              <div className="h-full min-w-0 rounded-full transition-[width] duration-500" style={{ backgroundColor: item.color, width: item.value ? `${Math.max(8, (item.value / maximum) * 100)}%` : "0%" }} />
            </div>
            <strong className="text-right tabular-nums">{item.value}</strong>
          </div>
        ))}
      </div>
    </figure>
  );
}
