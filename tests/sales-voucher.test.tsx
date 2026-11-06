// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SalesVoucher } from "@/features/pos/sales-voucher";
const state = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/features/administration/api", () => ({ callAdministration: state.call }));
vi.mock("@/features/finance/financial-privacy", () => ({ FinancialText: ({ children }: { children: React.ReactNode }) => <>{children}</>, FinancialDocument: ({ children }: { children: React.ReactNode }) => <>{children}</>, FinancialPrintAction: ({ children }: { children: React.ReactNode }) => <>{children}</>, FinancialValue: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); state.call.mockReset(); });
describe("sales voucher", () => {
  it("prints a read-only order snapshot and clearly distinguishes it from a receipt or handover", async () => {
    state.call.mockResolvedValue({ orderNumber: "ORD-001", branchName: "Branch A", customerName: "Customer A", status: "order_received", grossAmountMinor: 15000, createdBy: "sales-person", lines: [{ productName: "Panel", quantity: 2 }] });
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    render(<SalesVoucher orderId="order-a" onClose={() => {}} />);
    await screen.findByText("ORD-001 · Branch A");
    expect(screen.getByText(/not a receipt or proof of collection/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Print sales voucher" }));
    expect(print).toHaveBeenCalledOnce();
    expect(state.call).toHaveBeenCalledExactlyOnceWith("getSaleDocument", { action: "get_sales_voucher", orderId: "order-a" });
  });
  it("shows a denied or unavailable voucher without fabricating order details", async () => {
    state.call.mockRejectedValue(new Error("Voucher is outside the working branch"));
    render(<SalesVoucher orderId="other-branch" onClose={() => {}} />);
    expect((await screen.findByRole("alert")).textContent).toContain("outside the working branch");
    expect(screen.queryByRole("button", { name: "Print sales voucher" })).toBeNull();
  });
});
