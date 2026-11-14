// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserProfile } from "../src/types/domain";
import { operatingRoles } from "../src/lib/permissions/operating-roles";
import { permissionsForRoles } from "../src/lib/permissions/roles";
const state = vi.hoisted(() => ({ call: vi.fn(), profile: null as UserProfile | null }));
vi.mock("@/features/administration/api", () => ({ callAdministration: state.call }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({ profile: state.profile, operatingContext: { type: "branch", id: "fixture-branch" } }) }));
vi.mock("@/features/administration/use-organization-collection", () => ({ useOrganizationCollection: () => ({ data: [], loading: false, error: null }) }));
vi.mock("@/lib/connectivity", () => ({ useConnectivity: () => ({ online: true }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
import { RolesManager } from "../src/features/administration/roles-manager";
import { StockTransferForm, StockTransferList } from "../src/features/transfers/stock-transfer-workspace";
beforeEach(() => {
  state.profile = { uid: "fixture-admin", status: "active", roleId: "system_administrator", organizationId: "fixture-org", branchIds: [], warehouseIds: [] } as unknown as UserProfile;
  state.call.mockReset();
  state.call.mockImplementation(async (name, input) => name === "getAssignableRolePermissions" ? { roles: ["sales_cashier", "branch_manager", "branch_requester", "finance_officer"].map(roleId => ({ roleId, permissionIds: [...permissionsForRoles([roleId as "sales_cashier"]) ] })) } : name === "stockTransfers" ? input.action === "list" ? { rows: [], nextCursor: null } : { locations: [], canApprove: false } : { roleId: "fixture-new-role" });
});
afterEach(cleanup);
async function open() {
  render(<RolesManager />);
  await waitFor(() => expect((screen.getByRole("button", { name: "Create role" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Create role" }));
}
describe("operating role creation and restricted transfers", () => {
  it.each(operatingRoles)("saves $name with precisely selected permissions and no user mutation", async role => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: role.name, exact: true }));
    expect((screen.getByLabelText("Role name") as HTMLInputElement).value).toBe(role.name);
    const checked = within(screen.getByRole("dialog")).getAllByRole("checkbox").filter(box => (box as HTMLInputElement).checked);
    expect(checked).toHaveLength(role.permissionIds.length);
    fireEvent.click(screen.getByRole("button", { name: "Save role" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(state.call).toHaveBeenCalledWith("saveOrganizationRole", expect.objectContaining({ name: role.name, baseRoleId: role.baseRoleId, permissionIds: role.permissionIds, status: "active", idempotencyKey: expect.any(String) }));
    expect(state.call.mock.calls.filter(([name]) => name !== "getAssignableRolePermissions")).toHaveLength(1);
  });
  it("cancels without saving and starts a fresh dialog", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Cashier", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Create role", exact: true }));
    expect((screen.getByLabelText("Role name") as HTMLInputElement).value).toBe("");
    expect(state.call.mock.calls.some(([name]) => name === "saveOrganizationRole")).toBe(false);
  });
  it("ignores repeat submit while saving and reuses the same key after an uncertain error", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Salesperson", exact: true }));
    let fail!: (cause: Error) => void;
    state.call.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    const form = screen.getByRole("button", { name: "Save role" }).closest("form")!;
    fireEvent.submit(form); fireEvent.submit(form);
    expect(state.call.mock.calls.filter(([name]) => name === "saveOrganizationRole")).toHaveLength(1);
    fail(new Error("Connection interrupted"));
    await screen.findByRole("alert");
    fireEvent.submit(form);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const saves = state.call.mock.calls.filter(([name]) => name === "saveOrganizationRole");
    expect(saves).toHaveLength(2);
    expect(saves[0]![1].idempotencyKey).toBe(saves[1]![1].idempotencyKey);
  });
  it.each([false, true])("blocks restricted stock-manager creation URLs (from request: %s) before loading options", fromRequest => {
    const role = operatingRoles[2]!;
    state.profile = { ...state.profile!, roleId: role.baseRoleId, roleIds: [role.baseRoleId], directRoleIds: [], customRoleIds: ["fixture-stock"], effectivePermissions: role.permissionIds, branchIds: ["fixture-branch"] };
    render(<StockTransferForm fromRequest={fromRequest} />);
    expect(screen.getByText(/You do not have permission to create outgoing transfers/)).toBeTruthy();
    expect(state.call).not.toHaveBeenCalled();
  });
  it("shows the stock-manager transfer list without a New transfer control", async () => {
    const role = operatingRoles[2]!;
    state.profile = { ...state.profile!, roleId: role.baseRoleId, roleIds: [role.baseRoleId], directRoleIds: [], customRoleIds: ["fixture-stock"], effectivePermissions: role.permissionIds, branchIds: ["fixture-branch"] };
    render(<StockTransferList />);
    await waitFor(() => expect(state.call).toHaveBeenCalledWith("stockTransfers", { action: "options" }));
    expect(screen.queryByRole("link", { name: "New transfer" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Use an existing approved branch request" })).toBeNull();
  });
  it("keeps an incoming receipt actionable when the stock manager cannot create transfers", async () => {
    const role = operatingRoles[2]!;
    state.profile = { ...state.profile!, roleId: role.baseRoleId, roleIds: [role.baseRoleId], directRoleIds: [], customRoleIds: ["fixture-stock"], effectivePermissions: role.permissionIds, branchIds: ["fixture-branch"] };
    state.call.mockImplementation(async (_name, input) => input.action === "list" ? { rows: [{ id: "incoming", number: "FIXTURE-001", status: "awaiting_receipt", sourceName: "Source", destinationName: "Branch", destinationBranchId: "fixture-branch", destinationLocationId: "fixture-location", items: [], createdAt: "2026-11-01" }], nextCursor: null } : { locations: [{ id: "fixture-location", assigned: false }], canApprove: false });
    render(<StockTransferList />);
    await screen.findByText("FIXTURE-001");
    expect(screen.getByRole("button", { name: "Take action" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "New transfer" })).toBeNull();
  });
});
