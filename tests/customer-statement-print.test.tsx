// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CustomerAccountStatement } from "@/features/customers/account-statement";
import type { CustomerHistory } from "@/features/customers/history-presentation";
const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/features/administration/api", () => ({ callAdministration: api.call }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("prints every statement page from the beginning with the selected dates and arrangement", async () => {
  const result: CustomerHistory = {
    customer: { id: "c1", name: "Customer", customerNumber: "CUS-1", creditStatus: "approved", creditLimitMinor: 10000, outstandingBalanceMinor: 5000, availableCreditMinor: 5000 },
    rows: [], moreAvailable: false, nextCursor: null,
    statement: { accountId: "general", accountName: "General", outstandingMinor: 5000, advanceMinor: 0, asOf: "2026-10-10T10:00:00Z", scannedCount: 0, branchId: "b1", fromDate: "2026-10-01", toDate: "2026-10-10", openingDebtMinor: 10000, closingDebtMinor: 5000 },
  };
  api.call.mockImplementation((_name, input) => Promise.resolve({ ...result, rows: [{ id: input.cursor ? "account:2" : "account:1", kind: "account", detail: "payment", reference: input.cursor ? "PAY-2" : "PAY-1", at: "2026-10-10T09:00:00Z", amountMinor: -2500, debtChangeMinor: -2500, advanceChangeMinor: 0 }], nextCursor: input.cursor ? null : { account: "1" } }));
  const print = vi.spyOn(window, "print").mockImplementation(() => {});
  render(<CustomerAccountStatement result={result} />);
  fireEvent.click(screen.getByRole("button", { name: "Print / Save complete statement" }));
  await waitFor(() => expect(print).toHaveBeenCalledOnce());
  expect(api.call).toHaveBeenNthCalledWith(1, "getCustomerHistory", expect.objectContaining({ cursor: undefined, branchId: "b1", customerAccountId: "general", fromDate: "2026-10-01", toDate: "2026-10-10" }));
  expect(api.call).toHaveBeenNthCalledWith(2, "getCustomerHistory", expect.objectContaining({ cursor: { account: "1" } }));
  expect(document.querySelector("[data-print-document]")?.textContent).toContain("PAY-1");
  expect(document.querySelector("[data-print-document]")?.textContent).toContain("PAY-2");
  fireEvent(window, new Event("afterprint"));
  await waitFor(() => expect(document.querySelector("[data-print-document]")).toBeNull());
});
