// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { HeldReturnDisposition } from "@/features/returns/held-return-disposition";
const call = vi.hoisted(() => vi.fn());
vi.mock("@/features/administration/api", () => ({ callAdministration: call }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const record = { id: "case", returnId: "return", returnItemId: "item", quantity: 3, status: "completed" };
it("requires explicit resellable inspection and preserves the exact uncertain retry", async () => {
  call.mockRejectedValueOnce(new Error("Network interrupted")).mockResolvedValueOnce({ disposed: true });
  const complete = vi.fn();
  render(<HeldReturnDisposition record={record} suppliers={[]} canDispose canHandover={false} onComplete={complete} />);
  fireEvent.change(screen.getByLabelText("Inspection / disposition reason"), { target: { value: "Tested repaired unit safe for resale" } });
  const button = screen.getByRole("button", { name: "Record final destination" });
  expect(button).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(button);
  await screen.findByRole("button", { name: "Retry same disposition" });
  expect(screen.getByLabelText("Final destination")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Retry same disposition" }));
  await waitFor(() => expect(complete).toHaveBeenCalledOnce());
  expect(call.mock.calls[0]).toEqual(call.mock.calls[1]);
  expect(call.mock.calls[0]![1]).toMatchObject({ action: "dispose_held", disposition: { confirmedResellable: true, quantity: 1 } });
});
it("blocks excess quantities and requires supplier plus physical handover reference", () => {
  render(<HeldReturnDisposition record={record} suppliers={[{ id: "supplier", name: "Warranty supplier" }]} canDispose canHandover onComplete={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Final destination"), { target: { value: "supplier_handover" } });
  fireEvent.change(screen.getByLabelText("Inspection / disposition reason"), { target: { value: "Supplier accepted defective units" } });
  fireEvent.change(screen.getByLabelText("Supplier"), { target: { value: "supplier" } });
  const button = screen.getByRole("button", { name: "Record final destination" }); expect(button).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Physical handover reference"), { target: { value: "HANDOVER-1" } }); expect(button).toBeEnabled();
  fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "4" } }); expect(button).toBeDisabled();
});
it("shows held history to read-only users without offering a disposition mutation", () => {
  render(<HeldReturnDisposition record={{ ...record, heldDisposedQuantity: 3, recentDispositions: [{ transactionId: "txn", transactionNumber: "INV-1", quantity: 3, outcome: "scrap" }] }} suppliers={[]} canDispose={false} canHandover={false} onComplete={vi.fn()} />);
  expect(screen.getByText(/Held returned goods · 0 remaining/)).toBeInTheDocument();
  expect(screen.getByText(/INV-1 · 3 unit\(s\) · Scrapped/)).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
