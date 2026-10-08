// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReturnFollowUp } from "@/features/returns/return-follow-up";
import type { SaleReturn } from "@/types/domain";
const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/features/administration/api", () => ({ callAdministration: api.call }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const record = { id: "return-1", status: "submitted", kind: "goods_return", inspectionStatus: "required", items: [{ id: "item-1", productName: "Solar panel", quantity: 2 }] } as SaleReturn;
const props = { accounts: [{ id: "bank-1", bankName: "Bank A", accountName: "Collections", accountNumberLast4: "1234" }], shifts: [], onComplete: vi.fn() };
describe("customer returns follow-up", () => {
  it("requires an explicit inspection result rather than defaulting goods to restockable", async () => {
    api.call.mockResolvedValue({ inspectionRecorded: true });
    render(<ReturnFollowUp {...props} record={record} />);
    const button = screen.getByRole("button", { name: "Record inspection", hidden: true });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Disposition for Solar panel"), { target: { value: "warranty" } });
    fireEvent.change(screen.getByLabelText("Inspection findings"), { target: { value: "Fault confirmed; route to warranty team" } });
    fireEvent.click(button);
    await waitFor(() => expect(api.call).toHaveBeenCalledWith("approveSaleReturn", expect.objectContaining({ action: "inspect", inspection: { notes: "Fault confirmed; route to warranty team", lines: [{ returnItemId: "item-1", disposition: "warranty" }] } })));
  });
  it("requires a funding account and safely retries an uncertain credit refund", async () => {
    api.call.mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValue({ refundId: "refund-1" });
    render(<ReturnFollowUp {...props} record={{ ...record, status: "approved", inspectionStatus: "completed", exchangeCredit: { id: "credit-1", remainingAmountMinor: 5000, status: "active" } }} />);
    fireEvent.change(screen.getByLabelText("Refund amount (₦)"), { target: { value: "50.00" } });
    fireEvent.change(screen.getByLabelText("Refund reason / payment reference"), { target: { value: "Paid replacement difference back" } });
    const button = screen.getByRole("button", { name: "Record credit refund", hidden: true });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Funding company account"), { target: { value: "bank-1" } });
    fireEvent.click(button);
    await screen.findByText(/Confirmation was not received/);
    const original = api.call.mock.calls[0]![1];
    expect(original.refund).toMatchObject({ amountMinor: 5000, bankAccountId: "bank-1", method: "bank_transfer" });
    expect((screen.getByLabelText("Refund amount (₦)") as HTMLInputElement).disabled || screen.getByLabelText("Refund amount (₦)").closest("fieldset")?.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Retry same request", hidden: true }));
    await waitFor(() => expect(api.call).toHaveBeenCalledTimes(2));
    expect(api.call.mock.calls[1]![1]).toEqual(original);
  });
  it("does not render an invalid-decimal refund as an enabled action", () => {
    render(<ReturnFollowUp {...props} record={{ ...record, status: "approved", exchangeCredit: { id: "credit-1", remainingAmountMinor: 5000, status: "active" } }} />);
    fireEvent.change(screen.getByLabelText("Refund amount (₦)"), { target: { value: "1.234" } });
    fireEvent.change(screen.getByLabelText("Funding company account"), { target: { value: "bank-1" } });
    fireEvent.change(screen.getByLabelText("Refund reason / payment reference"), { target: { value: "Refund explanation" } });
    expect((screen.getByRole("button", { name: "Record credit refund", hidden: true }) as HTMLButtonElement).disabled).toBe(true);
  });
});
