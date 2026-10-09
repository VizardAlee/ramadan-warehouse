// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AftersalesPage from "@/app/(protected)/aftersales/page";
const state = vi.hoisted(() => ({ call: vi.fn(), auth: { profile: { organizationId: "org" }, user: { uid: "user" }, operatingContext: { type: "branch", id: "store" } } }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => state.auth }));
vi.mock("@/features/administration/api", () => ({ callAdministration: state.call }));
vi.mock("@/lib/permissions/roles", () => ({ hasPermission: () => true }));
vi.mock("@/features/pos/operational-photos", () => ({ OperationalPhotos: () => null }));
vi.mock("@/features/returns/held-return-disposition", () => ({ HeldReturnDisposition: () => null }));
const workspace = { cases: [{ id: "case", branchId: "store", customerName: "Amina", serviceType: "non_warranty", requestType: "repair", complaint: "Repair cable", status: "open", chargeStatus: "due", chargeAmountMinor: 2000, outstandingAmountMinor: 2000 }], customers: [], products: [], sales: [], suppliers: [], bankAccounts: [] };
afterEach(() => { cleanup(); sessionStorage.clear(); vi.resetAllMocks(); state.auth.operatingContext.id = "store"; });
describe("service action retries", () => {
  it("assigns an existing HR employee without changing the service status or financial instructions", async () => {
    state.call.mockImplementation(name => Promise.resolve(name === "getAftersalesWorkspace" ? workspace : { updated: true }));
    render(<AftersalesPage />);
    fireEvent.change(await screen.findByLabelText("HR staff ID"), { target: { value: "TECH-01" } });
    fireEvent.change(screen.getByLabelText("Assignment reason"), { target: { value: "Repair assigned to specialist" } });
    const button = screen.getByRole("button", { name: "Save staff assignment" });
    await waitFor(() => expect((button.closest("fieldset") as HTMLFieldSetElement).disabled).toBe(false));
    fireEvent.click(button);
    await screen.findByText("Service staff assignment saved and audited.");
    expect(state.call.mock.calls.find(call => call[0] === "updateAftersalesCase")![1]).toEqual({ caseId: "case", action: "assign_staff", staffId: "TECH-01", reason: "Repair assigned to specialist", idempotencyKey: expect.any(String) });
  });
  it("preserves the exact payment after interruption, reload and access denial", async () => {
    state.call.mockImplementation(name => name === "getAftersalesWorkspace" ? Promise.resolve(workspace) : Promise.reject(new Error("Connection interrupted")));
    const view = render(<AftersalesPage />);
    fireEvent.change(await screen.findByLabelText("Pay now (₦)"), { target: { value: "14.55" } });
    const button = screen.getByRole("button", { name: "Record payment" });
    await waitFor(() => expect((button.closest("fieldset") as HTMLFieldSetElement).disabled).toBe(false));
    fireEvent.click(button);
    await screen.findByRole("button", { name: "Retry saved service instructions" });
    const original = state.call.mock.calls.find(call => call[0] === "recordAftersalesPayment")![1];
    expect(original).toMatchObject({ caseId: "case", amountMinor: 1455, method: "cash" });
    expect((button.closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
    view.unmount(); state.auth.operatingContext.id = "other-store";
    state.call.mockImplementation(name => name === "getAftersalesWorkspace" ? Promise.resolve(workspace) : Promise.reject(Object.assign(new Error("Switch to original store"), { diagnosticCode: "functions/permission-denied" })));
    render(<AftersalesPage />);
    const retry = await screen.findByRole("button", { name: "Retry saved service instructions" });
    await waitFor(() => expect(retry.hasAttribute("disabled")).toBe(false));
    fireEvent.click(retry); await screen.findByText("Switch to original store");
    expect(JSON.parse(sessionStorage.getItem("abr-pending-aftersales:org:user")!).input).toEqual(JSON.parse(JSON.stringify(original)));
    state.call.mockImplementation(name => Promise.resolve(name === "getAftersalesWorkspace" ? workspace : { recorded: false }));
    fireEvent.click(retry); await screen.findByText("Saved service action confirmed.");
    expect(state.call.mock.calls.filter(call => call[0] === "recordAftersalesPayment").at(-1)![1]).toEqual(JSON.parse(JSON.stringify(original)));
    expect(sessionStorage.getItem("abr-pending-aftersales:org:user")).toBeNull();
  });
  it("blocks mutations if stored retry instructions are invalid", async () => {
    sessionStorage.setItem("abr-pending-aftersales:org:user", JSON.stringify({ name: "resetOrganization", input: {} }));
    state.call.mockResolvedValue(workspace);
    render(<AftersalesPage />);
    await screen.findByText(/Saved service instructions could not be read/);
    expect((screen.getByRole("button", { name: "Record payment" }).closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
    expect(state.call.mock.calls.every(call => call[0] === "getAftersalesWorkspace")).toBe(true);
  });
});
