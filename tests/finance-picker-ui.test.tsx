// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import FinancePage from "@/app/(protected)/finance/page";
const state = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({ user: { uid: "finance" }, profile: { uid: "finance", organizationId: "org", status: "active", roleId: "finance_officer", roleIds: ["finance_officer"], branchIds: [], warehouseIds: [] }, operatingContext: null }) }));
vi.mock("@/features/accounting/use-financial-access", () => ({ useFinancialAccess: () => ({ identity: "finance", access: { branchIds: [], permissions: ["finance.journal.read", "finance.journal.create", "finance.journal.reverse", "daily.close.read"], organizationPermissions: ["finance.journal.read", "finance.journal.create", "finance.journal.reverse", "daily.close.read"] } }) }));
vi.mock("@/lib/firebase/client", () => ({ getFirebaseServices: () => ({ db: {} }) }));
vi.mock("@/features/administration/api", () => ({ callAdministration: state.call }));
const entry = { id: "journal", journalNumber: "JRN-TEST", journalType: "manual_adjustment", description: "Synthetic adjustment", effectiveAt: "2025-03-15T12:00:00Z", totalDebitMinor: 100, totalCreditMinor: 100 };
beforeEach(() => {
  state.call.mockReset();
  state.call.mockImplementation(async (name: string, input: Record<string, string>) => {
    if (name === "getDailyCloseWorkspace") return { rows: [{ id: "store", name: "Authorized store" }], nextCursor: null };
    if (name === "accountingJournals" && input.action === "detail") return { entry, lines: [] };
    if (name === "accountingJournals") return { entries: [entry], accounts: [], bankAccounts: [], nextCursorId: null };
    return { rows: [], accounts: [], nextCursorId: null };
  });
});
afterEach(() => { cleanup(); sessionStorage.clear(); });
it("connects the real financial picker and metadata loader to journal posting and reversal controls for an unassigned finance officer", async () => {
  render(<FinancePage />);
  await screen.findByRole("option", { name: "Authorized store" });
  expect(state.call).toHaveBeenCalledWith("getDailyCloseWorkspace", { action: "locations", cursor: undefined });
  expect((screen.getByText("Post an accountant adjustment").parentElement!.querySelector("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Accounting scope"), { target: { value: "store" } });
  await waitFor(() => expect((screen.getByText("Post an accountant adjustment").parentElement!.querySelector("fieldset") as HTMLFieldSetElement).disabled).toBe(false));
  expect(state.call).toHaveBeenCalledWith("accountingJournals", expect.objectContaining({ action: "workspace", branchId: "store" }));
  fireEvent.click(screen.getByRole("button", { name: "View lines" }));
  await screen.findByText("Reverse this manual journal");
  expect((screen.getByText("Reverse this manual journal").parentElement!.querySelector("fieldset") as HTMLFieldSetElement).disabled).toBe(false);
  expect(state.call).toHaveBeenCalledWith("accountingJournals", { action: "detail", journalEntryId: "journal" });
});
