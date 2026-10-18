// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { AccountReceiptButton, AccountReceiptDialog } from "@/features/finance/account-receipt";
const api = vi.hoisted(() => vi.fn());
vi.mock("@/features/administration/api", () => ({ callAdministration: api }));
afterEach(() => { cleanup(); api.mockReset(); vi.restoreAllMocks(); });
const receipt: Parameters<typeof AccountReceiptDialog>[0]["receipt"] = {
  id: "payment", party: "customer", companyName: "Company", partyName: "Amina", partyNumber: "CUS-1", paymentNumber: "CRP-1", purpose: "repayment", direction: "inflow", source: "receipt", amountMinor: 10001, at: "2026-10-17T12:00:00Z", reference: "REF-1", notes: null, journalEntryId: "journal", balanceScope: "Organization-wide balances immediately after this transaction", outstandingAfterMinor: null, advanceAfterMinor: null,
  tenders: [{ method: "cash", amountMinor: 3333, bankName: null, accountName: null, accountNumberLast4: null, reference: null }, { method: "bank_transfer", amountMinor: 6668, bankName: "Bank", accountName: "Operating", accountNumberLast4: "1234", reference: "BANK-1" }], allocations: [{ invoiceNumber: "SAL-1", amountMinor: 10001, outstandingAfterMinor: null }], arrangements: [],
};
it("loads an authorized existing receipt and reprints without posting another payment", async () => {
  api.mockResolvedValue(receipt);
  const print = vi.spyOn(window, "print").mockImplementation(() => {});
  render(<AccountReceiptButton party="customer" partyId="customer" paymentId="payment" branchId="branch" />);
  fireEvent.click(screen.getByRole("button", { name: "Print receipt" }));
  expect((await screen.findByRole("dialog", { name: "Account payment receipt" })).hasAttribute("data-print-document-overlay")).toBe(true);
  expect(api).toHaveBeenCalledExactlyOnceWith("getCustomerHistory", { view: "payment_receipt", customerId: "customer", paymentId: "payment", branchId: "branch", warehouseId: undefined });
  expect(screen.getByText(/^Gross unpaid debt:/).textContent).toContain("Not recorded at payment");
  expect(screen.getByText(/^Unused advances \/ credits:/).textContent).toContain("Not recorded at payment");
  expect(within(screen.getByRole("table", { name: "Applied to invoices" })).getByRole("cell", { name: "Not recorded at payment" })).toBeTruthy();
  expect(screen.getByText(/••••1234/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Print receipt / save PDF" }));
  fireEvent.click(screen.getByRole("button", { name: "Print receipt / save PDF" }));
  expect(print).toHaveBeenCalledTimes(2); expect(api).toHaveBeenCalledTimes(1);
});
it("rejects a mismatched receipt and distinguishes advance application from new money", async () => {
  api.mockResolvedValue({ ...receipt, id: "other" });
  const view = render(<AccountReceiptButton party="supplier" partyId="supplier" paymentId="payment" warehouseId="warehouse" />);
  fireEvent.click(screen.getByRole("button", { name: "Print receipt" }));
  expect((await screen.findByRole("alert")).textContent).toContain("does not match"); expect(screen.queryByRole("dialog")).toBeNull();
  view.unmount();
  render(<AccountReceiptDialog receipt={{ ...receipt, direction: "non_cash", source: "advance_balance", tenders: [] }} onClose={() => {}} />);
  expect(screen.getByRole("dialog", { name: "Advance application record" }).textContent).toContain("No new cash, card or bank payment");
});
