// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { HeldSupplierReplacement } from "@/features/returns/held-supplier-replacement";
const call = vi.hoisted(() => vi.fn());
vi.mock("@/features/administration/api", () => ({ callAdministration: call }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("requires inspected replacement evidence and retries an uncertain receipt without changing its payload", async () => {
  call.mockRejectedValueOnce(new Error("Network interrupted")).mockResolvedValueOnce({ received: true });
  const complete = vi.fn();
  render(<HeldSupplierReplacement returnId="return" handoverId="handover" remaining={1} serialized onComplete={complete} />);
  fireEvent.change(screen.getByLabelText("Supplier replacement reference"), { target: { value: "SUP-REP-1" } });
  fireEvent.change(screen.getByLabelText("Replacement inspection notes"), { target: { value: "New replacement inspected safe for resale" } });
  fireEvent.change(screen.getByLabelText(/Replacement serial number/), { target: { value: "NEW-1" } });
  const confirm = screen.getByRole("button", { name: "Confirm replacement receipt" });
  expect(confirm).toBeDisabled(); fireEvent.click(screen.getByRole("checkbox")); expect(confirm).toBeEnabled(); fireEvent.click(confirm);
  await screen.findByRole("button", { name: "Retry same replacement receipt" });
  expect(screen.getByLabelText("Supplier replacement reference")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Retry same replacement receipt" }));
  await waitFor(() => expect(complete).toHaveBeenCalledOnce());
  expect(call.mock.calls[0]).toEqual(call.mock.calls[1]);
  expect(call.mock.calls[0]![1]).toMatchObject({ action: "receive_supplier_replacement", replacement: { serialNumber: "NEW-1", quantity: 1, confirmedResellable: true } });
});
it("blocks quantities above the unsettled handover", () => {
  render(<HeldSupplierReplacement returnId="return" handoverId="handover" remaining={2} serialized={false} onComplete={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Supplier replacement reference"), { target: { value: "SUP-REP-2" } });
  fireEvent.change(screen.getByLabelText("Replacement inspection notes"), { target: { value: "Inspected safe for resale" } });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.change(screen.getByLabelText("Replacement quantity"), { target: { value: "3" } });
  expect(screen.getByRole("button", { name: "Confirm replacement receipt" })).toBeDisabled();
});
