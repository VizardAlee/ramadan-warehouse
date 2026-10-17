// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePurchaseReceipt, type PurchaseReceiptInput } from "@/features/procurement/use-purchase-receipt";
const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/features/administration/api", () => ({ callAdministration: api.call }));
const payload = (): PurchaseReceiptInput => ({ purchaseOrderId: "po", purchaseOrderItemId: "item", quantity: 2,
  receivedAt: new Date().toISOString(), serialNumbers: [], supplierReference: "Actual delivery", idempotencyKey: crypto.randomUUID() });
function Form() {
  const receipt = usePurchaseReceipt("org:receiver");
  return <><button disabled={!receipt.ready || Boolean(receipt.pending)} onClick={() => void receipt.run(payload()).catch(() => {})}>Receive</button>
    {receipt.pending && <button onClick={() => void receipt.run().catch(() => {})}>Retry original</button>}
    {receipt.error && <p role="alert">{receipt.error}</p>}</>;
}
beforeEach(() => { sessionStorage.clear(); vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("purchase receipt browser recovery", () => {
  it("persists before sending and retries the exact request after a lost response and reload", async () => {
    api.call.mockImplementationOnce(async () => {
      expect(sessionStorage.getItem("abr-pending-purchase-receipt:org:receiver")).not.toBeNull();
      throw new Error("Response lost after commit");
    }).mockResolvedValue({ receiptId: "original", posted: false });
    render(<Form />); await waitFor(() => expect((screen.getByText("Receive") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText("Receive")); await screen.findByText("Retry original");
    const original = api.call.mock.calls[0]![1]; cleanup(); render(<Form />);
    const retry = await screen.findByText("Retry original");
    expect((screen.getByText("Receive") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(retry);
    await waitFor(() => expect(api.call).toHaveBeenCalledTimes(2));
    expect(api.call.mock.calls[1]![1]).toEqual(JSON.parse(JSON.stringify(original)));
    await waitFor(() => expect(sessionStorage.getItem("abr-pending-purchase-receipt:org:receiver")).toBeNull());
  });
  it("does not send when the exact request cannot be saved", async () => {
    render(<Form />); await waitFor(() => expect((screen.getByText("Receive") as HTMLButtonElement).disabled).toBe(false));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage blocked"); });
    fireEvent.click(screen.getByText("Receive")); await new Promise(resolve => setTimeout(resolve, 0));
    expect(api.call).not.toHaveBeenCalled();
  });
  it("fails closed on corrupt saved instructions", async () => {
    sessionStorage.setItem("abr-pending-purchase-receipt:org:receiver", "{broken"); render(<Form />);
    await screen.findByRole("alert"); expect((screen.getByText("Receive") as HTMLButtonElement).disabled).toBe(true);
  });
  it("retains an uncertain saved instruction when a retry encounters changed authority", async () => {
    const original = payload(); sessionStorage.setItem("abr-pending-purchase-receipt:org:receiver", JSON.stringify(original));
    api.call.mockRejectedValue({ diagnosticCode: "functions/permission-denied" }); render(<Form />);
    fireEvent.click(await screen.findByText("Retry original"));
    await waitFor(() => expect(api.call).toHaveBeenCalledOnce());
    expect(JSON.parse(sessionStorage.getItem("abr-pending-purchase-receipt:org:receiver")!)).toEqual(original);
  });
});
