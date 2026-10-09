// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { HeldSupplierCredit } from "@/features/returns/held-supplier-credit";
const call = vi.hoisted(() => vi.fn());
vi.mock("@/features/administration/api", () => ({ callAdministration: call }));
vi.mock("@/features/procurement/supplier-returns", () => ({ SupplierReturns: ({ heldHandover, onComplete }: { heldHandover: { remaining: number; serialNumber: string }; onComplete: () => void }) => <button onClick={onComplete}>Credit {heldHandover.remaining} · {heldHandover.serialNumber}</button> }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("loads live settlement lazily, browses original invoices and refreshes after credit", async () => {
  call.mockResolvedValueOnce({ handover: { quantity: 3, settledQuantity: 1 }, invoices: [{ id: "first", invoiceNumber: "INV-1" }], nextCursor: "first" })
    .mockResolvedValueOnce({ handover: { quantity: 3, settledQuantity: 1 }, invoices: [{ id: "second", invoiceNumber: "INV-2" }], nextCursor: null })
    .mockResolvedValueOnce({ handover: { quantity: 3, settledQuantity: 3 }, invoices: [], nextCursor: null });
  render(<HeldSupplierCredit handoverId="handover" productId="product" serialNumber="SERIAL-1" canPost />);
  expect(call).not.toHaveBeenCalled();
  const details = screen.getByText("Supplier settlement · credits & replacements").closest("details")!;
  details.open = true; fireEvent(details, new Event("toggle"));
  await screen.findByText(/1 credited · 0 replaced · 2 awaiting settlement/);
  fireEvent.click(screen.getByRole("button", { name: "Next invoices" }));
  await screen.findByRole("option", { name: "INV-2" });
  expect(call.mock.calls[1]![1]).toMatchObject({ cursor: "first", limit: 25, heldHandoverId: "handover" });
  fireEvent.change(screen.getByLabelText("Original supplier invoice"), { target: { value: "second" } });
  fireEvent.click(screen.getByRole("button", { name: "Record accepted credit note" }));
  fireEvent.click(screen.getByRole("button", { name: "Credit 2 · SERIAL-1" }));
  await screen.findByText(/3 credited · 0 replaced · 0 awaiting settlement/);
  expect(screen.queryByRole("button", { name: "Record accepted credit note" })).not.toBeInTheDocument();
});
it("read-only users see actual counters without settlement controls", async () => {
  call.mockResolvedValue({ handover: { quantity: 2, settledQuantity: 1 }, invoices: [], nextCursor: null });
  render(<HeldSupplierCredit handoverId="handover" productId="product" canPost={false} />);
  const details = screen.getByText("Supplier settlement · credits & replacements").closest("details")!;
  details.open = true; fireEvent(details, new Event("toggle"));
  await waitFor(() => expect(screen.getByText(/1 credited · 0 replaced · 1 awaiting settlement/)).toBeInTheDocument());
  expect(screen.queryByLabelText("Original supplier invoice")).not.toBeInTheDocument();
});
