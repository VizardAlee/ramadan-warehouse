// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CustomersPage from "@/app/(protected)/customers/page";

const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/features/administration/api", () => ({ callAdministration: api.call }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({
  profile: { status: "active", roleId: "system_administrator", roleIds: ["system_administrator"] },
  accessProfile: { branchIds: ["b1"] },
  operatingContext: { type: "branch", id: "b1" },
}) }));
vi.mock("@/features/administration/use-organization-collection", () => ({
  useOrganizationCollection: (name: string) => ({
    data: name === "customers" ? [{ id: "c1", name: "Amina Musa", customerNumber: "CUS-000001", creditStatus: "approved", creditLimitMinor: 100000, outstandingBalanceMinor: 25000, availableCreditMinor: 75000, active: true }] : name === "branches" ? [{ id: "b1", name: "Head Office", status: "active" }] : [],
    loading: false,
    error: null,
  }),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("customer account history", () => {
  it("expands activity in place with readable financial meaning", async () => {
    api.call.mockResolvedValue({ customer: { creditLimitMinor: 100000, outstandingBalanceMinor: 25000, availableCreditMinor: 75000 }, rows: [{ id: "account:1", kind: "account", detail: "payment", reference: "PAY-1", amountMinor: 5000, at: "2026-10-04T10:00:00.000Z" }], moreAvailable: false });
    render(<CustomersPage />);
    const trigger = screen.getByRole("button", { name: "View history" });
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    await waitFor(() => expect(screen.getByText("Payment received")).toBeTruthy());
    expect(api.call).toHaveBeenCalledWith("getCustomerHistory", expect.objectContaining({ customerId: "c1", branchId: "b1" }));
    expect(screen.getByRole("region", { name: "Amina Musa account history" })).toBeTruthy();
  });
});
