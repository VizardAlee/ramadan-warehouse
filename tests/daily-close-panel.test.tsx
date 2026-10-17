// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DailyClosePanel } from "@/features/reconciliation/daily-close-panel";
const mocks = vi.hoisted(() => ({ call: vi.fn(), profile: { roleId: "system_administrator", status: "active", organizationId: "org", branchIds: ["store1"] } }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({ profile: mocks.profile, operatingContext: null }) }));
vi.mock("@/features/administration/api", () => ({ callAdministration: mocks.call }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("daily close workspace", () => {
  it("requires physical counted cash and retains the retry key after a network failure", async () => {
    let attempts = 0;
    mocks.call.mockImplementation(async (name, payload) => {
      if (payload.action === "locations") return { rows: [{ id: "store1", name: "Head Office" }, { id: "store2", name: "Another store" }], nextCursor: null };
      if (name === "prepareDailyClose") { attempts++; throw new Error("Network interrupted"); }
      return { branchId: payload.branchId, date: payload.date, branchName: "Head Office", close: null,
        evidence: { hash: "a".repeat(64), cash: { openingMinor: 10_000, receiptsMinor: 5_000, paymentsMinor: 2_000, closingMinor: 13_000, lineCount: 3 }, stockCounts: [], openShiftCount: 0, closedShiftCount: 0, tillVarianceMinor: 0, exceptions: ["No completed stock count."] } };
    });
    render(<DailyClosePanel />);
    await screen.findByRole("button", { name: "Prepare daily close" });
    const submit = screen.getByRole("button", { name: "Prepare daily close" });
    expect(submit.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("Physical store cash counted (₦)"), { target: { value: "130.00" } });
    fireEvent.change(screen.getByLabelText("Variance / exception explanation"), { target: { value: "The shelf count is scheduled for tomorrow." } });
    fireEvent.click(submit);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Network interrupted"));
    fireEvent.click(submit);
    await waitFor(() => expect(attempts).toBe(2));
    const calls = mocks.call.mock.calls.filter(([name]) => name === "prepareDailyClose");
    expect(calls[0]![1]).toMatchObject({ branchId: "store1", countedCashMinor: 13_000, evidenceHash: "a".repeat(64) });
    expect(calls[1]![1].idempotencyKey).toBe(calls[0]![1].idempotencyKey);
    fireEvent.change(screen.getByLabelText("Store"), { target: { value: "store2" } });
    await waitFor(() => expect(mocks.call.mock.calls.filter(([name]) => name === "getDailyCloseWorkspace").at(-1)?.[1]).toMatchObject({ branchId: "store2" }));
    await waitFor(() => expect(screen.getByLabelText("Physical store cash counted (₦)").getAttribute("value")).toBe(""));
  });
});

describe("legacy daily-close UI comparison", () => {
  it.each(["prepared", "signed"])("uses server compatibility for unchanged %s legacy evidence", async status => {
    mocks.call.mockImplementation(async (_name, payload) => payload.action === "locations" ? { rows: [{ id: "store1", name: "Store" }], nextCursor: null } : {
      branchId: payload.branchId, date: payload.date, branchName: "Store", evidenceChanged: false,
      evidence: { hash: "new-precise-hash", hashVersion: 2, cash: { openingMinor: 0, receiptsMinor: 100, paymentsMinor: 0, closingMinor: 100, lineCount: 1 }, stockCounts: [], openShiftCount: 0, closedShiftCount: 0, tillVarianceMinor: 0, exceptions: [] },
      close: { version: 1, status, countedCashMinor: 100, explanation: "Checked cash", evidence: { hash: "original-legacy-hash" } },
    });
    render(<DailyClosePanel />); await screen.findByText(`Revision 1 · ${status === "signed" ? "Signed off" : "Prepared — ready for sign-off"}`);
    expect(screen.queryByText(/New or changed postings/)).toBeNull();
    if (status === "prepared") expect(screen.getByRole("button", { name: "Sign off this revision" })).toBeTruthy();
    else { expect(screen.queryByRole("button", { name: "Prepare daily close" })).toBeNull(); expect((screen.getByLabelText("Physical store cash counted (₦)") as HTMLInputElement).disabled).toBe(true); }
  });
  it("still shows genuinely changed evidence and blocks signing", async () => {
    mocks.call.mockImplementation(async (_name, payload) => payload.action === "locations" ? { rows: [{ id: "store1", name: "Store" }], nextCursor: null } : {
      branchId: payload.branchId, date: payload.date, branchName: "Store", evidenceChanged: true,
      evidence: { hash: "changed", cash: { openingMinor: 0, receiptsMinor: 101, paymentsMinor: 0, closingMinor: 101, lineCount: 1 }, stockCounts: [], openShiftCount: 0, closedShiftCount: 0, tillVarianceMinor: 0, exceptions: [] },
      close: { version: 1, status: "prepared", countedCashMinor: 100, explanation: "Checked cash", evidence: { hash: "original" } },
    });
    render(<DailyClosePanel />); await screen.findByText(/New or changed postings/);
    expect(screen.queryByRole("button", { name: "Sign off this revision" })).toBeNull();
  });
});

it("explains and disables writes when the server permits only reading this store", async () => {
  mocks.call.mockImplementation(async (_name, payload) => payload.action === "locations" ? { rows: [{ id: "store1", name: "Readable store" }], nextCursor: null } : {
    branchId: payload.branchId, date: payload.date, branchName: "Readable store", canPrepare: false, canSign: false, evidenceChanged: false,
    evidence: { hash: "same", cash: { openingMinor: 0, receiptsMinor: 100, paymentsMinor: 0, closingMinor: 100, lineCount: 1 }, stockCounts: [], openShiftCount: 0, closedShiftCount: 0, tillVarianceMinor: 0, exceptions: [] },
    close: { version: 1, status: "prepared", countedCashMinor: 100, explanation: "Checked cash", evidence: { hash: "same" } },
  });
  render(<DailyClosePanel />);
  const prepare = await screen.findByRole("button", { name: "Prepare daily close" });
  const sign = screen.getByRole("button", { name: "Sign off this revision" });
  expect((prepare as HTMLButtonElement).disabled).toBe(true);
  expect((sign as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByLabelText("Physical store cash counted (₦)") as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByLabelText("Sign-off notes") as HTMLTextAreaElement).disabled).toBe(true);
  fireEvent.click(prepare); fireEvent.click(sign);
  expect(mocks.call.mock.calls.some(([name]) => name === "prepareDailyClose" || name === "signDailyClose")).toBe(false);
});
