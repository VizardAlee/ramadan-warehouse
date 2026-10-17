// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FinancialStatements } from "@/features/reports/financial-statements";
const state = vi.hoisted(() => ({ global: false, ready: true, metadataError: false, call: vi.fn() }));
vi.mock("@/features/accounting/use-financial-access", () => ({ useFinancialAccess: () => ({ access: state.ready ? { branchIds: ["own"], permissions: ["finance.journal.read"], organizationPermissions: state.global ? ["finance.journal.read"] : [] } : undefined }) }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({ profile: { roleIds: ["branch_manager", "auditor"], effectivePermissions: ["finance.journal.read", "sales.read.all"] }, operatingContext: null }) }));
vi.mock("@/features/accounting/use-financial-branches", () => ({ useFinancialBranches: () => ({ data: state.metadataError ? [] : [{ id: "own", name: "Own store" }, ...(state.global ? [{ id: "remote", name: "Remote store" }] : [])], error: state.metadataError ? "Synthetic metadata failure" : undefined }) }));
vi.mock("@/features/administration/api", () => ({ callAdministration: state.call }));
beforeEach(() => { state.global = false; state.ready = true; state.metadataError = false; state.call.mockReset(); state.call.mockImplementation(async (_name, input) => ({ ...input, rows: [], profitMinor: 0 })); });
afterEach(cleanup);
describe("financial scope presentation", () => {
  it("offers and requests only the assigned store despite global sales/base roles", async () => {
    render(<FinancialStatements />);
    expect(screen.getByRole("option", { name: "Own store" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Remote store" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Entire organization" })).toBeNull();
    await waitFor(() => expect(state.call).toHaveBeenCalledWith("generateFinancialStatement", expect.objectContaining({ branchId: "own" })));
  });
  it("retains consolidated and remote branch choices for explicit financial authority", async () => {
    state.global = true; render(<FinancialStatements />);
    expect(screen.getByRole("option", { name: "Entire organization" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Remote store" })).toBeTruthy();
    await waitFor(() => expect(state.call).toHaveBeenCalledWith("generateFinancialStatement", expect.objectContaining({ branchId: undefined })));
  });
  it("keeps a branch-only printable statement identified by store ID when metadata fails", async () => {
    state.metadataError = true; render(<FinancialStatements />);
    await screen.findByRole("article", { name: "Income statement for Store own" });
    expect(screen.queryByText("Entire organization")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("Store names are unavailable");
  });
  it("uses the selected authorized store for statement requests and its label", async () => {
    state.global = true; render(<FinancialStatements />);
    fireEvent.change(screen.getByLabelText("Scope"), { target: { value: "remote" } });
    await screen.findByRole("article", { name: "Income statement for Remote store" });
    expect(state.call).toHaveBeenLastCalledWith("generateFinancialStatement", expect.objectContaining({ branchId: "remote" }));
  });
  it("does not request ledger totals before current financial authority is known", async () => {
    state.ready = false; render(<FinancialStatements />);
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(state.call).not.toHaveBeenCalled();
  });
});
