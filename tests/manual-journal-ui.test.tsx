// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JournalWorkspace } from "@/features/accounting/journal-workspace";
const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/features/administration/api", () => ({ callAdministration: api.call }));
afterEach(() => { cleanup(); sessionStorage.clear(); vi.resetAllMocks(); });
const workspace = { entries: [], nextCursorId: null, bankAccounts: [], accounts: [
  { id: "expense", code: "6100", name: "Depreciation", active: true }, { id: "asset", code: "1590", name: "Accumulated depreciation", active: true },
] };
const props = { ownerKey: "org:user", branchId: "store", canCreate: true, canReverse: false, canManageAccounts: false };
describe("accounting journal interface", () => {
  it("persists an uncertain posting and retries its exact original payload after switching stores", async () => {
    let attempts = 0;
    api.call.mockImplementation(async (_name, input) => {
      if (input.action === "workspace") return workspace;
      if (++attempts === 1) throw new Error("Connection interrupted");
      return { journalNumber: "JRN-001" };
    });
    const view = render(<JournalWorkspace {...props} />);
    await waitFor(() => expect((screen.getByLabelText("Date").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2025-03-01T12:00" } });
    fireEvent.change(screen.getByLabelText("Reference"), { target: { value: "DEP-001" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Reviewed monthly depreciation" } });
    fireEvent.change(screen.getAllByLabelText("Ledger account")[0]!, { target: { value: "expense" } });
    fireEvent.change(screen.getAllByLabelText("Ledger account")[1]!, { target: { value: "asset" } });
    fireEvent.change(screen.getAllByLabelText("Debit (₦)")[0]!, { target: { value: "500" } });
    fireEvent.change(screen.getAllByLabelText("Credit (₦)")[1]!, { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Post balanced journal", hidden: true }));
    await screen.findByRole("button", { name: "Retry saved accounting instructions" });
    const original = api.call.mock.calls.find(call => call[1].action === "post")![1];
    expect(original).toMatchObject({ branchId: "store", lines: [{ accountId: "expense", debitMinor: 50000, creditMinor: 0 }, { accountId: "asset", debitMinor: 0, creditMinor: 50000 }] });
    expect((screen.getByLabelText("Date").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
    view.unmount(); render(<JournalWorkspace {...props} branchId="other-store" />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry saved accounting instructions" }));
    await screen.findByText(/JRN-001 posted/);
    const mutations = api.call.mock.calls.filter(call => call[1].action === "post"); expect(mutations[1]![1]).toEqual(original);
    expect(sessionStorage.getItem("abr-pending-journal:org:user")).toBeNull();
  });
  it("uses server paging and does not offer manual entry without a working store", async () => {
    api.call.mockResolvedValue({ ...workspace, nextCursorId: "journal-25" });
    render(<JournalWorkspace {...props} branchId={undefined} />);
    const next = screen.getByRole("button", { name: "Next" });
    await waitFor(() => expect((next as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(next);
    await waitFor(() => expect(api.call).toHaveBeenLastCalledWith("accountingJournals", expect.objectContaining({ action: "workspace", cursorId: "journal-25", pageSize: 25 })));
    expect((screen.getByLabelText("Date").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Rows per page"), { target: { value: "50" } });
    await waitFor(() => expect(api.call).toHaveBeenLastCalledWith("accountingJournals", expect.objectContaining({ pageSize: 50, cursorId: undefined })));
  });
});
