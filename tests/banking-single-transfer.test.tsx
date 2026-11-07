// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import BankingPage from "@/app/(protected)/banking/page";
const state = vi.hoisted(() => ({
  api: vi.fn(),
  profile: { organizationId: "org", uid: "user", branchIds: ["store"] },
}));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({ profile: state.profile, user: { uid: "user" }, operatingContext: null }) }));
vi.mock("@/features/administration/api", () => ({ callAdministration: state.api }));
vi.mock("@/lib/permissions/roles", () => ({ hasPermission: () => true, canSelfAuthorize: () => true }));
vi.mock("@/features/banking/bank-owner", () => ({ BankOwner: () => <div>Account ownership</div> }));
vi.mock("@/features/banking/bank-account-management", () => ({ bankLifecycleLabel: () => "Active", BankAccountManagement: () => <div>Account management</div> }));
afterEach(() => { cleanup(); state.api.mockReset(); sessionStorage.clear(); });
it("keeps one transfer form after workspace loading, repeated refreshes and account changes", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const accounts = ["one", "two"].map(id => ({ id, active: true, bankName: id, accountName: id, accountNumberLast4: "1234", ledgerAccountCode: "1031", openingBalanceMinor: 0, openingDate: "2026-01-01", currency: "NGN" }));
  state.api.mockResolvedValue({ accounts, branches: [], statementTransactions: [], journalLines: [], reconciliations: [] });
  const view = render(<BankingPage />);
  await waitFor(() => expect(state.api.mock.calls.length).toBeGreaterThanOrEqual(2));
  for (let index = 0; index < 5; index++) {
    const before = state.api.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(state.api.mock.calls.length).toBeGreaterThan(before));
    expect(screen.getAllByText("Transfer between company accounts")).toHaveLength(1);
    expect(screen.getAllByText("Account management")).toHaveLength(1);
  }
  for (const id of ["two", "one", "two"]) {
    fireEvent.change(screen.getByLabelText("Bank account"), { target: { value: id } });
    await waitFor(() => expect(state.api.mock.calls.at(-1)?.[1]).toEqual({ bankAccountId: id }));
    expect(screen.getAllByText("Transfer between company accounts")).toHaveLength(1);
  }
  // Rendering the same route again must also retain a single keyed form.
  view.rerender(<BankingPage />);
  expect(screen.getAllByText("Transfer between company accounts")).toHaveLength(1);
  expect(errors.mock.calls.some(call => call.join(" ").includes("same key"))).toBe(false);
  expect(state.api.mock.calls.every(call => call[0] === "getBankReconciliationWorkspace")).toBe(true);
  errors.mockRestore();
});
