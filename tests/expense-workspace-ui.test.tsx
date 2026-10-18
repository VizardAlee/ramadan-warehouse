// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExpensesPage from "@/app/(protected)/expenses/page";

const state = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({ user: { uid: "staff" }, profile: { organizationId: "org" }, operatingContext: null }) }));
vi.mock("@/lib/permissions/roles", () => ({ hasPermission: () => true, canSelfAuthorize: () => false }));
vi.mock("@/features/administration/api", () => ({ callAdministration: state.call }));
vi.mock("@/features/accounting/provider-funds", () => ({ ProviderFunds: () => <p>Separate provider workspace</p> }));
const access = { permissions: ["expenses.read", "expenses.create", "expenses.approve", "expenses.pay"], organizationPermissions: [], branchIds: ["own"], warehouseIds: [] };
const bill = (status = "approved", id = "bill") => ({ id, expenseNumber: `EXP-${id}`, branchId: "own", categoryName: "Utilities", payeeName: "Utility company", expenseDate: "2026-10-18", supplierDocumentNumber: "INV-01", description: "Monthly power bill", status, netAmountMinor: 10000, vatAmountMinor: 750, grossAmountMinor: 10750, outstandingAmountMinor: status === "paid" ? 0 : status === "partially_paid" ? 750 : 10750, createdBy: "other" });
const base = { categories: [], branches: [{ id: "own", name: "Own store", code: "A" }], warehouses: [], bankAccounts: [
  { id: "own-bank", branchId: "own", ledgerAccountCode: "1031", bankName: "Own Bank", accountName: "Store A", accountNumberLast4: "0001" },
  { id: "company-bank", branchId: null, ledgerAccountCode: "1032", bankName: "Company Bank", accountName: "Company", accountNumberLast4: "0002" },
  { id: "remote-bank", branchId: "remote", ledgerAccountCode: "1033", bankName: "Other Store Bank", accountName: "Store B", accountNumberLast4: "0003" },
] };
beforeEach(() => {
  state.call.mockReset();
  state.call.mockImplementation(async (name: string, input: Record<string, unknown>) => name === "getServiceBillingCase" ? { providers: [], nextCursorId: null } : name === "getExpenseWorkspace" && input.view === "access" ? access : name === "getExpenseWorkspace" ? { ...base, expenses: [bill()], nextCursor: null, scannedCount: 1 } : { recorded: true });
});
afterEach(() => { cleanup(); sessionStorage.clear(); });

