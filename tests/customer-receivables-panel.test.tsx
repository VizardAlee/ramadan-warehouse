// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CustomerReceivablesPanel } from "@/features/customers/receivables-panel";
const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/features/administration/api", () => ({ callAdministration: api.call }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const invoice = { id: "s1", reference: "INV-1", accountId: "general", accountName: "General account", dueDate: null, outstandingMinor: 10000, paidMinor: 3000, creditedMinor: 0 };
describe("customer receivables panel", () => {
  it("shows real aging, explicit historical debt and bounded cursor pages", async () => {
    api.call.mockResolvedValue({ invoices: [invoice], aging: [{ name: "1–30 days", amountMinor: 10000 }], historicalUnallocatedMinor: 5000, advanceBalances: { general: 2000 }, nextCursor: { sale: "s1" } });
    render(<CustomerReceivablesPanel customerId="c1" branchId="b1" />);
    await screen.findByText("INV-1");
    expect(screen.getByText(/Historical debt without verified/)).toBeTruthy();
    expect(screen.getByText("Not set")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(api.call).toHaveBeenLastCalledWith("getCustomerHistory", expect.objectContaining({ view: "receivables", branchId: "b1", limit: 25, cursor: { sale: "s1" } })));
  });
  it("selects an invoice without creating a payment or leaving the dialog", async () => {
    api.call.mockResolvedValue({ invoices: [invoice], aging: [], historicalUnallocatedMinor: 0, advanceBalances: {}, nextCursor: null });
    const select = vi.fn();
    render(<CustomerReceivablesPanel customerId="c1" onSelect={select} />);
    fireEvent.click(await screen.findByRole("button", { name: "Pay invoice" }));
    expect(select).toHaveBeenCalledWith(invoice);
    expect(api.call).toHaveBeenCalledTimes(1);
  });
});
