// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StaffAdvancePanel, advanceAmountMinor } from "@/features/reconciliation/staff-advance-panel";
const mocks = vi.hoisted(() => ({ call: vi.fn(), allowed: ["cash.advances.read", "cash.advances.return"], context: null as { type: "branch"; id: string } | null }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({ profile: { id: "user", organizationId: "org", branchIds: ["store1"], effectivePermissions: mocks.allowed }, operatingContext: mocks.context }) }));
vi.mock("@/lib/permissions/roles", () => ({ hasPermission: (_profile: unknown, permission: string) => mocks.allowed.includes(permission) }));
vi.mock("@/features/administration/api", () => ({ callAdministration: mocks.call }));
const advance = { id: "advance1", branchId: "store1", recipientName: "Driver One", recipientType: "driver", purpose: "Delivery to customers", issuedMinor: 20000, retiredMinor: 5000, returnedMinor: 0, outstandingMinor: 15000, status: "open", issuedAt: "2026-11-13T10:00:00Z" };
function normal(_name: string, input: Record<string, unknown>) {
  if (input.action === "locations") return { branches: [{ id: "store1", name: "Store One" }, { id: "store2", name: "Store Two" }], nextCursorId: null };
  if (input.action === "workspace") return { advances: input.branchId === "store1" ? [advance] : [], nextCursorId: null };
  if (input.action === "detail") return { advance, events: [], nextCursorId: null };
  if (input.action === "accounts") return { accounts: [{ id: "account1", bankName: "Bank", accountName: "Store One", accountNumberLast4: "1234" }], nextCursorId: null };
  return { advanceId: "advance1" };
}
beforeEach(() => { mocks.allowed = ["cash.advances.read", "cash.advances.return"]; mocks.context = null; mocks.call.mockImplementation(normal); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
async function openReturn() {
  fireEvent.click(await screen.findByRole("button", { name: /Driver One/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Record unused money returned" }));
  fireEvent.change(screen.getByLabelText("Advance amount (₦)"), { target: { value: "100" } });
  fireEvent.change(screen.getByLabelText("Movement / receipt reference"), { target: { value: "RECEIPT-1" } });
  fireEvent.change(screen.getByLabelText("Explanation"), { target: { value: "Driver returned unused delivery cash" } });
  fireEvent.click(screen.getByRole("checkbox"));
}
describe("staff advances", () => {
  it("parses exact positive minor units and rejects excess precision or unsafe amounts", () => {
    expect(advanceAmountMinor("1.01")).toBe(101);
    expect(advanceAmountMinor("250000")).toBe(25000000);
    for (const value of ["", "0", "-1", "1.001", "1e5", "9007199254740991"]) expect(advanceAmountMinor(value)).toBeNull();
  });
  it("hides all calls and workflow without read access", () => { mocks.allowed = []; render(<StaffAdvancePanel />); expect(screen.queryByText("Staff & driver advances")).toBeNull(); expect(mocks.call).not.toHaveBeenCalled(); });
  it("restricts the return officer and retains retry key on interrupted return", async () => {
    mocks.call.mockImplementation((name, input) => { if (input.action === "return") throw new Error("Network interrupted"); return normal(name, input); });
    render(<StaffAdvancePanel />); await openReturn();
    expect(screen.queryByRole("button", { name: "Record issued advance" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Record documented spending" })).toBeNull();
    const submit = screen.getAllByRole("button", { name: "Record unused money returned" }).at(-1)!;
    fireEvent.click(submit); await screen.findByRole("alert"); expect((screen.getByLabelText("Advance store") as HTMLSelectElement).disabled).toBe(true); expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true); fireEvent.click(screen.getByRole("button", { name: "Retry same record" }));
    await waitFor(() => expect(mocks.call.mock.calls.filter(([, input]) => input.action === "return")).toHaveLength(2));
    const calls = mocks.call.mock.calls.filter(([, input]) => input.action === "return");
    expect(calls[0][1]).toMatchObject({ advanceId: "advance1", amountMinor: 10000, method: "cash", reference: "RECEIPT-1" });
    expect(calls[0][1].idempotencyKey).toBe(calls[1][1].idempotencyKey);
  });
  it("blocks over-return and requires the actual bank account", async () => {
    render(<StaffAdvancePanel />); await openReturn();
    const submit = screen.getAllByRole("button", { name: "Record unused money returned" }).at(-1)!;
    fireEvent.change(screen.getByLabelText("Advance amount (₦)"), { target: { value: "151" } });
    expect(submit.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("Advance amount (₦)"), { target: { value: "150" } });
    fireEvent.change(screen.getByLabelText("Actual payment method"), { target: { value: "bank_transfer" } });
    await screen.findByRole("option", { name: /ending 1234/ }); expect(submit.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("Receiving bank account"), { target: { value: "account1" } });
    expect(submit.hasAttribute("disabled")).toBe(false); fireEvent.click(submit);
    await waitFor(() => expect(mocks.call.mock.calls.some(([, input]) => input.action === "return" && input.bankAccountId === "account1" && input.amountMinor === 15000)).toBe(true));
  });
  it("discards selected advance and forms on branch switch", async () => {
    render(<StaffAdvancePanel />); await openReturn();
    fireEvent.change(screen.getByLabelText("Advance store"), { target: { value: "store2" } });
    await screen.findByText("No advances recorded for this store.");
    expect(screen.queryByLabelText("Advance amount (₦)")).toBeNull();
    expect(mocks.call.mock.calls.some(([, input]) => input.action === "return")).toBe(false);
  });
  it("submits only once while a return response is pending", async () => {
    let resolveReturn: ((value: { advanceId: string }) => void) | undefined;
    mocks.call.mockImplementation((name, input) => input.action === "return" ? new Promise(resolve => { resolveReturn = resolve; }) : normal(name, input));
    render(<StaffAdvancePanel />); await openReturn();
    const submit = screen.getAllByRole("button", { name: "Record unused money returned" }).at(-1)!;
    fireEvent.click(submit); fireEvent.click(submit);
    expect(mocks.call.mock.calls.filter(([, input]) => input.action === "return")).toHaveLength(1);
    resolveReturn!({ advanceId: "advance1" });
    await waitFor(() => expect(screen.queryByLabelText("Advance amount (₦)")).toBeNull());
  });
  it("ignores a late prior-store response after changing stores", async () => {
    let resolveOld: ((value: unknown) => void) | undefined;
    mocks.call.mockImplementation((name, input) => input.action === "workspace" && input.branchId === "store1" ? new Promise(resolve => { resolveOld = resolve; }) : normal(name, input));
    render(<StaffAdvancePanel />);
    await screen.findByRole("option", { name: "Store Two" });
    fireEvent.change(screen.getByLabelText("Advance store"), { target: { value: "store2" } });
    await screen.findByText("No advances recorded for this store.");
    resolveOld!({ advances: [advance], nextCursorId: null });
    await waitFor(() => expect(screen.queryByRole("button", { name: /Driver One/ })).toBeNull());
  });

});