describe("paged expense workspace", () => {
  it("loads a bounded register, filters on the server, and resets navigation on queue changes", async () => {
    state.call.mockImplementation(async (name: string, input: Record<string, unknown>) => {
      if (name === "getServiceBillingCase") return { providers: [], nextCursorId: null };
      if (input.view === "access") return access;
      return { ...base, expenses: input.cursor ? [bill("paid", "second")] : input.status === "paid" ? [bill("paid", "history")] : [bill()], nextCursor: input.cursor || input.status ? null : "page-two", scannedCount: 25 };
    });
    render(<ExpensesPage />);
    await screen.findByText("EXP-bill");
    expect(state.call).toHaveBeenCalledWith("getExpenseWorkspace", { branchId: "own", limit: 25 });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("EXP-second");
    expect(screen.queryByText("EXP-bill")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Paid history" }));
    await screen.findByText("EXP-history");
    expect(state.call.mock.calls.filter(([name, input]) => name === "getExpenseWorkspace" && input.view !== "access").at(-1)![1]).toEqual({ branchId: "own", limit: 25, status: "paid" });
    fireEvent.change(screen.getByLabelText("Find a bill"), { target: { value: "INV-01" } });
    fireEvent.change(screen.getByLabelText("Bill date from"), { target: { value: "2026-10-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    await waitFor(() => expect(state.call).toHaveBeenCalledWith("getExpenseWorkspace", { branchId: "own", limit: 25, status: "paid", search: "INV-01", fromDate: "2026-10-01" }));
  });
  it("keeps an empty scanned page navigable and reports loading errors without a false empty register", async () => {
    state.call.mockImplementation(async (name: string, input: Record<string, unknown>) => name === "getServiceBillingCase" ? { providers: [], nextCursorId: null } : input.view === "access" ? access : input.cursor ? { ...base, expenses: [bill("paid", "match")], nextCursor: null } : { ...base, expenses: [], nextCursor: "continue-scan", scannedCount: 500 });
    render(<ExpensesPage />);
    await screen.findByText(/No matching bills on this page. Continue with Next/);
    expect(screen.getByRole("button", { name: "Next" }).hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("EXP-match");
    state.call.mockRejectedValue(new Error("Expense read failed"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByText("Expense read failed");
    expect(screen.queryByText(/No matching bills/)).toBeNull();
  });
  it("filters incompatible bank accounts and preserves exact partial payment amounts", async () => {
    render(<ExpensesPage />);
    const bank = await screen.findByLabelText("Company bank account");
    expect(within(bank).getAllByRole("option").map(x => (x as HTMLOptionElement).value)).toEqual(["", "own-bank", "company-bank"]);
    expect(screen.queryByRole("option", { name: /Other Store Bank/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("Payment amount in naira"), { target: { value: "14.55" } });
    fireEvent.change(bank, { target: { value: "own-bank" } });
    fireEvent.change(screen.getByLabelText("Payment reference"), { target: { value: "BANK-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
    await waitFor(() => expect(state.call).toHaveBeenCalledWith("recordExpensePayment", expect.objectContaining({ expenseId: "bill", amountMinor: 1455, bankAccountId: "own-bank", method: "bank_transfer", reference: "BANK-01" })));
  });
  it("retains saved payment instructions across queue changes and retries the identical instruction", async () => {
    const saved = { name: "recordExpensePayment", input: { expenseId: "old-bill", amountMinor: 1455, method: "cash", paidAt: "2026-10-18T08:00:00Z", idempotencyKey: "fixed-original-key" } };
    sessionStorage.setItem("abr-pending-expense:org:staff", JSON.stringify(saved));
    render(<ExpensesPage />);
    await screen.findByText("EXP-bill");
    fireEvent.click(screen.getByRole("button", { name: "Ready to pay" }));
    await waitFor(() => expect(state.call).toHaveBeenCalledWith("getExpenseWorkspace", { branchId: "own", limit: 25, status: "ready" }));
    const retry = screen.getByRole("button", { name: "Retry saved expense instructions" });
    await waitFor(() => expect(retry.hasAttribute("disabled")).toBe(false));
    fireEvent.click(retry);
    await screen.findByText("Saved expense operation confirmed.");
    expect(state.call.mock.calls.filter(([name]) => name === "recordExpensePayment").map(([, data]) => data)).toEqual([saved.input]);
  });
  it("loads additional bank choices without losing the current register or payment draft", async () => {
    state.call.mockImplementation(async (name: string, input: Record<string, unknown>) => name === "getServiceBillingCase" ? { providers: [], nextCursorId: null } : input.view === "access" ? access : input.view === "choices" ? { kind: "bankAccounts", items: [{ id: "extra", bankName: "Extra Bank", accountName: "Company", accountNumberLast4: "4444", ledgerAccountCode: "1044" }], nextCursorId: null } : { ...base, expenses: [bill()], lookupNextCursors: { bankAccounts: "last-bank" } });
    render(<ExpensesPage />);
    fireEvent.change(await screen.findByLabelText("Payment amount in naira"), { target: { value: "14.55" } });
    fireEvent.click(screen.getByRole("button", { name: "Load more bank accounts" }));
    await screen.findByRole("option", { name: /Extra Bank/ });
    expect((screen.getByLabelText("Payment amount in naira") as HTMLInputElement).value).toBe("14.55");
    expect(screen.getByText("EXP-bill")).toBeTruthy();
    expect(state.call).toHaveBeenCalledWith("getExpenseWorkspace", { view: "choices", branchId: "own", choiceKind: "bankAccounts", choiceCursor: "last-bank" });
  });
  it("explains approval boundaries and does not treat drafts as paid or posted", async () => {
    state.call.mockImplementation(async (name: string, input: Record<string, unknown>) => name === "getServiceBillingCase" ? { providers: [], nextCursorId: null } : input.view === "access" ? access : { ...base, expenses: [{ ...bill("submitted"), createdBy: "staff" }, bill("draft", "draft")] });
    render(<ExpensesPage />);
    await screen.findByText("This role requires another approver");
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.getByText("Draft · not posted")).toBeTruthy();
    expect(screen.getAllByText(/Not posted or paid/)).toHaveLength(2);
    expect(screen.getByText(/Approval recognizes the expense and payable, not a bank payment/)).toBeTruthy();
  });
  it("keeps creation collapsed, previews exact totals, and blocks invalid money and reversed dates", async () => {
    render(<ExpensesPage />);
    await screen.findByText("EXP-bill");
    expect((screen.getByText("Record a new operating bill").closest("details") as HTMLDetailsElement).open).toBe(false);
    fireEvent.click(screen.getByText("Record a new operating bill"));
    fireEvent.change(screen.getByLabelText("Net amount (₦)"), { target: { value: "14.55" } });
    fireEvent.change(screen.getByLabelText("VAT (₦)"), { target: { value: "1.23" } });
    expect(screen.getByText(/Draft bill total/).textContent).toContain("15.78");
    fireEvent.change(screen.getByLabelText("VAT (₦)"), { target: { value: "-1" } });
    expect(screen.getByRole("button", { name: "Create draft expense" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("Bill date from"), { target: { value: "2026-10-20" } });
    fireEvent.change(screen.getByLabelText("Bill date to"), { target: { value: "2026-10-18" } });
    expect(screen.getByRole("button", { name: "Apply filters" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/The last bill date must be on or after/)).toBeTruthy();
  });
});
