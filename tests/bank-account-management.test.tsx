// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { BankAccountManagement, bankLifecycleLabel, openingAmountMinor } from "@/features/banking/bank-account-management";
import { FinancialPrivacyProvider, privacyStorageKey } from "@/features/finance/financial-privacy";
import type { BankAccount } from "@/types/domain";
const api = vi.hoisted(() => vi.fn());
vi.mock("@/features/administration/api", () => ({ callAdministration: api }));
const bank: BankAccount = { id: "bank-a", organizationId: "org", bankName: "Test Bank", accountName: "Company", accountNumberLast4: "1234", ledgerAccountCode: "1031", openingBalanceMinor: 100, openingDate: "2026-01-01", active: true, currency: "NGN", branchId: "store" };
const equity = { id: "equity", code: "3001", name: "Reviewed opening equity", active: true };
const props = { account: bank, branchId: "store", ownerKey: "org:user", canManage: true, canPostOpening: true, onSaved: vi.fn() };
const key = "abr-pending-bank-account:org:user";
beforeEach(() => { api.mockReset(); props.onSaved.mockReset(); sessionStorage.clear(); localStorage.clear(); });
afterEach(cleanup);
async function setupOpening() {
  api.mockImplementation(async (name, input) => input.action === "workspace" ? { accounts: [equity, { ...equity, id: "bank-ledger", code: "1031" }, { ...equity, id: "control", code: "3100" }, { ...equity, id: "inactive", active: false }, { ...equity, id: "system", systemManaged: true }] } : { journalNumber: "JRN-OPEN" });
  await waitFor(() => expect((screen.getByRole("button", { name: "Load opening balance setup", hidden: true }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Load opening balance setup", hidden: true }));
  await screen.findByLabelText("Opening effective date and time (Nigeria)");
  for (const [label, value] of [["Opening effective date and time (Nigeria)", "2026-01-01T09:00"], ["Initial balance (₦)", "-123.45"], ["Opening-equity counterpart", "equity"], ["Opening evidence reference", "BANK-OPEN-001"], ["Opening balance reason", "Reviewed opening statement"]]) fireEvent.change(screen.getByLabelText(label!), { target: { value } });
  fireEvent.click(screen.getByLabelText(/I reviewed the original balance/));
}
function calls(action: string) { return api.mock.calls.filter(call => call[1].action === action); }
describe("opening money and status labels", () => {
  it("accepts signed exact kobo and rejects missing, zero, unsafe or fractional kobo", () => {
    expect(openingAmountMinor("123.45")).toBe(12345); expect(openingAmountMinor("-123.45")).toBe(-12345);
    expect(openingAmountMinor("90071992547409.91")).toBe(Number.MAX_SAFE_INTEGER);
    expect(openingAmountMinor("-90071992547409.91")).toBe(-Number.MAX_SAFE_INTEGER);
    expect(openingAmountMinor("90071992547409.92")).toBeNull();
    for (const value of ["", "0", "-0", "0.001", "1e3", "NaN", "9007199254740992"]) expect(openingAmountMinor(value)).toBeNull();
    expect(bankLifecycleLabel({ active: false, lifecycleStatus: "removed" })).toBe("Deleted (recoverable)");
    expect(bankLifecycleLabel({ active: false })).toBe("Archived");
  });
});
it("does not expose mutation controls without permission", () => {
  render(<BankAccountManagement {...props} canManage={false} canPostOpening={false} />);
  expect(screen.queryByText("Delete or archive account")).toBeNull(); expect(api).not.toHaveBeenCalled();
});
it("requires dependency preview, reason and explicit confirmation before recoverable removal", async () => {
  api.mockImplementation(async (_name, input) => input.action === "lifecycle_preview" ? { bankAccountId: bank.id, lifecycleStatus: "active", removalMode: "remove", hasDependencies: false } : { bankAccountId: bank.id, lifecycleStatus: "removed" });
  render(<BankAccountManagement {...props} />);
  await waitFor(() => expect((screen.getByRole("button", { name: "Review account removal", hidden: true }) as HTMLButtonElement).disabled).toBe(false));
  expect(screen.queryByRole("button", { name: "Delete unused account", hidden: true })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Review account removal", hidden: true }));
  const button = await screen.findByRole("button", { name: "Delete unused account", hidden: true });
  fireEvent.click(button); expect(calls("remove")).toHaveLength(0);
  fireEvent.change(screen.getByLabelText("Account change reason"), { target: { value: "Duplicate unused account" } });
  fireEvent.click(screen.getByLabelText(/I reviewed the selected account/));
  fireEvent.click(button); fireEvent.click(button);
  await waitFor(() => expect(calls("remove")).toHaveLength(1));
  expect(calls("remove")[0]![1]).toMatchObject({ bankAccountId: bank.id, reason: "Duplicate unused account", idempotencyKey: expect.any(String) });
  expect(await screen.findByText(/Account deleted recoverably/)).toBeTruthy(); expect(sessionStorage.getItem(key)).toBeNull();
});
it("offers archive for history-bearing accounts and restore for removed accounts", async () => {
  api.mockImplementation(async (_name, input) => input.action === "lifecycle_preview" ? { bankAccountId: bank.id, lifecycleStatus: "active", removalMode: "archive", hasDependencies: true } : { lifecycleStatus: "archived" });
  const view = render(<BankAccountManagement {...props} />);
  await waitFor(() => expect((screen.getByRole("button", { name: "Review account removal", hidden: true }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Review account removal", hidden: true }));
  expect(await screen.findByRole("button", { name: "Archive account", hidden: true })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Delete unused account", hidden: true })).toBeNull();
  view.rerender(<BankAccountManagement {...props} account={{ ...bank, active: false, lifecycleStatus: "removed" }} />);
  api.mockResolvedValue({ bankAccountId: bank.id, lifecycleStatus: "removed", removalMode: "remove", hasDependencies: false });
  fireEvent.click(screen.getByRole("button", { name: "Review account restoration", hidden: true }));
  const restore = await screen.findByRole("button", { name: "Restore account", hidden: true });
  fireEvent.change(screen.getByLabelText("Account change reason"), { target: { value: "Restore reviewed account" } }); fireEvent.click(screen.getByLabelText(/I reviewed the selected account/));
  api.mockResolvedValue({ lifecycleStatus: "active" }); fireEvent.click(restore);
  await waitFor(() => expect(calls("restore")).toHaveLength(1)); expect(calls("bank_opening")).toHaveLength(0);
});
it("posts only an explicitly reviewed signed opening with a permitted counterpart", async () => {
  render(<BankAccountManagement {...props} />); await setupOpening();
  const options = within(screen.getByLabelText("Opening-equity counterpart")).getAllByRole("option", { hidden: true });
  expect(options).toHaveLength(2); expect((screen.getByLabelText("Initial balance (₦)") as HTMLInputElement).value).toBe("-123.45");
  const button = screen.getByRole("button", { name: "Post reviewed opening balance", hidden: true });
  fireEvent.change(screen.getByLabelText("Opening evidence reference"), { target: { value: "BANK-OPEN-002" } });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText(/I reviewed the original balance/)); fireEvent.click(button); fireEvent.click(button);
  await waitFor(() => expect(calls("bank_opening")).toHaveLength(1));
  expect(calls("bank_opening")[0]![1]).toMatchObject({ bankAccountId: bank.id, branchId: "store", effectiveAt: "2026-01-01T08:00:00.000Z", amountMinor: -12345, counterpartAccountId: "equity", confirmedNoPreviousOpening: true, reference: "BANK-OPEN-002", idempotencyKey: expect.any(String) });
  expect(await screen.findByText(/JRN-OPEN posted/)).toBeTruthy();
});
it("never auto-posts or pre-fills legacy opening metadata, and suppresses an existing opening", async () => {
  render(<BankAccountManagement {...props} account={{ ...bank, openingJournalEntryId: "journal", openingJournalNumber: "JRN-001" }} />);
  expect(screen.getByText(/An opening journal is already recorded/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Load opening balance setup", hidden: true })).toBeNull(); expect(api).not.toHaveBeenCalled();
});
it("retains and retries identical instructions after an uncertain result and account switch", async () => {
  const view = render(<BankAccountManagement {...props} />); await setupOpening();
  api.mockRejectedValue(new Error("Connection lost"));
  fireEvent.click(screen.getByRole("button", { name: "Post reviewed opening balance", hidden: true }));
  await screen.findByText("Connection lost"); const saved = JSON.parse(sessionStorage.getItem(key)!);
  expect(saved.accountLabel).toBe("Test Bank · Company · ••••1234");
  view.rerender(<BankAccountManagement {...props} account={{ ...bank, id: "bank-b" }} branchId="different-store" />);
  api.mockResolvedValue({ journalNumber: "JRN-OPEN" });
  fireEvent.click(screen.getByRole("button", { name: "Retry saved bank instructions" }));
  await waitFor(() => expect(api).toHaveBeenLastCalledWith(saved.name, saved.input));
  expect(saved.input.bankAccountId).toBe("bank-a"); expect(saved.input.branchId).toBe("store"); expect(sessionStorage.getItem(key)).toBeNull();
});
it("fails closed on corrupt saved instructions", async () => {
  sessionStorage.setItem(key, JSON.stringify({ name: "saveBankAccount", input: { bankAccountId: "bank-a", idempotencyKey: "key" } }));
  render(<BankAccountManagement {...props} />);
  await screen.findByText(/Saved bank instructions could not be read/);
  expect((screen.getByRole("button", { name: "Review account removal", hidden: true }) as HTMLButtonElement).disabled).toBe(true); expect(api).not.toHaveBeenCalled();
});
it("requires visible amount review before posting a new opening", async () => {
  localStorage.setItem(privacyStorageKey("org", "user"), JSON.stringify({ version: 1, hidden: true }));
  render(<FinancialPrivacyProvider organizationId="org" uid="user"><BankAccountManagement {...props} /></FinancialPrivacyProvider>);
  api.mockResolvedValue({ accounts: [equity] });
  await waitFor(() => expect((screen.getByRole("button", { name: "Load opening balance setup", hidden: true }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Load opening balance setup", hidden: true }));
  await screen.findByLabelText("Opening effective date and time (Nigeria)");
  expect(screen.queryByRole("spinbutton", { name: "Initial balance (₦)", hidden: true })).toBeNull();
  const region = screen.getByText("Post initial account balance").closest("details")!;
  fireEvent.click(within(region).getByRole("button", { name: "Review all action amounts", hidden: true }));
  expect(screen.getByLabelText("Initial balance (₦)")).toBeTruthy(); expect(calls("bank_opening")).toHaveLength(0);
});

it("restores the same pending request after remount without submitting automatically", async () => {
  const view = render(<BankAccountManagement {...props} />); await setupOpening();
  api.mockRejectedValue(new Error("Connection lost"));
  fireEvent.click(screen.getByRole("button", { name: "Post reviewed opening balance", hidden: true }));
  await screen.findByText("Connection lost"); const saved = JSON.parse(sessionStorage.getItem(key)!);
  expect(saved.accountLabel).toBe("Test Bank · Company · ••••1234");
  view.unmount(); api.mockClear();
  render(<BankAccountManagement {...props} account={{ ...bank, id: "bank-b" }} />);
  await screen.findByRole("button", { name: "Retry saved bank instructions" });
  expect(api).not.toHaveBeenCalled();
  api.mockResolvedValue({ journalNumber: "JRN-OPEN" });
  fireEvent.click(screen.getByRole("button", { name: "Retry saved bank instructions" }));
  await waitFor(() => expect(api).toHaveBeenCalledExactlyOnceWith(saved.name, saved.input));
});
it("ignores an old removal preview after the selected account changes", async () => {
  let complete!: (value: unknown) => void;
  api.mockReturnValue(new Promise(resolve => { complete = resolve; }));
  const view = render(<BankAccountManagement {...props} />);
  await waitFor(() => expect((screen.getByRole("button", { name: "Review account removal", hidden: true }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Review account removal", hidden: true }));
  view.rerender(<BankAccountManagement {...props} account={{ ...bank, id: "bank-b" }} />);
  complete({ bankAccountId: bank.id, lifecycleStatus: "active", removalMode: "remove", hasDependencies: false });
  await waitFor(() => expect((screen.getByRole("button", { name: "Review account removal", hidden: true }) as HTMLButtonElement).disabled).toBe(false));
  expect(screen.queryByRole("button", { name: "Delete unused account", hidden: true })).toBeNull();
});
it("requires All locations to inspect account removal and displays reference evidence without prefilling", async () => {
  render(<BankAccountManagement {...props} managementScopeReady={false} />);
  expect(screen.getByText(/Select All locations/)).toBeTruthy();
  expect((screen.getByRole("button", { name: "Review account removal", hidden: true }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/Saved opening reference/)).toBeTruthy();
  api.mockResolvedValue({ accounts: [equity] });
  await waitFor(() => expect((screen.getByRole("button", { name: "Load opening balance setup", hidden: true }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Load opening balance setup", hidden: true }));
  expect((await screen.findByLabelText("Initial balance (₦)") as HTMLInputElement).value).toBe("");
  expect((screen.getByLabelText("Opening effective date and time (Nigeria)") as HTMLInputElement).value).toBe("");
  expect(calls("bank_opening")).toHaveLength(0);
});
