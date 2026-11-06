// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CustomerOwnershipReview } from "@/features/customers/ownership-review";
const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/features/administration/api", () => ({ callAdministration: api.call }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const row = { customerId: "customer", customerNumber: "CUS-001", name: "Reviewed customer", currentBranchName: "Unassigned", fingerprint: "a".repeat(64), issues: ["missing_owner"], blockers: [], allowedTargetBranchIds: ["branch"], branches: [{ id: "branch", name: "Branch one" }], outstandingMinor: 0, trackedUnpaidMinor: 0, advanceMinor: 0, activity: [], openInvoices: [], advanceBalances: {}, arrangements: [] };
it("requires All and never retrieves company evidence from a selected branch", () => { render(<CustomerOwnershipReview allLocations={false} />); expect(screen.getByText(/Select All locations/)).toBeTruthy(); expect(api.call).not.toHaveBeenCalled(); });
it("requires deliberate branch choice, exact number, reason and history acknowledgement", async () => {
  api.call.mockResolvedValue({ rows: [row], nextCursor: null });
  render(<CustomerOwnershipReview allLocations />);
  fireEvent.click(screen.getByRole("button", { name: "Start / refresh review" }));
  await screen.findByText("Reviewed customer · CUS-001 · Unassigned");
  expect((screen.getByLabelText("Reviewed owning branch") as HTMLSelectElement).value).toBe("");
  const button = screen.getByRole("button", { name: "Save reviewed ownership" }) as HTMLButtonElement; expect(button.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Reviewed owning branch"), { target: { value: "branch" } });
  fireEvent.change(screen.getByLabelText("Review reason"), { target: { value: "Verified original branch evidence" } });
  fireEvent.change(screen.getByLabelText("Confirm customer number"), { target: { value: "CUS-001" } });
  fireEvent.click(screen.getByRole("checkbox")); expect(button.disabled).toBe(false);
  fireEvent.click(button);
  await waitFor(() => expect(api.call).toHaveBeenCalledWith("getCustomerHistory", expect.objectContaining({ action: "ownership_assign", branchId: "branch", expectedFingerprint: row.fingerprint, confirmedCustomerNumber: "CUS-001", acknowledgeHistoryUnchanged: true })));
});
it("shows evidence without an assignment action when accounting review is required", async () => {
  api.call.mockResolvedValue({ rows: [{ ...row, blockers: ["balance_review_required"], allowedTargetBranchIds: [], advanceMinor: 1000, openInvoices: [{ id: "invoice", number: "SAL-001", outstandingMinor: null }] }], nextCursor: null });
  render(<CustomerOwnershipReview allLocations />); fireEvent.click(screen.getByRole("button", { name: "Start / refresh review" }));
  await screen.findByText(/Assignment is blocked pending accounting review/); expect(screen.getByText(/Open invoice: SAL-001/)).toBeTruthy(); expect(screen.queryByRole("button", { name: "Save reviewed ownership" })).toBeNull();
});
