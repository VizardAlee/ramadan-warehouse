import type { DateTimeValue } from "@/types/domain";

export function formatNaira(minor: number | undefined): string { return minor === undefined ? "Restricted" : new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(minor / 100); }
export function formatQuantity(quantity: number | undefined): string { return new Intl.NumberFormat("en-NG", { maximumFractionDigits: 0 }).format(quantity ?? 0); }
export function formatDateTime(value: DateTimeValue | undefined): string { if (!value) return "—"; if (typeof value === "string") return new Date(value).toLocaleString(); return new Date(value.seconds * 1000).toLocaleString(); }
export function rowsToCsv(rows: readonly Record<string, unknown>[]): string { if (!rows.length) return ""; const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))]; const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`; return [columns.map(quote).join(","), ...rows.map((row) => columns.map((column) => quote(row[column])).join(","))].join("\n"); }
export function downloadCsv(filename: string, rows: readonly Record<string, unknown>[]) { const url = URL.createObjectURL(new Blob([rowsToCsv(rows)], { type: "text/csv;charset=utf-8" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url); }
