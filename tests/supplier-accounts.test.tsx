// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupplierAccounts } from "@/features/procurement/supplier-accounts";
import type { SupplierInvoice } from "@/types/domain";
const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/features/administration/api", () => ({ callAdministration: api.call }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const supplier = { id: "supplier1", organizationId: "org", supplierNumber: "SUP-1", name: "Test Supplier", active: true, paymentTermsDays: 0, outstandingBalanceMinor: 10000, advanceBalanceMinor: 5000, advanceBalancesByLocation: { "branch:branch1": 5000 } };
const invoice = { id: "invoice1", supplierId: supplier.id, supplierInvoiceNumber: "INV-1", outstandingAmountMinor: 10000, branchId: "branch1" } as SupplierInvoice;
const props = { suppliers: [supplier], banks: [{ id: "bank1", bankName: "Bank", accountName: "Company", accountNumberLast4: "1234" }], branches: [{ id: "branch1", name: "Head Office" }], scope: { branchId: "branch1" }, canPay: true, invoice, closeInvoice: vi.fn(), onComplete: vi.fn() };
const emptyPayables = { asOfDate: "2026-10-08", totalOutstandingMinor: 0, aging: [], invoices: [], nextCursor: null, note: "Current unpaid invoices" };
function statementResponse(statement: object) {
  api.call.mockImplementation((_name: string, input: { view?: string }) => Promise.resolve(input.view === "supplier_payables" ? emptyPayables : statement));
}
describe("supplier account workflow", () => {
  it("requires a receiving account and reason before recording an advance refund", async () => {
    statementResponse({ entries: [], nextCursor: null, openingPayableMinor: 0, closingPayableMinor: 0, openingAdvanceMinor: 5000, closingAdvanceMinor: 5000 });
    render(<SupplierAccounts {...props} invoice={null} />);
    fireEvent.change(screen.getByLabelText("Supplier account"), { target: { value: supplier.id } });
    fireEvent.click(screen.getByRole("button", { name: "Receive advance refund" }));
    expect(screen.getByRole("dialog", { name: "Receive supplier advance refund" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Supplier payment amount"), { target: { value: "25" } });
    expect((screen.getByRole("button", { name: "Record refund received" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Supplier refund receiving account"), { target: { value: "bank1" } });
    fireEvent.change(screen.getByLabelText("Payment reference"), { target: { value: "RETURNED-1" } });
    fireEvent.change(screen.getByLabelText("Refund reason (required)"), { target: { value: "Deposit no longer required" } });
    fireEvent.click(screen.getByRole("button", { name: "Record refund received" }));
    await waitFor(() => expect(api.call).toHaveBeenCalledWith("recordSupplierPayment", expect.objectContaining({ purpose: "advance_refund", branchId: "branch1", bankAccountId: "bank1", amountMinor: 2500, allocations: [], notes: "Deposit no longer required" })));
  });
  it("validates excess decimal places without crashing the payment dialog", () => {
    render(<SupplierAccounts {...props} />);
    fireEvent.change(screen.getByLabelText("Supplier payment amount"), { target: { value: "1.234" } });
    expect(screen.getByText("Enter an amount with no more than two decimal places.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Record payment" }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.call).not.toHaveBeenCalled();
  });
  it("keeps inactive supplier history accessible without offering a new advance", async () => {
    statementResponse({ entries: [], nextCursor: null, openingPayableMinor: 0, closingPayableMinor: 0, openingAdvanceMinor: 0, closingAdvanceMinor: 0, scopeNote: "Consolidated" });
    render(<SupplierAccounts {...props} suppliers={[{ ...supplier, active: false }]} invoice={null} />);
    fireEvent.change(screen.getByLabelText("Supplier account"), { target: { value: supplier.id } });
    await screen.findByText("No supplier activity in this period.");
    expect(screen.queryByRole("button", { name: "Record advance" })).toBeNull();
    expect(screen.getByRole("option", { name: /inactive/ })).toBeTruthy();
  });
  it("preserves the exact partial payment payload for uncertain retries", async () => {
    api.call.mockRejectedValueOnce(new Error("Connection interrupted")).mockResolvedValueOnce({ recorded: true });
    const complete = vi.fn();
    render(<SupplierAccounts {...props} onComplete={complete} />);
    fireEvent.change(screen.getByLabelText("Supplier payment amount"), { target: { value: "25" } });
    fireEvent.change(screen.getByLabelText("Supplier funding account"), { target: { value: "bank1" } });
    fireEvent.change(screen.getByLabelText("Payment reference"), { target: { value: "TRANSFER-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
    await screen.findByText("Connection interrupted");
    expect(screen.getByLabelText("Supplier payment amount").closest("fieldset")?.disabled).toBe(true);
    const original = api.call.mock.calls[0]![1];
    expect(original).toMatchObject({ supplierId: supplier.id, source: "disbursement", bankAccountId: "bank1", allocations: [{ supplierInvoiceId: invoice.id, amountMinor: 2500 }] });
    fireEvent.click(screen.getByRole("button", { name: "Retry same transaction" }));
    await waitFor(() => expect(complete).toHaveBeenCalledOnce());
    expect(api.call.mock.calls[1]![1]).toEqual(original);
  });
  it("applies an advance without requesting a new funding bank account", async () => {
    api.call.mockResolvedValue({ recorded: true });
    render(<SupplierAccounts {...props} scope={{ branchId: "another-viewed-store" }} />);
    fireEvent.change(screen.getByLabelText("Payment source"), { target: { value: "advance_balance" } });
    fireEvent.change(screen.getByLabelText("Supplier payment amount"), { target: { value: "30" } });
    expect(screen.queryByLabelText("Supplier funding account")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Apply advance" }));
    await waitFor(() => expect(api.call).toHaveBeenCalledWith("recordSupplierPayment", expect.objectContaining({ branchId: invoice.branchId, source: "advance_balance", bankAccountId: undefined, allocations: [{ supplierInvoiceId: invoice.id, amountMinor: 3000 }] })));
  });
  it("loads bounded statement pages and resets the cursor when dates change", async () => {
    statementResponse({ entries: [{ id: "entry1", entryType: "supplier_invoice", referenceNumber: "INV-1", amountMinor: 10000, effectiveAt: { seconds: 1791400000 } }], nextCursor: "entry1", openingPayableMinor: 3000, closingPayableMinor: 13000, openingAdvanceMinor: 0, closingAdvanceMinor: 5000, scopeNote: "Store-scoped statement" });
    render(<SupplierAccounts {...props} invoice={null} />);
    fireEvent.change(screen.getByLabelText("Supplier account"), { target: { value: supplier.id } });
    await screen.findByText("INV-1");
    expect(api.call).toHaveBeenLastCalledWith("getProcurementWorkspace", expect.objectContaining({ view: "supplier_account", supplierId: supplier.id, branchId: "branch1", limit: 25 }));
    fireEvent.click(within(screen.getByRole("region", { name: "Supplier account statement" })).getByRole("button", { name: "Next" }));
    await waitFor(() => expect(api.call).toHaveBeenLastCalledWith("getProcurementWorkspace", expect.objectContaining({ cursor: "entry1" })));
    fireEvent.change(screen.getByLabelText("Supplier statement from"), { target: { value: "2026-10-01" } });
    await waitFor(() => expect(api.call).toHaveBeenLastCalledWith("getProcurementWorkspace", expect.objectContaining({ from: "2026-10-01", cursor: undefined })));
  });
  it("pages unpaid invoices and opens their existing payment workflow", async () => {
    api.call.mockImplementation((_name: string, input: { view?: string }) => Promise.resolve(input.view === "supplier_payables"
      ? { ...emptyPayables, totalOutstandingMinor: 10000, aging: [{ name: "Due date not set", amountMinor: 10000 }], invoices: [invoice], nextCursor: invoice.id }
      : { entries: [], nextCursor: null, openingPayableMinor: 0, closingPayableMinor: 0, openingAdvanceMinor: 0, closingAdvanceMinor: 0 }));
    render(<SupplierAccounts {...props} invoice={null} />);
    fireEvent.change(screen.getByLabelText("Supplier account"), { target: { value: supplier.id } });
    await screen.findByText("Due date not set");
    const region = within(screen.getByRole("region", { name: "Supplier unpaid invoices" }));
    fireEvent.click(region.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(api.call).toHaveBeenCalledWith("getProcurementWorkspace", expect.objectContaining({ view: "supplier_payables", cursor: invoice.id, limit: 25 })));
    fireEvent.click(region.getByRole("button", { name: "Pay / apply advance" }));
    expect(screen.getByRole("dialog", { name: "Pay supplier invoice" })).toBeTruthy();
  });
});
