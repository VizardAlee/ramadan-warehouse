// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "@/app/(protected)/dashboard/page";
const mocks = vi.hoisted(() => ({ call: vi.fn(), profile: { roleId: "system_administrator", status: "active", displayName: "Administrator", branchIds: [] } }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({ profile: mocks.profile, operatingContext: null }) }));
vi.mock("@/features/administration/api", () => ({ callAdministration: mocks.call }));
vi.mock("@/features/dashboard/location-switcher", () => ({ DashboardLocationSwitcher: () => null }));
vi.mock("@/features/notifications/use-notifications", () => ({ useNotifications: () => ({ rows: [], markRead: vi.fn() }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("bounded dashboard UX", () => {
  it("keeps real sales visible when operations fail without loading any register", async () => {
    mocks.call.mockImplementation(async (_name, payload) => {
      if (payload.section === "operations") throw new Error("Operations unavailable");
      return { sales: { saleCount: 1200, grossAmountMinor: 1_200_000, amountPaidMinor: 840_000, creditAmountMinor: 360_000 }, trend: [], paymentMix: [] };
    });
    render(<DashboardPage />);
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Sales summary" })).getByText("1200")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain("Some dashboard totals");
    expect(mocks.call).toHaveBeenCalledTimes(2);
    expect(mocks.call.mock.calls.every(([name]) => name === "getDashboardWorkspace")).toBe(true);
  });
});
