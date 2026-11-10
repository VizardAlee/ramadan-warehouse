// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "@/app/(protected)/dashboard/page";
import { isPurchasingOnlyProfile, shouldShowPurchasingDashboard } from "@/features/dashboard/purchasing-dashboard";
import { permissionsForRoles } from "@/lib/permissions/roles";
import type { RoleId, UserProfile } from "@/types/domain";
const mocks = vi.hoisted(() => ({ call: vi.fn(), notifications: vi.fn(), profile: {} as UserProfile, authority: null as UserProfile | null, context: { type: "branch" as const, id: "new-branch" } }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({ profile: mocks.profile, accessProfile: mocks.authority ?? mocks.profile, operatingContext: mocks.context }) }));
vi.mock("@/features/administration/api", () => ({ callAdministration: mocks.call }));
vi.mock("@/features/dashboard/location-switcher", () => ({ DashboardLocationSwitcher: () => <div>Switch store</div> }));
vi.mock("@/features/notifications/use-notifications", () => ({ useNotifications: () => { mocks.notifications(); return { rows: [], markRead: vi.fn() }; } }));
function profile(roles: RoleId[]): UserProfile {
  return { status: "active", roleId: roles[0], roleIds: roles, directRoleIds: roles, effectivePermissions: [...permissionsForRoles(roles)], displayName: "Buyer", branchIds: [], warehouseIds: [] } as UserProfile;
}
afterEach(() => { cleanup(); vi.resetAllMocks(); });
beforeEach(() => { mocks.authority = null; mocks.context = { type: "branch", id: "new-branch" }; });
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
  it("keeps warehouse purchasing separate from unassigned operational dashboards", () => {
    const authority = { ...profile(["purchasing_manager", "warehouse_manager"]), warehouseIds: ["own"] };
    expect(shouldShowPurchasingDashboard(authority, authority, { type: "warehouse", id: "other" })).toBe(true);
    expect(shouldShowPurchasingDashboard(authority, authority, { type: "warehouse", id: "own" })).toBe(false);
  });
  it("does not display actions omitted from a restricted custom purchasing role", () => {
    mocks.profile = { ...profile(["purchasing_manager"]), directRoleIds: [], customRoleIds: ["purchasing-reader"], effectivePermissions: ["procurement.read"] };
    render(<DashboardPage />);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link", { name: /Purchase orders/ })).toBeTruthy();
    expect(mocks.call).not.toHaveBeenCalled();
  });
  it.each([["purchasing_manager", "branch_manager"], ["system_administrator"], ["branch_manager"]] as RoleId[][])("preserves broader dashboard for %j", async (...roles) => {
    mocks.profile = { ...profile(roles), branchIds: ["new-branch"] };
    expect(isPurchasingOnlyProfile(mocks.profile)).toBe(false);
    mocks.call.mockResolvedValue({ summary: { requests: null, transfers: null, products: 1, discrepancies: null }, pipeline: [], sales: null, trend: [], paymentMix: [] });
    render(<DashboardPage />);
    await waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("heading", { name: "Purchasing overview" })).toBeNull();
  });
  it("uses purchasing-only outside the manager assignment despite a narrowed UI profile", () => {
    mocks.authority = { ...profile(["purchasing_manager", "branch_manager"]), branchIds: ["own-branch"] };
    mocks.profile = { ...mocks.authority, branchIds: ["new-branch"] };
    render(<DashboardPage />);
    expect(screen.getByRole("heading", { name: "Purchasing overview" })).toBeTruthy();
    expect(mocks.call).not.toHaveBeenCalled();
    expect(mocks.notifications).not.toHaveBeenCalled();
    expect(screen.queryByText("Open branch requests")).toBeNull();
  });
  it("switches between independently assigned and purchasing-only branches without stale totals", async () => {
    mocks.authority = { ...profile(["purchasing_manager", "branch_manager"]), branchIds: ["own-branch"] };
    mocks.profile = { ...mocks.authority, branchIds: ["own-branch"] };
    mocks.context = { type: "branch", id: "own-branch" };
    mocks.call.mockResolvedValue({ summary: { requests: 7, transfers: 2, products: 1, discrepancies: 0 }, pipeline: [], sales: null, trend: [], paymentMix: [] });
    const { rerender } = render(<DashboardPage />);
    await waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(2));
    mocks.profile = { ...mocks.authority, branchIds: ["new-branch"] };
    mocks.context = { type: "branch", id: "new-branch" };
    rerender(<DashboardPage />);
    expect(screen.getByRole("heading", { name: "Purchasing overview" })).toBeTruthy();
    expect(screen.queryByText("Open branch requests")).toBeNull();
    expect(mocks.call).toHaveBeenCalledTimes(2);
  });
  it.each(["system_administrator", "operations_administrator", "finance_officer", "auditor"] as RoleId[])("retains independent organization-wide dashboard for %s", async role => {
    mocks.authority = profile(["purchasing_manager", "branch_manager", role]);
    mocks.profile = { ...mocks.authority, branchIds: ["new-branch"] };
    mocks.call.mockResolvedValue({ summary: { requests: null, transfers: null, products: 1, discrepancies: null }, pipeline: [], sales: null, trend: [], paymentMix: [] });
    render(<DashboardPage />);
    await waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("heading", { name: "Purchasing overview" })).toBeNull();
  });
  it("does not borrow unassigned warehouse scope or an ambiguous custom global role base", () => {
    const context = { type: "branch" as const, id: "new-branch" };
    const warehouse = { ...profile(["purchasing_manager", "warehouse_manager"]), branchIds: ["new-branch"], warehouseIds: ["own-warehouse"] };
    expect(shouldShowPurchasingDashboard(warehouse, warehouse, context)).toBe(true);
    const custom = { ...profile(["purchasing_manager", "branch_manager", "auditor"]), directRoleIds: ["purchasing_manager", "branch_manager"] as RoleId[], customRoleIds: ["restricted-auditor"], effectivePermissions: [...permissionsForRoles(["purchasing_manager", "branch_manager"])], branchIds: ["own-branch"] };
    expect(shouldShowPurchasingDashboard(custom, custom, context)).toBe(true);
    expect(shouldShowPurchasingDashboard(custom, custom, { type: "branch", id: "own-branch" })).toBe(false);
  });
  it("does not treat purchasing transfer reads as generic global dashboard authority", () => {
    const authority = { ...profile(["purchasing_manager", "auditor"]), directRoleIds: ["purchasing_manager"] as RoleId[], customRoleIds: ["sales-reader"], effectivePermissions: [...permissionsForRoles(["purchasing_manager"]), "reports.sales.read", "sales.read.all"] as UserProfile["effectivePermissions"] };
    expect(shouldShowPurchasingDashboard(authority, authority, { type: "branch", id: "new-branch" })).toBe(true);
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
