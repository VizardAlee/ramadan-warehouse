import { describe, expect, it } from "vitest";
import { recordSupplierPaymentInput, procurementWorkspaceInput, submitSupplierInvoiceInput } from "../functions/src/validation/procurement";
const base = { supplierId: "supplier", method: "cash", paidAt: "2026-10-08T10:00:00Z", idempotencyKey: "08a610c3-3012-414b-82de-f921b982defb" };
describe("supplier payment validation", () => {
  it("requires explicit advance amount and operating location", () => {
    expect(recordSupplierPaymentInput.safeParse({ ...base, purpose: "advance", amountMinor: 1000 }).success).toBe(false);
    expect(recordSupplierPaymentInput.safeParse({ ...base, purpose: "advance", amountMinor: 1000, branchId: "head-office" }).success).toBe(true);
    expect(recordSupplierPaymentInput.safeParse({ ...base, purpose: "advance", amountMinor: 1000, branchId: "head-office", allocations: [{ supplierInvoiceId: "invoice", amountMinor: 1 }] }).success).toBe(false);
  });
  it("rejects duplicate/unsafe allocations and bank details for advance application", () => {
    const allocations = [{ supplierInvoiceId: "invoice", amountMinor: 500 }];
    expect(recordSupplierPaymentInput.safeParse({ ...base, source: "advance_balance", allocations }).success).toBe(true);
    expect(recordSupplierPaymentInput.safeParse({ ...base, source: "advance_balance", allocations, bankAccountId: "bank" }).success).toBe(false);
    expect(recordSupplierPaymentInput.safeParse({ ...base, allocations: [...allocations, ...allocations] }).success).toBe(false);
    expect(recordSupplierPaymentInput.safeParse({ ...base, allocations: [{ supplierInvoiceId: "a", amountMinor: Number.MAX_SAFE_INTEGER }, { supplierInvoiceId: "b", amountMinor: 1 }] }).success).toBe(false);
  });
  it("requires supplier identity and ordered statement dates", () => {
    expect(procurementWorkspaceInput.safeParse({ view: "supplier_account" }).success).toBe(false);
    expect(procurementWorkspaceInput.safeParse({ view: "supplier_payables" }).success).toBe(false);
    expect(procurementWorkspaceInput.safeParse({ view: "supplier_account", supplierId: "supplier", from: "2026-10-08", through: "2026-10-01" }).success).toBe(false);
  });
  it("validates invoice due dates and rejects duplicate billed items", () => {
    const invoice = { purchaseOrderId: "order", supplierInvoiceNumber: "SUP-1", invoiceDate: "2026-10-08", lines: [{ purchaseOrderItemId: "item", quantity: 1 }], idempotencyKey: base.idempotencyKey };
    expect(submitSupplierInvoiceInput.safeParse(invoice).success).toBe(true);
    expect(submitSupplierInvoiceInput.safeParse({ ...invoice, dueDate: "2026-10-09" }).success).toBe(true);
    expect(submitSupplierInvoiceInput.safeParse({ ...invoice, dueDate: "2026-10-07" }).success).toBe(false);
    expect(submitSupplierInvoiceInput.safeParse({ ...invoice, lines: [...invoice.lines, ...invoice.lines] }).success).toBe(false);
  });
});
