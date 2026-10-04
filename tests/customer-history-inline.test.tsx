// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CustomersPage from "@/app/(protected)/customers/page";

const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/features/administration/api", () => ({ callAdministration: api.call }));
vi.mock("@/features/customers/use-customer-register", () => ({ useCustomerRegister: () => ({
  data: [{ id: "c1", name: "Amina Musa", customerNumber: "CUS-000001", creditStatus: "approved", creditLimitMinor: 100000, outstandingBalanceMinor: 25000, availableCreditMinor: 75000, active: true }],
  loading: false, error: null, page: 1, pageSize: 25, hasNextPage: false,
  updateSearch: vi.fn(), updatePageSize: vi.fn(), nextPage: vi.fn(), previousPage: vi.fn(),
}) }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({
  profile: { status: "active", roleId: "system_administrator", roleIds: ["system_administrator"] },
  accessProfile: { branchIds: ["b1"] },
  operatingContext: { type: "branch", id: "b1" },
}) }));
vi.mock("@/features/administration/use-organization-collection", () => ({
  useOrganizationCollection: (name: string) => ({
    data: name === "branches" ? [{ id: "b1", name: "Head Office", status: "active" }] : [],
    loading: false,
    error: null,
  }),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("customer account history", () => {
  it("requires and submits the receiving account for bank repayments", async () => {
    api.call.mockResolvedValueOnce({ customer: {}, rows: [], bankAccounts: [{ id: "bank1", bankName: "Test Bank", accountName: "Collections", accountNumberLast4: "1234" }] });
    api.call.mockResolvedValueOnce({ paymentNumber: "PAY-2" });
    render(<CustomersPage />);
    fireEvent.click(screen.getAllByRole("button", { name: "Payment" })[0]!);
    fireEvent.change(screen.getByLabelText("Method"), { target: { value: "bank_transfer" } });
    expect(screen.getByRole("button", { name: "Record payment" }).hasAttribute("disabled")).toBe(true);
    await waitFor(() => expect(screen.getByRole("option", { name: /Test Bank/ })).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/Receiving company account/), { target: { value: "bank1" } });
    fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
    await waitFor(() => expect(api.call).toHaveBeenCalledWith("recordCustomerPayment", expect.objectContaining({ bankAccountId: "bank1", method: "bank_transfer", amountMinor: 25000 })));
  });
  it("expands activity in place with readable financial meaning", async () => {
    api.call.mockResolvedValue({ customer: { creditLimitMinor: 100000, outstandingBalanceMinor: 25000, availableCreditMinor: 75000 }, rows: [{ id: "account:1", kind: "account", detail: "payment", reference: "PAY-1", amountMinor: 5000, at: "2026-10-04T10:00:00.000Z" }], moreAvailable: false });
    render(<CustomersPage />);
    const trigger = screen.getAllByRole("button", { name: "View history" })[0]!;
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    await waitFor(() => expect(screen.getAllByText("Payment received").length).toBeGreaterThan(0));
    expect(api.call).toHaveBeenCalledWith("getCustomerHistory", expect.objectContaining({ customerId: "c1", branchId: "b1" }));
    expect(screen.getAllByRole("region", { name: "Amina Musa account history" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: /View full history/ })[0]!.getAttribute("href")).toBe("/customers/c1");
  });
});
