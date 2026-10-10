// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicePayments } from "@/features/returns/service-payments";
const call = vi.hoisted(() => vi.fn());
vi.mock("@/features/administration/api", () => ({ callAdministration: call }));
const receipt = { id: "receipt", amountMinor: 6000, refundedAmountMinor: 2500, method: "cash", recordedAt: "2026-10-10T08:00:00.000Z", journalEntryId: "original-journal" };
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe("service receipts and refunds", () => {
  it("loads history only when opened, pages it and requires reason and payout account", async () => {
    call.mockResolvedValue({ payments: [receipt], nextCursor: "receipt" });
    const refund = vi.fn().mockResolvedValue(true);
    render(<ServicePayments caseId="case" disabled={false} canRefund accounts={[{ id: "bank", bankName: "Bank", accountName: "Operating", accountNumberLast4: "1234" }]} onRefund={refund} />);
    expect(call).not.toHaveBeenCalled();
    const details = screen.getByText("Receipts & refunds").closest("details")!;
    details.open = true; fireEvent(details, new Event("toggle"));
    await screen.findByText("Received ₦60.00");
    expect(call).toHaveBeenLastCalledWith("getAftersalesWorkspace", { action: "list_payments", caseId: "case", paymentCursor: undefined, paymentLimit: 25 });
    fireEvent.click(screen.getByRole("button", { name: "Next receipts" }));
    await waitFor(() => expect(call).toHaveBeenLastCalledWith("getAftersalesWorkspace", expect.objectContaining({ paymentCursor: "receipt" })));
    await screen.findByText("Page 2");
    fireEvent.click(screen.getByRole("button", { name: "Refund receipt" }));
    expect((screen.getByLabelText("Refund amount (₦)") as HTMLInputElement).value).toBe("35.00");
    const submit = screen.getByRole("button", { name: "Confirm receipt refund" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Refund reason"), { target: { value: "Correct earlier receipt" } });
    fireEvent.change(screen.getByLabelText("Refund method"), { target: { value: "bank_transfer" } });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Payout account"), { target: { value: "bank" } });
    fireEvent.click(submit);
    await waitFor(() => expect(refund).toHaveBeenCalledWith(expect.objectContaining({ action: "refund", originalPaymentId: "receipt", caseId: "case", amountMinor: 3500, bankAccountId: "bank", method: "bank_transfer", reason: "Correct earlier receipt", idempotencyKey: expect.any(String) })));
  });
  it("shows an unconfirmed result inside the dialog and allows closing to recover saved instructions", async () => {
    call.mockResolvedValue({ payments: [receipt], nextCursor: null });
    const props = { caseId: "case", disabled: false, canRefund: true, accounts: [], onRefund: vi.fn().mockResolvedValue(false) };
    const view = render(<ServicePayments {...props} />);
    const details = screen.getByText("Receipts & refunds").closest("details")!;
    details.open = true; fireEvent(details, new Event("toggle"));
    fireEvent.click(await screen.findByRole("button", { name: "Refund receipt" }));
    view.rerender(<ServicePayments {...props} disabled mutationError="Connection interrupted" />);
    expect(screen.getByRole("dialog").textContent).toContain("Retry saved service instructions");
    expect((screen.getByRole("button", { name: "Confirm receipt refund" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Close refund form" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
