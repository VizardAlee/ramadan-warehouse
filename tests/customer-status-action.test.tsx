// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CustomerStatusAction } from "@/features/customers/customer-status-action";
import type { Customer } from "@/types/domain";
const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/features/administration/api", () => ({ callAdministration: api.call }));
vi.mock("@/features/finance/financial-privacy", () => ({ FinancialText: ({ children }: { children: React.ReactNode }) => children, FinancialMessage: ({ children }: { children: React.ReactNode }) => children }));
const customer = { id: "c1", name: "Amina", customerNumber: "CUS-1", active: true, outstandingBalanceMinor: 0 } as Customer;
afterEach(() => { cleanup(); api.call.mockReset(); });
it("requires confirmation, preserves records and refreshes on success", async () => {
  api.call.mockResolvedValue({ saved: true }); const saved = vi.fn();
  render(<CustomerStatusAction customer={customer} onSaved={saved} />);
  fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
  expect(screen.getByText(/Nothing is permanently deleted/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Deactivate customer" }).hasAttribute("disabled")).toBe(true);
  fireEvent.change(screen.getByLabelText(/Confirm customer number/), { target: { value: "CUS-1" } });
  fireEvent.click(screen.getByRole("button", { name: "Deactivate customer" }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(api.call).toHaveBeenCalledWith("saveCustomer", expect.objectContaining({ action: "set_status", active: false, customerId: "c1" }));
});
it("closing confirmation makes no changes", () => {
  render(<CustomerStatusAction customer={customer} onSaved={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).toBeNull(); expect(api.call).not.toHaveBeenCalled();
});
it.each([{ outstandingBalanceMinor: 1 }, { advanceBalances: { general: 1 } }])("blocks unsettled customer %j", balances => {
  render(<CustomerStatusAction customer={{ ...customer, ...balances }} onSaved={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
  fireEvent.change(screen.getByLabelText(/Confirm customer number/), { target: { value: "CUS-1" } });
  expect(screen.getByRole("button", { name: "Deactivate customer" }).hasAttribute("disabled")).toBe(true);
});
it("retries the identical operation after an uncertain response and reopen", async () => {
  api.call.mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValueOnce({ saved: false });
  render(<CustomerStatusAction customer={customer} onSaved={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
  fireEvent.change(screen.getByLabelText(/Confirm customer number/), { target: { value: "CUS-1" } });
  fireEvent.click(screen.getByRole("button", { name: "Deactivate customer" }));
  await screen.findByRole("button", { name: "Retry same change" });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
  fireEvent.click(screen.getByRole("button", { name: "Retry same change" }));
  await waitFor(() => expect(api.call).toHaveBeenCalledTimes(2));
  expect(api.call.mock.calls[1]![1]).toEqual(api.call.mock.calls[0]![1]);
});
it("offers reactivation for inactive customers", () => {
  render(<CustomerStatusAction customer={{ ...customer, active: false }} onSaved={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Reactivate" }));
  expect(screen.getByRole("button", { name: "Reactivate customer" })).toBeTruthy();
});
