/** Read-only executive view. Money is stored and returned in NGN minor units. */
export interface CeoMetric {
  id: string;
  label: string;
  value: number | null;
  money: boolean;
  basis: "period" | "current";
  detail: string;
  href: string;
  state: "ready" | "unavailable" | "not_configured";
}
export interface CeoDashboard {
  asOf: string;
  fromDate: string;
  toDate: string;
  branchId: string | null;
  metrics: CeoMetric[];
  trend: Array<{ fromDate: string; toDate: string; invoicedMinor: number; checkoutReceiptsMinor: number }> | null;
  comparison: { invoicedMinor: number; fromDate: string; toDate: string } | null;
  branches: Array<{ id: string; name: string; invoicedMinor: number | null }>;
  nextBranchCursor: string | null;
  branchError: boolean;
  billingConfigured: boolean | null;
}

export function ceoDateRange(fromDate: string, toDate: string, today: string) {
  const start = Date.parse(`${fromDate}T00:00:00+01:00`);
  const end = Date.parse(`${toDate}T00:00:00+01:00`) + 86_400_000;
  const days = (end - start) / 86_400_000;
  if (!Number.isInteger(days) || days < 1 || days > 366 || toDate > today)
    throw new Error("Choose a completed or current period of up to 366 days.");
  const date = (ms: number) => new Date(ms + 3_600_000).toISOString().slice(0, 10);
  const width = Math.ceil(days / 12);
  const buckets = Array.from({ length: Math.ceil(days / width) }, (_, index) => {
    const from = start + index * width * 86_400_000, to = Math.min(end, from + width * 86_400_000);
    return { start: from, end: to, fromDate: date(from), toDate: date(to - 1) };
  });
  return { start, end, days, buckets, previousStart: start - days * 86_400_000,
    previousFromDate: date(start - days * 86_400_000), previousToDate: date(start - 1) };
}
