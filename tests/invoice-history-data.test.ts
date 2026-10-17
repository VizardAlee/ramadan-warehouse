import { describe, expect, it, vi } from "vitest";
import { filterInvoices, invoiceAccess, loadInvoiceRange, type InvoiceRow } from "@/features/invoices/invoice-history-data";
import type { UserProfile } from "@/types/domain";
const row = (id: string, extra: Partial<InvoiceRow> = {}): InvoiceRow => ({ id, saleNumber: `SALE-${id}`, receiptNumber: `REC-${id}`, branchId: "own", branchName: "Own store", customerNumber: "C-1", customerName: "Amina", paymentStatus: "partially_paid", recordedAt: "2026-10-10T12:00:00Z", grossAmountMinor: 1075, ...extra });
const filters = { branchId: "own", fromDate: "2026-10-01", toDate: "2026-10-17" };
describe("invoice history uses existing read contracts", () => {
  it("searches complete authorized pages without altering saved totals or status", async () => {
    const cursor = { recordedAt: "2026-10-10T12:00:00Z", saleId: "a" };
    const read = vi.fn().mockResolvedValueOnce({ rows: [row("a")], nextCursor: cursor }).mockResolvedValueOnce({ rows: [row("b", { customerName: "Zainab" })], nextCursor: null });
    const rows = await loadInvoiceRange(read, filters);
    expect(read).toHaveBeenLastCalledWith(expect.objectContaining({ ...filters, cursor, includeSummary: false, limit: 500 }));
    expect(filterInvoices(rows!, " zAInAb ", "partially_paid")).toEqual([row("b", { customerName: "Zainab" })]);
    expect(filterInvoices(rows!, "rec-b", "paid")).toEqual([]);
  });
  it("fails visibly on repeated cursors or an unexpected store rather than exposing partial results", async () => {
    await expect(loadInvoiceRange(async () => ({ rows: [], nextCursor: { recordedAt: "2026-10-10T12:00:00Z", saleId: "same" } }), filters)).rejects.toThrow(/paging/);
    await expect(loadInvoiceRange(async () => ({ rows: [row("foreign", { branchId: "remote" })], nextCursor: null }), filters)).rejects.toThrow(/selected store/);
  });
  it("stops reads when identity or filters change and refuses an incomplete oversized search", async () => {
    const read = vi.fn(); expect(await loadInvoiceRange(read, filters, () => true)).toBeNull(); expect(read).not.toHaveBeenCalled();
    let page = 0;
    await expect(loadInvoiceRange(async () => { const n = page++; return { rows: Array.from({ length: 500 }, (_, i) => row(String(n * 500 + i))), nextCursor: { recordedAt: "2026-10-10T12:00:00Z", saleId: String(n) } }; }, filters)).rejects.toThrow(/shorter range/);
  });
  it("keeps standard cashier history permission unchanged and branch managers local", () => {
    const profile = { status: "active", roleId: "sales_cashier", branchIds: ["own"] } as UserProfile;
    expect(invoiceAccess(profile)).toEqual({ allowed: false, global: false });
    expect(invoiceAccess({ ...profile, roleId: "branch_manager" })).toEqual({ allowed: true, global: false });
    expect(invoiceAccess({ ...profile, roleId: "finance_officer" })).toEqual({ allowed: true, global: true });
  });
});
