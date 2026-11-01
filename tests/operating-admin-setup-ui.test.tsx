// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ call: vi.fn(), users: [] as Record<string, unknown>[] }));
vi.mock("@/features/administration/api", () => ({ callAdministration: state.call }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({ profile: { status: "active", roleId: "system_administrator", organizationId: "fixture-org" }, user: { uid: "fixture-admin" } }) }));
vi.mock("@/features/administration/use-organization-collection", () => ({ useOrganizationCollection: (name: string) => ({ data: name === "warehouses" ? [{ id: "fixture-warehouse", name: "Existing warehouse", status: "active" }] : name === "users" ? state.users : [], loading: false, error: null }) }));
import { MasterDataPage } from "../src/features/administration/master-data-page";
import UsersPage from "../src/app/(protected)/administration/users/page";
beforeEach(() => { state.users = []; state.call.mockReset(); state.call.mockResolvedValue({ saved: true }); });
afterEach(cleanup);
describe("administrator-owned Head Office setup", () => {
  it("starts with no HQ or supply selection and cancellation writes nothing", () => {
    render(<MasterDataPage collectionName="branches" />);
    expect(screen.getByText(/Head Office supply setup is incomplete/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create", exact: true }));
    fireEvent.change(screen.getByLabelText(/Operating role/), { target: { value: "head_office" } });
    expect((screen.getByLabelText(/Head Office supply warehouse/) as HTMLSelectElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Cancel", exact: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(state.call).not.toHaveBeenCalled();
  });
  it("saves only the administrator's explicitly selected HQ and existing supply warehouse", async () => {
    render(<MasterDataPage collectionName="branches" />);
    fireEvent.click(screen.getByRole("button", { name: "Create", exact: true }));
    fireEvent.change(screen.getByLabelText("Name", { exact: true }), { target: { value: "Fictional HQ" } });
    fireEvent.change(screen.getByLabelText("Code", { exact: true }), { target: { value: "FHQ" } });
    fireEvent.change(screen.getByLabelText(/Operating role/), { target: { value: "head_office" } });
    fireEvent.change(screen.getByLabelText(/Head Office supply warehouse/), { target: { value: "fixture-warehouse" } });
    fireEvent.click(screen.getByRole("button", { name: "Save securely" }));
    await waitFor(() => expect(state.call).toHaveBeenCalledOnce());
    expect(state.call).toHaveBeenCalledWith("saveBranch", expect.objectContaining({ name: "Fictional HQ", branchType: "head_office", supplyWarehouseId: "fixture-warehouse" }));
  });
  it("preserves existing warehouse assignments when an administrator opens and saves a custom-role user", async () => {
    state.users = [{ id: "fixture-user", uid: "fixture-user", email: "fixture@example.test", displayName: "Fictional staff", status: "active", invitationStatus: "accepted", roleId: "warehouse_officer", roleIds: ["warehouse_officer"], directRoleIds: [], customRoleIds: ["fixture-custom"], branchIds: [], warehouseIds: ["fixture-warehouse"] }];
    render(<UsersPage />);
    fireEvent.click(screen.getByRole("button", { name: "Edit", exact: true }));
    expect((screen.getByLabelText(/Warehouse stock locations/) as HTMLSelectElement).value).toBe("fixture-warehouse");
    fireEvent.click(screen.getByRole("button", { name: "Save securely" }));
    await waitFor(() => expect(state.call).toHaveBeenCalledOnce());
    expect(state.call).toHaveBeenCalledWith("updateOrganizationUser", expect.objectContaining({ userId: "fixture-user", roleIds: [], customRoleIds: ["fixture-custom"], warehouseIds: ["fixture-warehouse"] }));
  });
});
