// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InvoiceCostCorrection } from "@/features/procurement/invoice-cost-correction";
import type { SupplierInvoice } from "@/types/domain";
const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/features/administration/api", () => ({ callAdministration: api.call }));
vi.mock("@/features/finance/financial-privacy", () => ({ FinancialAction: ({children}: {children: React.ReactNode}) => children, FinancialInput: ({children}: {children: React.ReactNode}) => children, FinancialText: ({children}: {children: React.ReactNode}) => children, FinancialValue: ({children}: {children: React.ReactNode}) => children, FinancialMessage: ({children}: {children: React.ReactNode}) => <p role="alert">{children}</p> }));
const invoice = { id: "invoice", purchaseOrderId: "order", branchId: "branch", grossAmountMinor: 3000000 } as SupplierInvoice;
function Form() { const [locked, setLocked] = useState(true); return <><button disabled={locked}>Approve invoice</button><InvoiceCostCorrection invoice={invoice} ownerKey="org:user" onLock={setLocked} onComplete={() => {}} /></>; }
beforeEach(() => { sessionStorage.clear(); vi.clearAllMocks(); api.call.mockImplementation(async (name, input) => {
  if (name === "getProcurementWorkspace") return { items: [{ id: "item", productName: "Controller", sku: "60A", orderedQuantity: 2, unitCostMinor: 1500000, vatRateBasisPoints: null }] };
  if (input.command === "correct_cost") throw new Error("Response lost");
}); });
afterEach(() => cleanup());
it("locks approval while correction is open and preserves exact retry after reload", async () => {
  render(<Form />);
  await waitFor(() => expect((screen.getByText("Approve invoice") as HTMLButtonElement).disabled).toBe(false));
  const details = screen.getByText("Correct received cost before approval").closest("details")!;
  details.open = true; fireEvent(details, new Event("toggle"));
  await waitFor(() => expect((screen.getByText("Approve invoice") as HTMLButtonElement).disabled).toBe(true));
  fireEvent.change(screen.getByLabelText("Product"), { target: { value: "item" } });
  fireEvent.change(screen.getByLabelText("Correct unit cost (₦)"), { target: { value: "12000" } });
  fireEvent.change(screen.getByLabelText("Correction reason"), { target: { value: "Owner confirmed supplier cost" } });
  fireEvent.click(screen.getByText("Save audited cost correction"));
  await screen.findByText("Retry saved cost correction");
  const original = api.call.mock.calls.find(row => row[0] === "approveSupplierInvoice")![1];
  expect(original).toMatchObject({ command: "correct_cost", unitCostMinor: 1200000, expectedGrossAmountMinor: 3000000 });
  cleanup(); render(<Form />);
  await screen.findByText("Retry saved cost correction");
  expect((screen.getByText("Approve invoice") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByText("Retry saved cost correction"));
  await waitFor(() => expect(api.call.mock.calls.filter(row => row[0] === "approveSupplierInvoice")).toHaveLength(2));
  expect(api.call.mock.calls.filter(row => row[0] === "approveSupplierInvoice")[1]![1]).toEqual(original);
});
