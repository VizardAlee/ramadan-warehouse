// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CustomersPage from "@/app/(protected)/customers/page";

const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/features/administration/api", () => ({ callAdministration: api.call }));
vi.mock("@/features/customers/receivables-panel", () => ({ CustomerReceivablesPanel: () => <div>Invoice picker</div> }));
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
  it("records a traceable advance refund without invoice allocations and locks an uncertain retry", async () => {
    api.call.mockResolvedValueOnce({ customer: { advanceBalances: { general: 30000 } }, rows: [], bankAccounts: [{ id: "bank1", bankName: "Test Bank", accountName: "Refunds", accountNumberLast4: "1234" }] });
    api.call.mockRejectedValueOnce(new Error("Refund response interrupted"));
    api.call.mockResolvedValueOnce({ paymentNumber: "CRP-REFUND" });
    render(<CustomersPage />);
    fireEvent.click(screen.getAllByRole("button", { name: "Refund advance" })[0]!);
    expect(screen.getByText("Refund unused customer advance")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("option", { name: /Test Bank/ })).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Amount refunded (₦)"), { target: { value: "400" } });
    fireEvent.change(screen.getByLabelText(/Paying company account/), { target: { value: "bank1" } });
    fireEvent.change(screen.getByLabelText("Actual refund reference"), { target: { value: "BANK-REFUND-1" } });
    fireEvent.change(screen.getByLabelText("Refund reason"), { target: { value: "Customer cancels unused advance" } });
    expect(screen.getByRole("button", { name: "Record advance refund" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("Amount refunded (₦)"), { target: { value: "200.001" } });
    expect(screen.getByRole("button", { name: "Record advance refund" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("Amount refunded (₦)"), { target: { value: "200" } });
    fireEvent.click(screen.getByRole("button", { name: "Record advance refund" }));
    await waitFor(() => expect(screen.getAllByText("Refund response interrupted").length).toBeGreaterThan(0));
    expect(screen.getByLabelText("Refund reason").closest("fieldset")?.disabled).toBe(true);
    const first = api.call.mock.calls.find(([name]) => name === "recordCustomerPayment")![1];
    expect(first).toMatchObject({ purpose: "advance_refund", source: "receipt", method: "bank_transfer", bankAccountId: "bank1", amountMinor: 20000, notes: "Customer cancels unused advance", reference: "BANK-REFUND-1", allocations: [{ accountId: "general", amountMinor: 20000 }] });
    expect(first.invoiceAllocations).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Record advance refund" }));
    await waitFor(() => expect(api.call.mock.calls.filter(([name]) => name === "recordCustomerPayment")).toHaveLength(2));
    expect(api.call.mock.calls.filter(([name]) => name === "recordCustomerPayment")[1]![1]).toEqual(first);
  });
  it("preserves advance intent after a validation rejection and allows correction", async () => {
    api.call.mockResolvedValueOnce({ customer: {}, rows: [], bankAccounts: [] });
    api.call.mockRejectedValueOnce(Object.assign(new Error("Choose an active account"), { diagnosticCode: "functions/failed-precondition" }));
    api.call.mockResolvedValueOnce({ paymentNumber: "CRP-ADVANCE" });
    render(<CustomersPage />);
    fireEvent.click(screen.getAllByRole("button", { name: "Record advance" })[0]!);
    fireEvent.change(screen.getByLabelText("Amount received (₦)"), { target: { value: "100" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Record advance" }).at(-1)!);
    await waitFor(() => expect(screen.getAllByText("Choose an active account").length).toBeGreaterThan(0));
    expect(screen.getByText("Record customer advance")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Record advance" }).at(-1)!);
    await waitFor(() => expect(api.call.mock.calls.filter(([name]) => name === "recordCustomerPayment")).toHaveLength(2));
    expect(api.call.mock.calls.filter(([name]) => name === "recordCustomerPayment").every(([, input]) => input.purpose === "advance" && input.source === "receipt")).toBe(true);
  });
  it("allocates a receipt across arrangements without changing the receiving payment method", async () => {
    const accountId = "11111111-1111-4111-8111-111111111111";
    api.call.mockResolvedValueOnce({ customer: { arrangements: [{ id: "general", name: "General account", active: true, outstandingBalanceMinor: 5000 }, { id: accountId, name: "Installation project", active: true, outstandingBalanceMinor: 20000 }] }, rows: [], bankAccounts: [] });
    api.call.mockResolvedValueOnce({ paymentNumber: "CRP-3" });
    render(<CustomersPage />);
    fireEvent.click(screen.getAllByRole("button", { name: "Payment" })[0]!);
    await waitFor(() => expect(screen.getByRole("button", { name: "Split across arrangements" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Split across arrangements" }));
    const amounts = screen.getAllByLabelText("Allocated amount (₦)");
    fireEvent.change(amounts[0]!, { target: { value: "50" } });
    fireEvent.change(amounts[1]!, { target: { value: "200" } });
    fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
    await waitFor(() => expect(api.call).toHaveBeenCalledWith("recordCustomerPayment", expect.objectContaining({ method: "cash", amountMinor: 25000, allocations: [{ accountId: "general", amountMinor: 5000 }, { accountId, amountMinor: 20000 }] })));
  });
  it("retains a repayment retry key after an uncertain network response", async () => {
    api.call.mockResolvedValueOnce({ customer: {}, rows: [], bankAccounts: [] });
    api.call.mockRejectedValueOnce(new Error("Network interrupted; retry the same payment"));
    api.call.mockResolvedValueOnce({ paymentNumber: "CRP-4" });
    render(<CustomersPage />);
    fireEvent.click(screen.getAllByRole("button", { name: "Payment" })[0]!);
    await waitFor(() => expect(api.call).toHaveBeenCalledWith("getCustomerHistory", expect.any(Object)));
    fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
    await waitFor(() => expect(screen.getAllByText(/Network interrupted/).length).toBeGreaterThan(0));
    const first = api.call.mock.calls.find(([name]) => name === "recordCustomerPayment")![1];
    fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
    await waitFor(() => expect(api.call.mock.calls.filter(([name]) => name === "recordCustomerPayment")).toHaveLength(2));
    expect(api.call.mock.calls.filter(([name]) => name === "recordCustomerPayment")[1]![1].idempotencyKey).toBe(first.idempotencyKey);
  });
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
  it("allows correcting rejected payment details", async () => {
    api.call.mockResolvedValueOnce({ customer: {}, rows: [], bankAccounts: [] });
    api.call.mockRejectedValueOnce(Object.assign(new Error("Review allocations"), { diagnosticCode: "functions/invalid-argument" }));
    render(<CustomersPage />);
    fireEvent.click(screen.getAllByRole("button", { name: "Payment" })[0]!);
    await waitFor(() => expect(api.call).toHaveBeenCalledWith("getCustomerHistory", expect.any(Object)));
    fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
    await waitFor(() => expect(screen.getAllByText("Review allocations").length).toBeGreaterThan(0));
    expect(screen.queryByText(/Payment details are locked/)).toBeNull();
    expect(screen.getByLabelText("Method").closest("fieldset")?.disabled).toBe(false);
  });
  it("expands activity in place with readable financial meaning", async () => {
    api.call.mockResolvedValue({ customer: { creditLimitMinor: 100000, outstandingBalanceMinor: 25000, availableCreditMinor: 75000 }, rows: [{ id: "account:1", kind: "account", detail: "payment", reference: "PAY-1", amountMinor: 5000, at: "2026-10-04T10:00:00.000Z" }], moreAvailable: false });
    render(<CustomersPage />);
    const trigger = screen.getAllByRole("button", { name: "View history" })[0]!;
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    await waitFor(() => expect(screen.getAllByText(/Payment received · General account/).length).toBeGreaterThan(0));
    expect(api.call).toHaveBeenCalledWith("getCustomerHistory", expect.objectContaining({ customerId: "c1", branchId: "b1" }));
    expect(screen.getAllByRole("region", { name: "Amina Musa account history" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: /View full history/ })[0]!.getAttribute("href")).toBe("/customers/c1");
  });
});
