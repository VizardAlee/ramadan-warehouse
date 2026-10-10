// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { HrHistory } from "@/features/hr/history";
import { ProductMargins } from "@/features/reports/product-margins";
import { BudgetComparison } from "@/features/accounting/budget-comparison";
import * as format from "@/features/inventory/format";
const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/features/administration/api", () => ({ callAdministration: api.call }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); api.call.mockReset(); });
const event = (id: string) => ({ id, staffId: "HR-1", employeeName: "Worker", kind: "clock_in", occurredAt: "2026-10-01T08:00:00Z", occurredOn: null, source: "manual", reason: "Correction", summary: null });
it("exports all HR pages from the beginning with report metadata", async () => {
  api.call.mockImplementation((_name, input) => Promise.resolve({ rows: [event(input.cursorId ? "second" : "first")], nextCursorId: input.cursorId ? null : "first" }));
  const download = vi.spyOn(format, "downloadCsv").mockImplementation(() => {});
  render(<HrHistory />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Export full range CSV" })).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() => expect(screen.getByText("Page 2")).toBeTruthy());
  await waitFor(() => expect(screen.getByRole("button", { name: "Export full range CSV" })).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: "Export full range CSV" }));
  await waitFor(() => expect(download).toHaveBeenCalledOnce());
  const calls = api.call.mock.calls.filter(([, input]) => input.limit === 100);
  expect(calls).toHaveLength(2); expect(calls[0]?.[1]).toMatchObject({ cursorId: undefined, kind: "attendance" });
  expect(calls[1]?.[1]).toMatchObject({ cursorId: "first" });
  expect(download.mock.calls[0]?.[1]).toHaveLength(2);
  expect(download.mock.calls[0]?.[1][0]).toMatchObject({ history: "attendance", timezone: "Africa/Lagos", staffId: "HR-1" });
});
it("does not export a partial HR file when pagination repeats", async () => {
  api.call.mockResolvedValue({ rows: [event("first")], nextCursorId: "first" });
  const download = vi.spyOn(format, "downloadCsv").mockImplementation(() => {});
  render(<HrHistory />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Export full range CSV" })).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: "Export full range CSV" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("History changed"));
  expect(download).not.toHaveBeenCalled();
});
it("keeps missing-cost margin unknown in screen and CSV, with invoice-cohort metadata", async () => {
  api.call.mockResolvedValue({ invoiceCount: 1, completedAt: "2026-10-10T10:00:00Z", rows: [{ productId: "p1", sku: "P1", productName: "Part", invoicedQuantity: 1, reversedQuantity: 0, invoicedNetMinor: 10000, reversedNetMinor: 0, netSalesMinor: 10000, recordedCostMinor: 0, restockCreditMinor: 0, netRecordedCostMinor: 0, unknownCostLines: 1, grossMarginMinor: null }] });
  const download = vi.spyOn(format, "downloadCsv").mockImplementation(() => {});
  render(<ProductMargins branchId="b1" fromDate="2026-10-01" toDate="2026-10-10" />);
  fireEvent.click(screen.getByRole("button", { name: "Calculate product margins" }));
  await waitFor(() => expect(screen.getByRole("cell", { name: "Unknown" })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Export product CSV" }));
  expect(download.mock.calls[0]?.[1][0]).toMatchObject({ fromDate: "2026-10-01", toDate: "2026-10-10", storeScope: "b1", grossMarginNaira: "Unknown", unknownCostLines: 1 });
  expect(download.mock.calls[0]?.[1][0]?.reportBasis).toContain("not period P&L");
});
it("distinguishes missing monthly targets from an explicitly saved zero target", async () => {
  api.call.mockResolvedValue({ months: ["2026-10", "2026-11"], rows: [{ id: "b1", month: "2026-10", accountCode: "4100", accountName: "Service income", amountMinor: 0, actualMinor: 1000, varianceMinor: 1000, variancePercent: null, favorable: true, kind: "Income" }] });
  const download = vi.spyOn(format, "downloadCsv").mockImplementation(() => {});
  render(<BudgetComparison month="2026-10" branchId="store-a" />);
  fireEvent.change(screen.getByLabelText("To month"), { target: { value: "2026-11" } });
  fireEvent.click(screen.getByRole("button", { name: "Compare months" }));
  await waitFor(() => expect(screen.getByText("2026-11: no saved targets")).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Export comparison CSV" }));
  expect(download.mock.calls[0]?.[1]).toMatchObject([{ storeScope: "store-a", month: "2026-10", targetNaira: 0, actualNaira: 10 }]);
});

it("clears pending product loading on scope change and ignores the old response", async () => {
  let finishOld!: (value: unknown) => void;
  api.call.mockImplementation((_name, input) => input.branchId === "old-store" ? new Promise(resolve => { finishOld = resolve; }) : Promise.resolve({ rows: [], invoiceCount: 2, completedAt: "2026-10-10T10:00:00Z" }));
  const view = render(<ProductMargins branchId="old-store" fromDate="2026-10-01" toDate="2026-10-10" />);
  fireEvent.click(screen.getByRole("button", { name: "Calculate product margins" }));
  expect(screen.getByRole("button", { name: "Calculating…" })).toBeDisabled();
  view.rerender(<ProductMargins branchId="new-store" fromDate="2026-10-01" toDate="2026-10-10" />);
  expect(screen.getByRole("button", { name: "Calculate product margins" })).not.toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Calculate product margins" }));
  await waitFor(() => expect(screen.getByText(/2 invoices/)).toBeTruthy());
  finishOld({ rows: [], invoiceCount: 999, completedAt: "2026-10-10T10:00:00Z" });
  await waitFor(() => expect(screen.queryByText(/999 invoices/)).toBeNull());
  expect(api.call.mock.calls.at(-1)?.[1]).toMatchObject({ branchId: "new-store" });
});
it("clears pending budget loading when the store changes", async () => {
  let finishOld!: (value: unknown) => void;
  api.call.mockImplementation((_name, input) => input.branchId === "old-store" ? new Promise(resolve => { finishOld = resolve; }) : Promise.resolve({ rows: [], months: ["2026-10"] }));
  const view = render(<BudgetComparison month="2026-10" branchId="old-store" />);
  fireEvent.click(screen.getByRole("button", { name: "Compare months" }));
  expect(screen.getByRole("button", { name: "Comparing…" })).toBeDisabled();
  view.rerender(<BudgetComparison month="2026-10" branchId="new-store" />);
  expect(screen.getByRole("button", { name: "Compare months" })).not.toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Compare months" }));
  await waitFor(() => expect(screen.getByText("2026-10: no saved targets")).toBeTruthy());
  finishOld({ rows: [], months: ["2025-01"] });
  await waitFor(() => expect(screen.queryByText("2025-01: no saved targets")).toBeNull());
});

it("never relabels completed old-store budget numbers when exporting a new scope", async () => {
  api.call.mockImplementation((_name, input) => Promise.resolve({ months: ["2026-10"], rows: [{ id: input.branchId, month: "2026-10", accountCode: "4100", accountName: input.branchId, amountMinor: 1000, actualMinor: input.branchId === "old-store" ? 1000 : 2000, varianceMinor: 0, variancePercent: 0, favorable: true, kind: "Income" }] }));
  const download = vi.spyOn(format, "downloadCsv").mockImplementation(() => {});
  const view = render(<BudgetComparison month="2026-10" branchId="old-store" />);
  fireEvent.click(screen.getByRole("button", { name: "Compare months" }));
  await waitFor(() => expect(screen.getByText("4100 · old-store")).toBeTruthy());
  view.rerender(<BudgetComparison month="2026-10" branchId="new-store" />);
  expect(screen.queryByText("4100 · old-store")).toBeNull();
  expect(screen.getByRole("button", { name: "Export comparison CSV" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Compare months" }));
  await waitFor(() => expect(screen.getByText("4100 · new-store")).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Export comparison CSV" }));
  expect(download.mock.calls[0]?.[1][0]).toMatchObject({ storeScope: "new-store", actualNaira: 20 });
});
