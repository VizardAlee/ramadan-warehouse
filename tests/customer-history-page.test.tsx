// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CustomerHistoryPage from "@/app/(protected)/customers/[customer_id]/page";

const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("next/navigation", () => ({ useParams: () => ({ customer_id: "c1" }) }));
vi.mock("@/features/administration/api", () => ({ callAdministration: api.call }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({
  profile: { status: "active", roleId: "system_administrator", roleIds: ["system_administrator"] },
  accessProfile: { branchIds: ["b1"] },
  operatingContext: { type: "branch", id: "b1" },
}) }));
vi.mock("@/features/administration/use-organization-collection", () => ({ useOrganizationCollection: () => ({
  data: [{ id: "b1", name: "Head Office", status: "active" }], loading: false, error: null,
}) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("customer full history", () => {
  it("switches to a separate statement and resets pagination on arrangement changes", async () => {
    const customer = { id: "c1", name: "Amina Musa", customerNumber: "CUS-000001", creditStatus: "approved", creditLimitMinor: 100000, outstandingBalanceMinor: 25000, availableCreditMinor: 75000,
      arrangements: [{ id: "general", name: "General account", active: true, outstandingBalanceMinor: 5000 }, { id: "solar", name: "Solar project", active: true, outstandingBalanceMinor: 20000 }] };
    api.call.mockImplementation((_name, input) => Promise.resolve(input.view === "receivables" ? { invoices: [], aging: [], historicalUnallocatedMinor: 0, advanceBalances: {}, nextCursor: null } : {
      customer, rows: [], moreAvailable: input.view === "statement", nextCursor: input.view === "statement" ? { account: "scan-end" } : null,
      ...(input.view === "statement" ? { statement: { accountId: input.customerAccountId ?? null, accountName: input.customerAccountId === "solar" ? "Solar project" : "All arrangements", outstandingMinor: 20000, advanceMinor: 5000, asOf: "2026-10-09T10:00:00Z", scannedCount: 25 } } : {}),
    }));
    render(<CustomerHistoryPage />);
    await screen.findByText("Amina Musa");
    fireEvent.click(screen.getByRole("button", { name: "Account statement" }));
    await screen.findByText("Unused customer advance");
    fireEvent.click(screen.getAllByRole("button", { name: "Next" }).find(button => !button.hasAttribute("disabled"))!);
    await waitFor(() => expect(api.call).toHaveBeenCalledWith("getCustomerHistory", expect.objectContaining({ view: "statement", cursor: { account: "scan-end" } })));
    fireEvent.change(screen.getByLabelText("Statement arrangement"), { target: { value: "solar" } });
    await waitFor(() => expect(api.call).toHaveBeenCalledWith("getCustomerHistory", expect.objectContaining({ view: "statement", customerAccountId: "solar", cursor: undefined })));
    expect(screen.getByText(/This page is not an opening\/closing balance reconciliation/)).toBeTruthy();
  });
  it("loads bounded pages and advances using the returned cursor", async () => {
    const customer = { id: "c1", name: "Amina Musa", customerNumber: "CUS-000001", creditStatus: "approved", creditLimitMinor: 100000, outstandingBalanceMinor: 25000, availableCreditMinor: 75000 };
    api.call.mockImplementation((_name, input) => Promise.resolve(input.view === "receivables" ? { invoices: [], aging: [], historicalUnallocatedMinor: 0, advanceBalances: {}, nextCursor: null } : input.cursor ? { customer, rows: [{ id: "sale:2", kind: "sale", detail: "paid", reference: "SALE-2", amountMinor: 10000, at: "2026-10-03T10:00:00.000Z" }], moreAvailable: false, nextCursor: null } : { customer, rows: [{ id: "account:1", kind: "account", detail: "payment", reference: "PAY-1", amountMinor: 5000, at: "2026-10-04T10:00:00.000Z" }], moreAvailable: true, nextCursor: { account: "1" } }));
    render(<CustomerHistoryPage />);
    await waitFor(() => expect(screen.getAllByText(/Payment received · General account/).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole("button", { name: "Next" }).find((button) => !button.hasAttribute("disabled"))!);
    await waitFor(() => expect(api.call).toHaveBeenLastCalledWith("getCustomerHistory", expect.objectContaining({ customerId: "c1", limit: 25, cursor: { account: "1" } })));
    await waitFor(() => expect(screen.getAllByText("SALE-2").length).toBeGreaterThan(0));
  });
});
