// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "@/app/(protected)/dashboard/page";
import { isPurchasingOnlyProfile } from "@/features/dashboard/purchasing-dashboard";
import { permissionsForRoles } from "@/lib/permissions/roles";
import type { RoleId, UserProfile } from "@/types/domain";
const mocks = vi.hoisted(() => ({ call: vi.fn(), notifications: vi.fn(), profile: {} as UserProfile }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({ profile: mocks.profile, operatingContext: { type: "branch", id: "new-branch" } }) }));
vi.mock("@/features/administration/api", () => ({ callAdministration: mocks.call }));
vi.mock("@/features/dashboard/location-switcher", () => ({ DashboardLocationSwitcher: () => <div>Switch store</div> }));
vi.mock("@/features/notifications/use-notifications", () => ({ useNotifications: () => { mocks.notifications(); return { rows: [], markRead: vi.fn() }; } }));
function profile(roles: RoleId[]): UserProfile {
  return { status: "active", roleId: roles[0], roleIds: roles, directRoleIds: roles, effectivePermissions: [...permissionsForRoles(roles)], displayName: "Buyer", branchIds: [], warehouseIds: [] } as UserProfile;
}
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe("purchasing-only dashboard", () => {
  it("shows only purchasing workflows without operations, sales or notification fetches", () => {
    mocks.profile = profile(["purchasing_manager"]);
    render(<DashboardPage />);
    expect(screen.getByRole("heading", { name: "Purchasing overview" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Create a purchase order/ }).getAttribute("href")).toBe("/procurement#new-purchase-order");
    expect(screen.getByRole("link", { name: /Supplier invoices/ }).getAttribute("href")).toBe("/procurement#supplier-invoices");
    for (const text of ["Open branch requests", "Transfers in progress", "Operational priorities", "Sales summary"]) expect(screen.queryByText(text)).toBeNull();
    expect(mocks.call).not.toHaveBeenCalled();
    expect(mocks.notifications).not.toHaveBeenCalled();
  });
  it("does not display actions omitted from a restricted custom purchasing role", () => {
    mocks.profile = { ...profile(["purchasing_manager"]), directRoleIds: [], customRoleIds: ["purchasing-reader"], effectivePermissions: ["procurement.read"] };
    render(<DashboardPage />);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link", { name: /Purchase orders/ })).toBeTruthy();
    expect(mocks.call).not.toHaveBeenCalled();
  });
  it.each([["purchasing_manager", "branch_manager"], ["system_administrator"], ["branch_manager"]] as RoleId[][])("preserves broader dashboard for %j", async (...roles) => {
    mocks.profile = profile(roles);
    expect(isPurchasingOnlyProfile(mocks.profile)).toBe(false);
    mocks.call.mockResolvedValue({ summary: { requests: null, transfers: null, products: 1, discrepancies: null }, pipeline: [], sales: null, trend: [], paymentMix: [] });
    render(<DashboardPage />);
    await waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("heading", { name: "Purchasing overview" })).toBeNull();
  });
  it("does not classify inactive purchasing users as authorized", () => {
    expect(isPurchasingOnlyProfile({ ...profile(["purchasing_manager"]), status: "inactive" })).toBe(false);
  });
  it.each([
    { role: "branch_requester", visible: ["Open branch requests", "Transfers in progress"], hidden: ["Active products"] },
    { role: "sales_cashier", visible: ["Active products"], hidden: ["Open branch requests", "Transfers in progress", "Open discrepancies"] },
    { role: "logistics_officer", visible: ["Transfers in progress", "Open discrepancies"], hidden: ["Active products", "Open branch requests"] },
  ] as const)("filters $role cards and skips sales queries", async ({ role, visible, hidden }) => {
    mocks.profile = profile([role]);
    // Even an overly broad response must not create unauthorized UI links.
    mocks.call.mockResolvedValue({ summary: { requests: 0, transfers: 0, products: 0, discrepancies: 0 }, pipeline: [], sales: null, trend: [], paymentMix: [] });
    render(<DashboardPage />);
    await waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(1));
    expect(mocks.call.mock.calls[0][1].section).toBe("operations");
    for (const label of visible) expect(screen.getByText(label)).toBeTruthy();
    for (const label of hidden) expect(screen.queryByText(label)).toBeNull();
    expect(screen.queryByRole("link", { name: "Configure master data" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Sales summary" })).toBeNull();
  });
});
