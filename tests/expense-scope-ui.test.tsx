// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExpensesPage from "@/app/(protected)/expenses/page";
import type { ExpenseAccess } from "@/features/expenses/expense-access";
const state = vi.hoisted(() => ({ call: vi.fn(), params: new URLSearchParams(), access: {} as ExpenseAccess, context: null as { type: "branch" | "warehouse"; id: string } | null }));
vi.mock("next/navigation", () => ({ useSearchParams: () => state.params }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({ user: { uid: "staff" }, profile: { uid: "staff", organizationId: "org", status: "active", roleId: "branch_manager", roleIds: ["branch_manager", "auditor"], directRoleIds: ["branch_manager"], customRoleIds: ["sales-reader"], branchIds: ["own", "second"], warehouseIds: [], effectivePermissions: ["expenses.read", "expenses.create", "expenses.approve", "expenses.pay", "sales.read.all"] }, operatingContext: state.context }) }));
vi.mock("@/features/administration/api", () => ({ callAdministration: state.call }));
vi.mock("@/features/accounting/provider-funds", () => ({ ProviderFunds: ({ branchId, canPay }: { branchId?: string; canPay: boolean }) => <p data-testid="provider-scope">{branchId ?? "organization"}:{String(canPay)}</p> }));
const branches = [{ id: "own", name: "Own store", code: "A" }, { id: "second", name: "Second store", code: "B" }, { id: "remote", name: "Remote store", code: "R" }];
function expense(branchId: string) { return { id: `bill-${branchId}`, branchId, expenseNumber: `EXP-${branchId}`, categoryName: "Utilities", payeeName: "Utility", status: "submitted", netAmountMinor: 1000, vatAmountMinor: 0, grossAmountMinor: 1000, outstandingAmountMinor: 1000, description: "Monthly bill", createdBy: "other" }; }
beforeEach(() => {
  state.params = new URLSearchParams(); state.context = null;
  state.access = { permissions: ["expenses.read", "expenses.create", "expenses.approve", "expenses.pay", "sales.read.all"], organizationPermissions: ["sales.read.all"], branchIds: ["own", "second"], warehouseIds: [] };
  state.call.mockReset();
  state.call.mockImplementation(async (name: string, input: Record<string, string>) => name === "getServiceBillingCase" ? { providers: [], nextCursorId: null } : name === "getExpenseWorkspace" && input.view === "access" ? state.access : name === "getExpenseWorkspace" ? { categories: [], branches, warehouses: [{ id: "warehouse", name: "Own warehouse", code: "W" }], expenses: input.warehouseId ? [] : input.branchId ? [expense(input.branchId)] : [expense("own"), expense("remote")], bankAccounts: [] } : { created: true });
});
afterEach(() => { cleanup(); sessionStorage.clear(); });
describe("expense authority and assigned-store initialization", () => {
  it("initializes a mixed-role local reader to an assigned store and keeps the provider panel in that scope", async () => {
    render(<ExpensesPage />);
    await screen.findByText("EXP-own");
    expect(state.call).toHaveBeenCalledWith("getExpenseWorkspace", { view: "access" });
    const requests = state.call.mock.calls.filter(([name, input]) => name === "getExpenseWorkspace" && input.view !== "access");
    expect(requests[0]![1]).toEqual({ branchId: "own" });
    const picker = screen.getByLabelText("Expense register scope");
    expect(within(picker).queryByRole("option", { name: "Entire organization" })).toBeNull();
    expect(within(picker).queryByRole("option", { name: "Remote store" })).toBeNull();
    expect(screen.getByTestId("provider-scope").textContent).toBe("own:true");
    expect((screen.getByLabelText("Location") as HTMLSelectElement).value).toBe("own");
    fireEvent.change(picker, { target: { value: "branch:second" } });
    await screen.findByText("EXP-second");
    expect(screen.queryByText("EXP-own")).toBeNull();
    expect(state.call).toHaveBeenCalledWith("getExpenseWorkspace", { branchId: "second" });
    expect(screen.getByTestId("provider-scope").textContent).toBe("second:true");
  });
  it("preserves explicit global reads while keeping local expense creation and approval in assigned stores", async () => {
    state.access.organizationPermissions = ["expenses.read"];
    render(<ExpensesPage />);
    await screen.findByText("EXP-remote");
    expect(state.call).toHaveBeenCalledWith("getExpenseWorkspace", {});
    expect(within(screen.getByLabelText("Expense register scope")).getByRole("option", { name: "Entire organization" })).toBeTruthy();
    expect(within(screen.getByLabelText("Allocate to")).queryByRole("option", { name: "Whole organization" })).toBeNull();
    expect(within(screen.getByLabelText("Location")).queryByRole("option", { name: "Remote store" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(1);
    expect(screen.getByTestId("provider-scope").textContent).toBe("organization:false");
  });
  it("keeps global creation locations available without widening local financial reads", async () => {
    state.access.organizationPermissions = ["expenses.create"];
    render(<ExpensesPage />);
    await screen.findByText("EXP-own");
    expect(state.call).toHaveBeenCalledWith("getExpenseWorkspace", { branchId: "own" });
    expect(within(screen.getByLabelText("Expense register scope")).queryByRole("option", { name: "Remote store" })).toBeNull();
    expect(within(screen.getByLabelText("Allocate to")).getByRole("option", { name: "Whole organization" })).toBeTruthy();
    expect(within(screen.getByLabelText("Location")).getByRole("option", { name: "Remote store" })).toBeTruthy();
    expect(screen.queryByText("EXP-remote")).toBeNull();
  });
  it("uses the actual warehouse working scope for eligible warehouse expenses", async () => {
    state.context = { type: "warehouse", id: "warehouse" }; state.access.branchIds = []; state.access.warehouseIds = ["warehouse"];
    render(<ExpensesPage />);
    await waitFor(() => expect((screen.getByLabelText(/Location/).closest("fieldset") as HTMLFieldSetElement).disabled).toBe(false));
    expect(state.call).toHaveBeenCalledWith("getExpenseWorkspace", { warehouseId: "warehouse" });
    expect(screen.queryByTestId("provider-scope")).toBeNull();
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Power" } });
    fireEvent.change(screen.getByLabelText("Payee"), { target: { value: "Utility" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Warehouse power" } });
    fireEvent.change(screen.getByLabelText("Net amount (₦)"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Create draft expense" }));
    await waitFor(() => expect(state.call).toHaveBeenCalledWith("createExpense", expect.objectContaining({ warehouseId: "warehouse", netAmountMinor: 1000 })));
    expect(state.call.mock.calls.find(([name]) => name === "createExpense")![1]).not.toHaveProperty("branchId");
  });
  it("does not substitute another store for an unauthorized linked record", async () => {
    state.params = new URLSearchParams("caseId=service-case&branchId=remote");
    render(<ExpensesPage />);
    await screen.findByText(/Choose an assigned store or ask an administrator/);
    expect(state.call.mock.calls.filter(([name, input]) => name === "getExpenseWorkspace" && input.view !== "access")).toHaveLength(0);
    expect((screen.getByRole("button", { name: "Create draft expense" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("does not request financial records when no assigned store is eligible", async () => {
    state.access.branchIds = [];
    render(<ExpensesPage />);
    await screen.findByText(/Choose an assigned store or ask an administrator/);
    expect(state.call.mock.calls.filter(([name, input]) => name === "getExpenseWorkspace" && input.view !== "access")).toHaveLength(0);
  });
});
