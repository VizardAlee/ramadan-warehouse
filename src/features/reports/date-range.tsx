"use client";

export type ReportPeriod = "daily" | "weekly" | "monthly" | "custom";
export function reportDateRange(period: Exclude<ReportPeriod, "custom">, now = new Date()) {
  const toDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const start = new Date(`${toDate}T00:00:00Z`);
  if (period === "weekly") start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  if (period === "monthly") start.setUTCDate(1);
  return { fromDate: start.toISOString().slice(0, 10), toDate };
}
export function ReportPeriodPicker({ value, onChange }: { value: ReportPeriod; onChange: (value: ReportPeriod) => void }) {
  return <label className="text-sm font-medium">Period<select className="mt-1 w-full rounded-lg border p-2.5" value={value} onChange={event => onChange(event.target.value as ReportPeriod)}><option value="daily">Daily · today</option><option value="weekly">Weekly · Monday to today</option><option value="monthly">Monthly · month to today</option><option value="custom">Custom range</option></select></label>;
}
