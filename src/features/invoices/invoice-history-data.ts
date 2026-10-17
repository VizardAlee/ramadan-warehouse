import { hasPermission, roleIdsForProfile } from "@/lib/permissions/roles";
import type { UserProfile } from "@/types/domain";

export interface InvoiceRow {
  id: string; saleNumber: string; receiptNumber: string; branchId: string; branchName: string;
  customerNumber: string; customerName: string; paymentStatus?: string;
  grossAmountMinor: number; recordedAt: string | null;
}
export interface InvoiceCursor { recordedAt: string; saleId: string }
interface InvoicePage { rows: InvoiceRow[]; nextCursor: InvoiceCursor | null }
export interface InvoiceFilters { branchId?: string; fromDate: string; toDate: string }

/** Mirrors existing generateSalesReport scope; never grants a report permission. */
export function invoiceAccess(profile: UserProfile | null | undefined) {
  return {
    allowed: Boolean(profile && hasPermission(profile, "reports.sales.read")),
    global: Boolean(profile && roleIdsForProfile(profile).some(role =>
      ["system_administrator", "operations_administrator", "finance_officer", "auditor"].includes(role))),
  };
}

/** Search only a complete, bounded set from the existing authorized sales register. */
export async function loadInvoiceRange(
  read: (input: object) => Promise<InvoicePage>, filters: InvoiceFilters,
  cancelled: () => boolean = () => false,
): Promise<InvoiceRow[] | null> {
  const rows = new Map<string, InvoiceRow>(), seen = new Set<string>();
  let cursor: InvoiceCursor | undefined;
  for (let page = 0; page < 25; page++) {
    if (cancelled()) return null;
    const result = await read({ reportType: "sales_register", ...filters, includeSummary: false, limit: 500, ...(cursor ? { cursor } : {}) });
    if (cancelled()) return null;
    if (!Array.isArray(result.rows) || result.rows.some(row => !row.id || !row.branchId || (filters.branchId && row.branchId !== filters.branchId)))
      throw new Error("Invoice history could not verify the selected store. Refresh your access and try again.");
    for (const row of result.rows) rows.set(row.id, row);
    if (rows.size > 10000) break;
    if (!result.nextCursor) return [...rows.values()];
    const next = JSON.stringify(result.nextCursor);
    if (seen.has(next)) throw new Error("Invoice history paging could not be completed. Refresh and try again.");
    seen.add(next); cursor = result.nextCursor;
  }
  throw new Error("This date range is too large to search completely. Choose a shorter range (up to 10,000 invoices).");
}

export function filterInvoices(rows: InvoiceRow[], search: string, paymentStatus: string) {
  const term = search.trim().toLocaleLowerCase();
  return rows.filter(row => (!paymentStatus || row.paymentStatus === paymentStatus) &&
    `${row.saleNumber} ${row.receiptNumber} ${row.customerNumber} ${row.customerName}`.toLocaleLowerCase().includes(term));
}

export function downloadInvoiceHistory(rows: InvoiceRow[]) {
  const cell = (value: unknown) => {
    const raw = String(value ?? ""), safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const csv = [["invoice", "receipt", "issued_at", "branch", "customer", "recorded_payment_status", "invoice_total_naira"],
    ...rows.map(row => [row.saleNumber, row.receiptNumber, row.recordedAt, row.branchName, row.customerName, row.paymentStatus, (row.grossAmountMinor / 100).toFixed(2)])]
    .map(row => row.map(cell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = "invoice-history.csv"; anchor.click(); URL.revokeObjectURL(url);
}
