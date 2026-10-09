// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompanyFundsTransfer } from "@/features/banking/company-funds-transfer";
import type { BankAccount } from "@/types/domain";
const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/features/administration/api", () => ({ callAdministration: api.call }));
afterEach(() => { cleanup(); sessionStorage.clear(); vi.resetAllMocks(); });
const accounts = ["a", "b"].map(id => ({ id, active: true, bankName: "Test Bank", accountName: id, accountNumberLast4: "1234" })) as BankAccount[];
describe("company funds transfer form", () => {
  it("persists and locks an uncertain request, then recovers the exact same transfer after a reload", async () => {
    api.call.mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValueOnce({ journalNumber: "JRN-1", referenceNumber: "FTR-1" });
    const complete = vi.fn(), props = { accounts, branchId: "store", ownerKey: "org:user", onComplete: complete };
    const view = render(<CompanyFundsTransfer {...props} />);
    await waitFor(() => expect((screen.getByLabelText("From company account").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("From company account"), { target: { value: "a" } });
    fireEvent.change(screen.getByLabelText("To company account"), { target: { value: "b" } });
    fireEvent.change(screen.getByLabelText("Amount (₦)"), { target: { value: "2500.50" } });
    fireEvent.change(screen.getByLabelText("Date money moved"), { target: { value: "2026-10-09T09:00" } });
    fireEvent.change(screen.getByLabelText("Bank transfer reference"), { target: { value: "BANK-001" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Move company reserve" } });
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect((screen.getByRole("button", { name: "Record completed transfer" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Record completed transfer" }));
    await screen.findByRole("button", { name: "Retry saved transfer" });
    expect((screen.getByLabelText("Amount (₦)").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
    const original = api.call.mock.calls[0]![1];
    expect(original).toMatchObject({ amountMinor: 250050, sourceBankAccountId: "a", destinationBankAccountId: "b", branchId: "store" });
    view.unmount(); render(<CompanyFundsTransfer {...props} branchId="different-store" />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry saved transfer" }));
    await screen.findByText(/Both sides are posted in JRN-1/);
    expect(api.call.mock.calls[1]![1]).toEqual(original);
    expect(sessionStorage.getItem("abr-pending-company-transfer:org:user")).toBeNull();
    expect(complete).toHaveBeenCalledOnce();
  });
  it("keeps the transfer unrecordable without a responsible store", () => {
    render(<CompanyFundsTransfer accounts={accounts} ownerKey="org:user" onComplete={vi.fn()} />);
    expect(screen.getByText(/Select the responsible store/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Record completed transfer" }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.call).not.toHaveBeenCalled();
  });
});
