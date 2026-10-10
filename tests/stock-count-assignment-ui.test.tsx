// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const base = { status: "active", authDisabled: false, organizationId: "org", branchIds: [], warehouseIds: [], authorizationVersion: 1 };
  return {
    call: vi.fn(),
    profile: { ...base, id: "admin", displayName: "Global admin", roleId: "system_administrator" },
    users: [
      { ...base, id: "counter", displayName: "HQ counter", roleId: "branch_requester", effectivePermissions: ["inventory.count"], branchIds: ["hq"] },
      { ...base, id: "foreign", displayName: "Other store", roleId: "warehouse_officer", warehouseIds: ["warehouse-b"] },
      { ...base, id: "disabled", displayName: "Disabled admin", roleId: "system_administrator", authDisabled: true },
      { ...base, id: "cashier", displayName: "No count permission", roleId: "sales_cashier", branchIds: ["hq"], effectivePermissions: [] },
    ],
  };
});
vi.mock("@/features/administration/api", () => ({ callAdministration: mocks.call }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({ profile: mocks.profile }) }));
vi.mock("@/features/administration/use-organization-collection", () => ({ useOrganizationCollection: (name: string) => ({ data: name === "users" ? mocks.users : name === "inventoryLocations" ? [{ id: "hq-stock", name: "Head Office", branchId: "hq", status: "active" }, { id: "branch-stock", name: "Other branch", branchId: "other", status: "active" }] : [] }) }));
import CountsPage from "@/app/(protected)/inventory/counts/page";

afterEach(() => { cleanup(); sessionStorage.clear(); vi.clearAllMocks(); });
describe("stock-count counter selection", () => {
  it("shows global admins and permitted store counters, excludes disabled or out-of-scope users and resets a stale choice", async () => {
    render(<CountsPage />);
    await waitFor(() => expect((screen.getByLabelText("Stock location") as HTMLSelectElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("Stock location"), { target: { value: "hq-stock" } });
    expect(screen.getByRole("option", { name: "Global admin" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "HQ counter" })).toBeTruthy();
    for (const name of ["Other store", "Disabled admin", "No count permission"])
      expect(screen.queryByRole("option", { name })).toBeNull();
    fireEvent.change(screen.getByLabelText("Counter"), { target: { value: "counter" } });
    expect((screen.getByRole("button", { name: "Create draft" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("Stock location"), { target: { value: "branch-stock" } });
    expect((screen.getByLabelText("Counter") as HTMLSelectElement).value).toBe("");
    expect(screen.queryByRole("option", { name: "HQ counter" })).toBeNull();
    expect((screen.getByRole("button", { name: "Create draft" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("restores and retries an uncertain creation without changing its key or details", async () => {
    mocks.call.mockRejectedValueOnce(new Error("Response interrupted"));
    const first = render(<CountsPage />);
    await waitFor(() => expect((screen.getByLabelText("Stock location") as HTMLSelectElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("Stock location"), { target: { value: "hq-stock" } });
    fireEvent.change(screen.getByLabelText("Counter"), { target: { value: "admin" } });
    fireEvent.click(screen.getByRole("button", { name: "Create draft" }));
    expect(await screen.findByRole("button", { name: "Retry same draft" })).toBeTruthy();
    const original = mocks.call.mock.calls[0]![1];
    expect(original).toMatchObject({ locationId: "hq-stock", assignedUserIds: ["admin"] });
    expect((screen.getByLabelText("Stock location") as HTMLSelectElement).disabled).toBe(true);
    first.unmount();
    mocks.call.mockResolvedValueOnce({ stockCountId: "count-original", created: false });
    render(<CountsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry same draft" }));
    expect(await screen.findByText("Draft count created.")).toBeTruthy();
    expect(mocks.call.mock.calls[1]).toEqual(["createStockCount", original]);
    expect(sessionStorage.getItem("abr-pending-count-create:org:admin")).toBeNull();
  });
  it("allows corrected details after a definite first rejection", async () => {
    mocks.call.mockRejectedValueOnce(Object.assign(new Error("Counter not eligible"), { code: "functions/permission-denied" }));
    render(<CountsPage />);
    await waitFor(() => expect((screen.getByLabelText("Stock location") as HTMLSelectElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("Stock location"), { target: { value: "hq-stock" } });
    fireEvent.change(screen.getByLabelText("Counter"), { target: { value: "admin" } });
    fireEvent.click(screen.getByRole("button", { name: "Create draft" }));
    expect(await screen.findByText(/Correct the details and try again/)).toBeTruthy();
    expect((screen.getByLabelText("Counter") as HTMLSelectElement).disabled).toBe(false);
    expect(sessionStorage.getItem("abr-pending-count-create:org:admin")).toBeNull();
  });
});
