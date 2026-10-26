// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WaybillRegister } from "@/features/waybills/waybill-register";

const state = vi.hoisted(() => ({ api: vi.fn(), allowed: true, branch: "b", org: "org" }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({ profile: { uid: "staff", organizationId: state.org, roleId: "branch_manager", branchIds: [state.branch] }, setOperatingContext: vi.fn(), operatingContext: { type: "branch", id: state.branch } }) }));
vi.mock("@/features/auth/use-operating-context-options", () => ({ useOperatingContextOptions: () => ({ options: [{ id: state.branch, type: "branch", name: "Assigned store" }] }) }));
vi.mock("@/lib/permissions/roles", () => ({ hasAnyPermission: () => state.allowed }));
vi.mock("@/features/administration/api", () => ({ callAdministration: state.api }));
vi.mock("@/features/pos/collection-waybill", () => ({ CollectionWaybill: ({ collection, onClose }: { collection: { id: string }; onClose: () => void }) => <section role="dialog" aria-label="Recorded preview">{collection.id}<button onClick={onClose}>Close preview</button></section> }));
const row = { id: "c1", saleId: "s1", branchId: "b", invoiceNumber: "SAL-1", waybillNumber: "WB-INV-1", totalQuantity: 2, collectedAt: "2026-10-01T00:00:00Z", dispatcherPhone: null, vehiclePlate: null, deliveryRecipientName: null };
beforeEach(() => { state.api.mockReset(); state.allowed = true; state.branch = "b"; state.org = "org"; state.api.mockResolvedValue({ rows: [row], nextCursor: null }); });
afterEach(cleanup);
it("loads only the chosen store, submits exact invoice lookup and opens only the selected recorded handover", async () => {
  state.api.mockImplementation(async (_name, input) => input.action === "list_waybills" ? { rows: [row], nextCursor: null } : { official: true, sale: { id: "s1" }, branch: { id: "b" }, collections: [{ id: "c1" }] });
  render(<WaybillRegister />);
  await screen.findByText("WB-INV-1");
  expect(state.api).toHaveBeenLastCalledWith("getSaleDocument", { action: "list_waybills", branchId: "b", invoiceNumber: "", limit: 25 });
  fireEvent.change(screen.getByLabelText("Invoice number"), { target: { value: " SAL-1 " } });
  fireEvent.submit(screen.getByRole("form", { name: "Waybill filters" }));
  await waitFor(() => expect(state.api).toHaveBeenLastCalledWith("getSaleDocument", expect.objectContaining({ invoiceNumber: "SAL-1" })));
  await screen.findByText("WB-INV-1");
  fireEvent.click(screen.getByRole("button", { name: "View waybill" }));
  await screen.findByRole("dialog", { name: "Recorded preview" });
  expect(state.api).toHaveBeenLastCalledWith("getSaleDocument", { saleId: "s1", collectionId: "c1" });
});
it("pages through actual handovers, retains a recoverable error and refreshes", async () => {
  state.api.mockResolvedValueOnce({ rows: [row], nextCursor: "c1" }).mockRejectedValueOnce(new Error("Connection interrupted")).mockResolvedValue({ rows: [], nextCursor: null });
  render(<WaybillRegister />); await screen.findByText("WB-INV-1");
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  await screen.findByRole("alert");
  expect(state.api).toHaveBeenLastCalledWith("getSaleDocument", expect.objectContaining({ cursor: "c1" }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh waybills" }));
  await screen.findByText(/No recorded handovers match/);
  expect(screen.queryByRole("button", { name: "View waybill" })).toBeNull();
});
it("never loads for a reader without permission and rejects a cross-store response", async () => {
  state.allowed = false;
  const view = render(<WaybillRegister />); expect(state.api).not.toHaveBeenCalled();
  state.allowed = true; state.api.mockResolvedValue({ rows: [{ ...row, branchId: "other" }], nextCursor: null });
  view.rerender(<WaybillRegister />);
  expect((await screen.findByRole("alert")).textContent).toContain("store verification failed");
  expect(screen.queryByText("WB-INV-1")).toBeNull();
});
it("ignores an old document response when the active organization changes", async () => {
  let finish!: (value: unknown) => void;
  state.api.mockImplementation(async (_name, input) => input.action === "list_waybills" ? { rows: state.org === "org" ? [row] : [], nextCursor: null } : new Promise(resolve => { finish = resolve; }));
  const view = render(<WaybillRegister />); await screen.findByText("WB-INV-1");
  fireEvent.click(screen.getByRole("button", { name: "View waybill" }));
  state.org = "other"; view.rerender(<WaybillRegister />);
  finish({ official: true, sale: { id: "s1" }, branch: { id: "b" }, collections: [{ id: "c1" }] });
  await screen.findByText(/No recorded handovers match/);
  expect(screen.queryByRole("dialog")).toBeNull();
});
