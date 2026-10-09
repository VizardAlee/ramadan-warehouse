// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BudgetWorkspace } from "@/features/accounting/budget-workspace";
const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/features/administration/api", () => ({ callAdministration: api.call }));
afterEach(() => { cleanup(); sessionStorage.clear(); vi.resetAllMocks(); });
const workspace = { rows: [{ id: "b", accountId: "expense", accountCode: "6100", accountName: "Office costs", amountMinor: 10000, actualMinor: 8000, varianceMinor: 2000, variancePercent: 20, favorable: true, kind: "Expense", version: 1 }], accounts: [{ id: "expense", code: "6100", name: "Office costs", active: true }], nextCursorId: null };
describe("budget interface", () => {
  it("shows labeled favorable variance and preserves the original uncertain revision", async () => {
    api.call.mockImplementation((_name, input) => input.action === "workspace" ? Promise.resolve(workspace) : Promise.reject(new Error("Interrupted connection")));
    const props = { ownerKey: "org:user", branchId: "branch-a", canManage: true };
    const view = render(<BudgetWorkspace {...props} />); fireEvent.click(await screen.findByRole("button", { name: "Revise" }));
    await waitFor(() => expect((screen.getByLabelText("Budget amount (₦)").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(false));
    expect(screen.getByText("Favorable")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Budget amount (₦)"), { target: { value: "150" } }); fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Reviewed revised monthly expenses" } });
    fireEvent.click(screen.getByRole("button", { name: "Save budget target" })); await screen.findByRole("button", { name: "Retry saved budget instructions" });
    const original = api.call.mock.calls.find(call => call[1].action === "save")![1]; expect(original).toMatchObject({ amountMinor: 15000, expectedVersion: 1, branchId: "branch-a" });
    view.unmount(); api.call.mockImplementation((_name, input) => Promise.resolve(input.action === "workspace" ? workspace : { budgetId: "b", version: 2 }));
    render(<BudgetWorkspace {...props} branchId="branch-b" />); fireEvent.click(await screen.findByRole("button", { name: "Retry saved budget instructions" }));
    await screen.findByText(/Budget saved/); expect(api.call.mock.calls.filter(call => call[1].action === "save").at(-1)![1]).toEqual(original);
    expect(sessionStorage.getItem("abr-pending-budget:org:user")).toBeNull();
  });
  it("hides mutations for readers and expands revision history without navigation", async () => {
    api.call.mockImplementation((_name, input) => Promise.resolve(input.action === "workspace" ? workspace : { revisions: [{ id: "r", version: 1, amountMinor: 10000, reason: "Reviewed operating budget", updatedByName: "Finance Officer", createdAt: "2026-10-09T12:00:00Z" }], nextCursorId: null }));
    render(<BudgetWorkspace ownerKey="org:reader" canManage={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "View revisions" })); expect(await screen.findByText("Reviewed operating budget")).toBeTruthy();
    expect(screen.queryByText("Create or revise a monthly target")).toBeNull(); expect(screen.queryByRole("button", { name: "Revise" })).toBeNull();
  });
});
