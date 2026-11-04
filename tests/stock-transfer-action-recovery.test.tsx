// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStockTransferAction } from "@/features/transfers/use-stock-transfer-action";
const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/features/administration/api", () => ({ callAdministration: api.call }));
const storageKey = "abr-pending-stock-transfer:org:user:transfer";
const payload = () => ({ action: "receive", transferId: "transfer", version: 1,
  lines: [{id: "line", received: 2, damaged: 0}], idempotencyKey: crypto.randomUUID() });
function Form({ scope = "branch:destination" }: {scope?: string}) {
  const action = useStockTransferAction("org:user:transfer", scope);
  return <><button disabled={!action.ready || Boolean(action.pending) || action.busy} onClick={() => void action.run(payload()).catch(() => {})}>Receive</button>
    {action.pending && <button disabled={action.busy || action.scopeChanged} onClick={() => void action.run().catch(() => {})}>Retry saved action</button>}
    {action.scopeChanged && <p>Return to original location</p>}
    {action.error && <p role="alert">{action.error}</p>}</>;
}
beforeEach(() => { sessionStorage.clear(); vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("stock transfer financial-action recovery", () => {
  it("saves before sending and retries the identical instruction after reload", async () => {
    api.call.mockImplementationOnce(async () => {
      expect(sessionStorage.getItem(storageKey)).not.toBeNull();
      throw new Error("Lost response after commit");
    }).mockResolvedValue({ repeated: true });
    render(<Form />);
    await waitFor(() => expect((screen.getByText("Receive") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText("Receive"));
    await screen.findByText("Retry saved action");
    const original = api.call.mock.calls[0]![1];
    cleanup(); render(<Form />);
    fireEvent.click(await screen.findByText("Retry saved action"));
    await waitFor(() => expect(api.call).toHaveBeenCalledTimes(2));
    expect(api.call.mock.calls[1]![1]).toEqual(original);
    await waitFor(() => expect(sessionStorage.getItem(storageKey)).toBeNull());
  });
  it("does not send if browser storage cannot preserve the action", async () => {
    render(<Form />);
    await waitFor(() => expect((screen.getByText("Receive") as HTMLButtonElement).disabled).toBe(false));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Blocked storage"); });
    fireEvent.click(screen.getByText("Receive"));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(api.call).not.toHaveBeenCalled();
  });
  it("locks corrupt saved data rather than creating a new retry identity", async () => {
    sessionStorage.setItem(storageKey, "{broken"); render(<Form />);
    await screen.findByRole("alert");
    expect((screen.getByText("Receive") as HTMLButtonElement).disabled).toBe(true);
    expect(api.call).not.toHaveBeenCalled();
  });
  it("requires the original location and retains uncertain requests after changed authority", async () => {
    const original = {scope: "branch:destination", input: payload()};
    sessionStorage.setItem(storageKey, JSON.stringify(original));
    api.call.mockRejectedValue({ code: "functions/permission-denied" });
    const view = render(<Form scope="branch:other" />);
    expect((await screen.findByText("Retry saved action") as HTMLButtonElement).disabled).toBe(true);
    expect(api.call).not.toHaveBeenCalled();
    view.rerender(<Form />);
    fireEvent.click(screen.getByText("Retry saved action"));
    await waitFor(() => expect(api.call).toHaveBeenCalledOnce());
    expect(JSON.parse(sessionStorage.getItem(storageKey)!)).toEqual(original);
  });
  it("unlocks a lost-before-send action only after the server proves it cannot commit", async () => {
    api.call.mockRejectedValueOnce(new Error("Connection lost before send"))
      .mockRejectedValueOnce({diagnosticCode: "SAVED_ACTION_NOT_COMMITTED"});
    render(<Form />);
    await waitFor(() => expect((screen.getByText("Receive") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText("Receive"));
    const retry = await screen.findByText("Retry saved action");
    const original = api.call.mock.calls[0]![1];
    await waitFor(() => expect((retry as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(retry);
    await waitFor(() => expect(api.call).toHaveBeenCalledTimes(2));
    expect(api.call.mock.calls[1]![1]).toEqual(original);
    await waitFor(() => expect(sessionStorage.getItem(storageKey)).toBeNull());
    expect((screen.getByText("Receive") as HTMLButtonElement).disabled).toBe(false);
  });
  it("does not clear a saved instruction for an ordinary stale or unavailable response", async () => {
    const original = {scope: "branch:destination", input: payload()};
    sessionStorage.setItem(storageKey, JSON.stringify(original));
    api.call.mockRejectedValue({code: "functions/failed-precondition"});
    render(<Form />);
    fireEvent.click(await screen.findByText("Retry saved action"));
    await waitFor(() => expect(api.call).toHaveBeenCalledOnce());
    expect(JSON.parse(sessionStorage.getItem(storageKey)!)).toEqual(original);
    expect((screen.getByText("Receive") as HTMLButtonElement).disabled).toBe(true);
  });
  it("allows correcting a definitively rejected new action", async () => {
    api.call.mockRejectedValue({code: "functions/invalid-argument"}); render(<Form />);
    await waitFor(() => expect((screen.getByText("Receive") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText("Receive"));
    await waitFor(() => expect(api.call).toHaveBeenCalledOnce());
    await waitFor(() => expect(sessionStorage.getItem(storageKey)).toBeNull());
  });
});
