import type { DateTimeValue } from "@/types/domain";

export function nairaToKobo(naira: number): number {
  const kobo = Math.round(naira * 100);
  if (
    !Number.isFinite(naira) ||
    naira < 0 ||
    !Number.isSafeInteger(kobo) ||
    Math.abs(naira * 100 - kobo) > 1e-6
  )
    throw new Error("Enter a valid naira amount with no more than two decimal places.");
  return kobo;
}

export function koboToNaira(kobo: number | undefined): number | undefined {
  return kobo === undefined ? undefined : kobo / 100;
}

export function formatNaira(minor: number | undefined): string { return minor === undefined ? "Restricted" : new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100); }
export function formatQuantity(quantity: number | undefined): string { return new Intl.NumberFormat("en-NG", { maximumFractionDigits: 0 }).format(quantity ?? 0); }
const lagosDateTime = new Intl.DateTimeFormat("en-NG", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" });
export function formatDateTime(value: DateTimeValue | undefined): string { if (!value) return "—"; const date = typeof value === "string" ? new Date(value) : new Date(value.seconds * 1000); return Number.isNaN(date.valueOf()) ? "—" : lagosDateTime.format(date); }
export function rowsToCsv(rows: readonly Record<string, unknown>[]): string { if (!rows.length) return ""; const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))]; const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`; return [columns.map(quote).join(","), ...rows.map((row) => columns.map((column) => quote(row[column])).join(","))].join("\n"); }
export function downloadCsv(filename: string, rows: readonly Record<string, unknown>[]) { const url = URL.createObjectURL(new Blob([rowsToCsv(rows)], { type: "text/csv;charset=utf-8" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url); }
