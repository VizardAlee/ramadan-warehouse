// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ExpensesPage from "@/app/(protected)/expenses/page";
const state = vi.hoisted(() => ({ call: vi.fn(), params: new URLSearchParams("caseId=service-job&branchId=store-a"), auth: { user: { uid: "user" }, profile: { organizationId: "org" }, operatingContext: { type: "branch", id: "store-a" } } }));
vi.mock("next/navigation", () => ({ useSearchParams: () => state.params }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => state.auth }));
vi.mock("@/features/administration/api", () => ({ callAdministration: (name: string, input: Record<string, unknown>) => name === "getServiceBillingCase" ? Promise.resolve({ providers: [], nextCursorId: null }) : name === "providerFunds" ? Promise.resolve({ rows: [], nextCursorId: null, summary: null, scannedInvoices: 0 }) : state.call(name, input) }));
vi.mock("@/lib/permissions/roles", () => ({ hasPermission: () => true, canSelfAuthorize: () => true }));
const workspace = { categories: [], branches: [{ id: "store-a", name: "Head Office", code: "HQ" }], warehouses: [], expenses: [], bankAccounts: [] };
afterEach(() => { cleanup(); sessionStorage.clear(); vi.resetAllMocks(); state.auth.operatingContext.id = "store-a"; });
describe("outsourced bill interface", () => {
  it("accepts ordinary two-decimal partial payments without binary-float rejection", async () => {
    state.call.mockImplementation(name => name === "getExpenseWorkspace" ? Promise.resolve({ ...workspace, expenses: [{ id: "bill", expenseNumber: "EXP-001", categoryName: "Service", payeeName: "Technician", status: "approved", netAmountMinor: 2000, vatAmountMinor: 0, grossAmountMinor: 2000, outstandingAmountMinor: 2000, description: "Customer installation", createdBy: "user" }] }) : Promise.reject(new Error("Interrupted")));
    render(<ExpensesPage />);
    const amount = await screen.findByLabelText("Payment amount in naira");
    fireEvent.change(amount, { target: { value: "14.55" } });
    fireEvent.change(screen.getByLabelText("Payment method"), { target: { value: "cash" } });
    const pay = screen.getByRole("button", { name: "Record payment" });
    await waitFor(() => expect(pay.hasAttribute("disabled")).toBe(false));
    fireEvent.click(pay);
    await screen.findByRole("button", { name: "Retry saved expense instructions" });
    expect(state.call.mock.calls.find(call => call[0] === "recordExpensePayment")![1]).toMatchObject({ amountMinor: 1455, method: "cash" });
  });
  it("preserves an uncertain bill across reload and retries the original payload", async () => {
    state.call.mockImplementation(name => name === "getExpenseWorkspace" ? Promise.resolve(workspace) : Promise.reject(new Error("Connection interrupted")));
    const view = render(<ExpensesPage />);
    await waitFor(() => expect((screen.getByLabelText("Category").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Installation" } });
    fireEvent.change(screen.getByLabelText("Payee"), { target: { value: "Contract technician" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Installation work for customer" } });
    fireEvent.change(screen.getByLabelText("Net amount (₦)"), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Create draft expense" }));
    await screen.findByRole("button", { name: "Retry saved expense instructions" });
    const first = state.call.mock.calls.find(call => call[0] === "createExpense")![1];
    expect(first).toMatchObject({ branchId: "store-a", costPurpose: "service", costReferenceType: "aftersales", costReferenceId: "service-job", netAmountMinor: 50000 });
    expect((screen.getByLabelText("Description") as HTMLTextAreaElement).value).toBe("Installation work for customer");
    view.unmount(); state.call.mockImplementation(name => Promise.resolve(name === "getExpenseWorkspace" ? workspace : { created: false }));
    render(<ExpensesPage />);
    const retry = await screen.findByRole("button", { name: "Retry saved expense instructions" });
    await waitFor(() => expect(retry.hasAttribute("disabled")).toBe(false));
    fireEvent.click(retry);
    await screen.findByText("Saved expense operation confirmed.");
    expect(state.call.mock.calls.filter(call => call[0] === "createExpense").at(-1)![1]).toEqual(JSON.parse(JSON.stringify(first)));
    expect(sessionStorage.getItem("abr-pending-expense:org:user")).toBeNull();
  });
  it("blocks a linked bill while another store is selected", async () => {
    state.auth.operatingContext.id = "store-b";
    state.call.mockResolvedValue(workspace);
    render(<ExpensesPage />);
    expect(await screen.findByText(/Switch to the original record/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create draft expense" }).hasAttribute("disabled")).toBe(true);
  });
  it("does not discard an earlier uncertain payment when retry access is denied", async () => {
    const saved = { name: "recordExpensePayment", input: { expenseId: "bill", amountMinor: 10000, method: "cash", paidAt: "2026-10-09T10:00:00Z", idempotencyKey: crypto.randomUUID() } };
    sessionStorage.setItem("abr-pending-expense:org:user", JSON.stringify(saved));
    state.call.mockImplementation(name => name === "getExpenseWorkspace" ? Promise.resolve(workspace) : Promise.reject(Object.assign(new Error("Switch to the original store"), { diagnosticCode: "functions/permission-denied" })));
    render(<ExpensesPage />);
    const retry = await screen.findByRole("button", { name: "Retry saved expense instructions" });
    await waitFor(() => expect(retry.hasAttribute("disabled")).toBe(false));
    fireEvent.click(retry); await screen.findByText("Switch to the original store");
    expect(JSON.parse(sessionStorage.getItem("abr-pending-expense:org:user")!)).toEqual(saved);
    expect(screen.getByRole("button", { name: "Create draft expense" }).hasAttribute("disabled")).toBe(true);
  });
});
