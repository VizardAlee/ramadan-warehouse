// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CustomerAccountStatement } from "@/features/customers/account-statement";
import * as format from "@/features/inventory/format";
import type { CustomerHistory } from "@/features/customers/history-presentation";
const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/features/administration/api", () => ({ callAdministration: api.call }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); api.call.mockReset(); });
it("prints every statement page from the beginning with the selected dates and arrangement", async () => {
  const result: CustomerHistory = {
    customer: { id: "c1", name: "Customer", customerNumber: "CUS-1", creditStatus: "approved", creditLimitMinor: 10000, outstandingBalanceMinor: 5000, availableCreditMinor: 5000 },
    rows: [], moreAvailable: false, nextCursor: null,
    statement: { accountId: "general", accountName: "General", outstandingMinor: 5000, advanceMinor: 0, asOf: "2026-10-10T10:00:00Z", scannedCount: 0, branchId: "b1", fromDate: "2026-10-01", toDate: "2026-10-10", openingDebtMinor: 10000, openingAdvanceMinor: 0, closingDebtMinor: 5000, closingAdvanceMinor: 0 },
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

it("exports fresh opening and closing balances plus all paginated movements and running balances", async () => {
  const result: CustomerHistory = {
    customer: { id: "c1", name: "Customer", customerNumber: "CUS-1", creditStatus: "approved", creditLimitMinor: 10000, outstandingBalanceMinor: 5000, availableCreditMinor: 5000 },
    rows: [{ id: "screen", kind: "account", branchId: "b1", detail: "payment", reference: "SCREEN", at: "2033-03-01T00:00:00Z", amountMinor: -1000, debtChangeMinor: -1000, advanceChangeMinor: 0, runningDebtMinor: 9000, runningAdvanceMinor: 2000 }], moreAvailable: false, nextCursor: null,
    statement: { accountId: "general", accountName: "General", outstandingMinor: 5000, advanceMinor: 0, asOf: "2033-03-01T10:00:00Z", scannedCount: 1, branchId: "b1", fromDate: "2033-03-01", toDate: "2033-03-01", openingDebtMinor: 1, openingAdvanceMinor: 0, closingDebtMinor: 1, closingAdvanceMinor: 0 },
  };
  api.call.mockImplementation((_name, input) => Promise.resolve({ ...result,
    statement: { ...result.statement, openingDebtMinor: 10000, openingAdvanceMinor: 2000, closingDebtMinor: 7000, closingAdvanceMinor: 2000 },
    rows: [{ id: input.cursor ? "pay1" : "pay2", kind: "account", branchId: "b1", detail: "payment", reference: input.cursor ? "PAY-1" : "PAY-2", at: "2033-02-28T23:30:00Z", amountMinor: input.cursor ? -1000 : -2000, debtChangeMinor: input.cursor ? -1000 : -2000, advanceChangeMinor: 0 }], nextCursor: input.cursor ? null : { account: "pay2" },
  }));
  const download = vi.spyOn(format, "downloadCsv").mockImplementation(() => {});
  render(<CustomerAccountStatement result={result} />);
  expect(screen.getByRole("columnheader", { name: "Debt debit" })).toBeTruthy();
  expect(screen.getByRole("columnheader", { name: "Debt credit" })).toBeTruthy();
  expect(screen.getByRole("columnheader", { name: "Debt balance" })).toBeTruthy();
  expect(screen.getByText(`Debt balance: ${format.formatNaira(9000)}`)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Export complete statement" }));
  await waitFor(() => expect(download).toHaveBeenCalledOnce());
  const rows = download.mock.calls[0]![1];
  expect(rows).toMatchObject([
    { rowType: "opening", customerName: "Customer", customerNumber: "CUS-1", storeScope: "b1", runningDebtNaira: 100, runningAdvanceNaira: 20 },
    { rowType: "transaction", reference: "PAY-1", debtCreditNaira: 10, runningDebtNaira: 90, runningAdvanceNaira: 20 },
    { rowType: "transaction", reference: "PAY-2", debtCreditNaira: 20, runningDebtNaira: 70, runningAdvanceNaira: 20 },
    { rowType: "closing", runningDebtNaira: 70, runningAdvanceNaira: 20 },
  ]);
  expect(api.call).toHaveBeenNthCalledWith(1, "getCustomerHistory", expect.objectContaining({ includeSummary: true, cursor: undefined }));
  expect(api.call).toHaveBeenNthCalledWith(2, "getCustomerHistory", expect.objectContaining({ includeSummary: false, cursor: { account: "pay2" } }));
});

it("prints and exports opening and closing rows for an empty selected period", async () => {
  const result: CustomerHistory = {
    customer: { id: "empty", name: "Empty period", customerNumber: "CUS-EMPTY", creditStatus: "approved", creditLimitMinor: 10000, outstandingBalanceMinor: 3500, availableCreditMinor: 6500 },
    rows: [], moreAvailable: false, nextCursor: null,
    statement: { accountId: "general", accountName: "General", outstandingMinor: 3500, advanceMinor: 700, asOf: "2033-03-01T10:00:00Z", scannedCount: 0, fromDate: "2033-03-01", toDate: "2033-03-01", openingDebtMinor: 3500, closingDebtMinor: 3500, openingAdvanceMinor: 700, closingAdvanceMinor: 700 },
  };
  api.call.mockResolvedValue(result);
  const download = vi.spyOn(format, "downloadCsv").mockImplementation(() => {});
  const print = vi.spyOn(window, "print").mockImplementation(() => {});
  render(<CustomerAccountStatement result={result} />);
  fireEvent.click(screen.getByRole("button", { name: "Export complete statement" }));
  await waitFor(() => expect(download).toHaveBeenCalledOnce());
  expect(download.mock.calls[0]![1]).toMatchObject([{ rowType: "opening", runningDebtNaira: 35, runningAdvanceNaira: 7 }, { rowType: "closing", runningDebtNaira: 35, runningAdvanceNaira: 7 }]);
  fireEvent.click(screen.getByRole("button", { name: "Print / Save complete statement" }));
  await waitFor(() => expect(print).toHaveBeenCalledOnce());
  const document = window.document.querySelector("[data-print-document]")!;
  expect(document.textContent).toContain("Opening recorded balance");
  expect(document.textContent).toContain("Closing recorded balance");
  expect(document.querySelectorAll("tbody tr")).toHaveLength(2);
});

it("keeps all balance columns and long references in a complete multi-page printable statement", async () => {
  const rows: CustomerHistory["rows"] = Array.from({ length: 40 }, (_, index) => ({ id: `long-${index}`, kind: "account", branchId: "b1", reference: `PAY-${String(index).padStart(3, "0")}-LONG-CUSTOMER-REFERENCE-2033`, accountName: "Solar equipment and installation arrangement", detail: "payment", amountMinor: -100000000, debtChangeMinor: -100000000, advanceChangeMinor: 0, at: new Date(Date.parse("2033-02-28T23:00:00Z") + index * 60000).toISOString(), invoiceAllocations: [{ saleId: "sale1", saleNumber: "INV-2033-000001-SOLAR-EQUIPMENT-AND-INSTALLATION", amountMinor: 1000 }] }));
  const result: CustomerHistory = {
    customer: { id: "long", name: "Long statement fixture customer", customerNumber: "CUS-LONG", creditStatus: "approved", creditLimitMinor: 200000, outstandingBalanceMinor: 6000000000, availableCreditMinor: 140000 },
    rows: [], moreAvailable: false, nextCursor: null,
    statement: { accountId: "general", accountName: "Solar equipment and installation arrangement", outstandingMinor: 6000000000, advanceMinor: 5000, asOf: "2033-03-01T10:00:00Z", scannedCount: 40, fromDate: "2033-03-01", toDate: "2033-03-01", openingDebtMinor: 10000000000, closingDebtMinor: 6000000000, openingAdvanceMinor: 5000, closingAdvanceMinor: 5000, debtAddedMinor: 0, debtClearedMinor: 4000000000, advanceReceivedMinor: 0, advanceUsedMinor: 0 },
  };
  api.call.mockImplementation((_name, input) => Promise.resolve({ ...result, rows: input.cursor ? rows.slice(0, 20).reverse() : rows.slice(20).reverse(), nextCursor: input.cursor ? null : { account: "long-20" } }));
  const print = vi.spyOn(window, "print").mockImplementation(() => {});
  render(<CustomerAccountStatement result={result} />);
  fireEvent.click(screen.getByRole("button", { name: "Print / Save complete statement" }));
  await waitFor(() => expect(print).toHaveBeenCalledOnce());
  const printable = document.querySelector("[data-print-document]")!;
  expect(printable.querySelectorAll("th")).toHaveLength(8);
  expect(printable.querySelectorAll("tbody tr")).toHaveLength(42);
  expect(printable.textContent).toContain("PAY-039-LONG-CUSTOMER-REFERENCE-2033");
  if (process.env.STATEMENT_PRINT_FIXTURE_DIR) {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(process.env.STATEMENT_PRINT_FIXTURE_DIR, { recursive: true });
    writeFileSync(`${process.env.STATEMENT_PRINT_FIXTURE_DIR}/statement.html`, `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="statement.css"></head><body><main>Background app content must not print</main>${printable.outerHTML}</body></html>`);
  }
});
