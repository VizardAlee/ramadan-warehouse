// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ReturnsPage from "@/app/(protected)/returns/page";

const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/features/administration/api", () => ({ callAdministration: api.call }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({
  user: { uid: "admin" }, profile: { status: "active", roleId: "system_administrator", roleIds: ["system_administrator"] },
  accessProfile: { branchIds: ["b1"] }, operatingContext: { type: "branch", id: "b1" },
}) }));
vi.mock("@/features/administration/use-organization-collection", () => ({ useOrganizationCollection: () => ({
  data: [{ id: "b1", name: "Head Office", status: "active" }], loading: false, error: null,
}) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("refund funding account", () => {
  it("submits uncollected cancellation separately from a physical return", async () => {
    api.call.mockImplementation(async (name: string) => name === "listSaleReturns" ? { returns: [], bankAccounts: [] } : name === "getSaleReturnWorkspace" ? {
      bankAccounts: [], openShifts: [], sale: { id: "s1", receiptNumber: "RCT-1", grossAmountMinor: 10000, customerOutstandingMinor: 0 },
      items: [{ id: "i1", productName: "Panel", soldQuantity: 2, returnedQuantity: 0, returnableQuantity: 0, cancellableQuantity: 2, netAmountMinor: 10000, vatAmountMinor: 0, grossAmountMinor: 10000 }],
    } : { returnNumber: "RTN-1" });
    render(<ReturnsPage />);
    fireEvent.change(screen.getByPlaceholderText("RCT-IRB-2026-000001 or SAL-IRB-2026-000001"), { target: { value: "RCT-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Load receipt" }));
    await waitFor(() => expect(screen.getByLabelText("What happened?")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("What happened?"), { target: { value: "reservation_cancellation" } });
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Customer changed their mind" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit cancellation for approval" }));
    await waitFor(() => expect(api.call).toHaveBeenCalledWith("createSaleReturn", expect.objectContaining({ kind: "reservation_cancellation", lines: [{ saleItemId: "i1", quantity: 1, condition: "non_restockable" }] })));
  });
  it("requires account selection before approving an earlier bank refund", async () => {
    api.call.mockImplementation(async (name: string) => name === "listSaleReturns" ? {
      returns: [{ id: "r1", returnNumber: "RTN-1", resolution: "bank_transfer", grossAmountMinor: 10000, createdBy: "admin" }],
      bankAccounts: [{ id: "bank1", bankName: "Test Bank", accountName: "Payments", accountNumberLast4: "1234" }],
    } : { approved: true, creditId: null });
    render(<ReturnsPage />);
    await waitFor(() => expect(screen.getByText("RTN-1")).toBeTruthy());
    const approve = screen.getByRole("button", { name: "Approve and post" });
    expect(approve.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("Refund from company account"), { target: { value: "bank1" } });
    fireEvent.click(approve);
    await waitFor(() => expect(api.call).toHaveBeenCalledWith("approveSaleReturn", expect.objectContaining({ returnId: "r1", bankAccountId: "bank1" })));
  });
});
