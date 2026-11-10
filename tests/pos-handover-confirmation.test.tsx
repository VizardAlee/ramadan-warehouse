// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PosPage from "@/app/(protected)/pos/page";
import { usePosPaymentConfirmation } from "@/features/pos/use-pos-payment-confirmation";
const state = vi.hoisted(() => ({ call: vi.fn(), canRelease: true, online: true }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({ user: { uid: "user1" }, profile: { uid: "user1", organizationId: "org1", status: "active", roleId: "sales_cashier", roleIds: ["sales_cashier"], effectivePermissions: ["sales.order.create", "sales.payment.accept", "sales.payment.confirm", "sales.shift.manage", ...(state.canRelease ? ["sales.stock.release"] : [])], branchIds: ["branch1"], warehouseIds: [] }, accessProfile: { branchIds: ["branch1"] }, operatingContext: { type: "branch", id: "branch1" } }) }));
vi.mock("@/features/administration/api", () => ({ callAdministration: state.call }));
vi.mock("@/features/administration/use-organization-collection", () => ({ useOrganizationCollection: () => ({ data: [], loading: false }) }));
vi.mock("@/lib/connectivity", () => ({ useConnectivity: () => ({ online: state.online }) }));
vi.mock("@/features/pos/collection-queue", () => ({ CollectionQueue: ({ handover, canRelease }: { handover?: { saleId: string; choice: string }; canRelease: boolean }) => <div data-testid="handover-target">{handover ? `${handover.saleId}:${handover.choice}:${canRelease}` : "No selection"}</div> }));
vi.mock("@/features/pos/service-line-options", () => ({ ServiceLineOptions: () => null }));
vi.mock("@/components/ui/use-dialog-focus", () => ({ useDialogFocus: () => ({ current: null }) }));
vi.mock("@/features/pos/offline-store", () => ({ listQueuedSales: async () => [], listHeldSales: async () => [], saveCachedWorkspace: async () => {}, readCachedWorkspace: async () => null }));
const order = { id: "order1", orderNumber: "ORD-1", status: "payment_accepted", customerId: null, totalQuantity: 2, grossAmountMinor: 2000, paymentMethods: ["cash"] };
const workspace = { branch: { id: "branch1", name: "Test branch", code: "TEST" }, location: { id: "loc1", name: "Stock" }, products: [], customers: [], bankAccounts: [], salesCredits: [], pendingOrders: [order], openShift: { id: "shift1", deviceId: "device1", status: "open" }, refreshedAt: new Date().toISOString() };
beforeEach(() => { state.canRelease = true; state.online = true; sessionStorage.clear(); localStorage.clear(); HTMLElement.prototype.scrollIntoView = vi.fn(); state.call.mockImplementation(async name => name === "getPosWorkspace" ? workspace : { saleId: "sale1", orderNumber: "ORD-1", receiptNumber: "RCT-1" }); });
afterEach(() => { cleanup(); sessionStorage.clear(); vi.clearAllMocks(); });
describe("payment to physical handover", () => {
  it.each([["Confirm payment · hand over now", "now"], ["Confirm payment · collect later", "later"]])("makes %s explicit and opens that exact invoice without posting a physical release", async (label, choice) => {
    render(<PosPage />);
    const action = await screen.findByRole("button", { name: label });
    await waitFor(() => expect(action.hasAttribute("disabled")).toBe(false));
    fireEvent.click(action);
    await waitFor(() => expect(screen.getByTestId("handover-target").textContent).toBe(`sale1:${choice}:true`));
    const posts = state.call.mock.calls.filter(([name]) => name === "confirmPosSaleOrder");
    expect(posts).toHaveLength(1);
    expect(posts[0]![1]).toEqual({ orderId: "order1", deferCollection: true, idempotencyKey: expect.any(String) });
    expect(state.call.mock.calls.some(([, payload]) => payload.action === "collect")).toBe(false);
    expect(screen.queryByText("Issue receipt · await store handover")).toBeNull();
  });

  it("labels the primary action as a store handoff when payment staff cannot release stock", async () => {
    state.canRelease = false; render(<PosPage />);
    const action = await screen.findByRole("button", { name: "Confirm payment · send to store handover" });
    await waitFor(() => expect(action.hasAttribute("disabled")).toBe(false));
    fireEvent.click(action);
    await waitFor(() => expect(screen.getByTestId("handover-target").textContent).toBe("sale1:now:false"));
    expect(screen.getByText(/Send the customer and receipt to authorized store staff/)).toBeTruthy();
  });

  it("recovers the same confirmation and handover choice after reload even if the order is no longer pending", async () => {
    state.call.mockImplementation(async name => { if (name === "confirmPosSaleOrder") throw new Error("Connection interrupted"); return workspace; });
    const first = render(<PosPage />);
    const button = await screen.findByRole("button", { name: "Confirm payment · hand over now" });
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false)); fireEvent.click(button);
    await screen.findByRole("button", { name: "Retry same payment confirmation" });
    const original = state.call.mock.calls.find(([name]) => name === "confirmPosSaleOrder")![1];
    first.unmount();
    state.call.mockImplementation(async name => name === "getPosWorkspace" ? { ...workspace, pendingOrders: [] } : { saleId: "sale1", orderNumber: "ORD-1", receiptNumber: "RCT-1" });
    render(<PosPage />);
    const retry = await screen.findByRole("button", { name: "Retry same payment confirmation" });
    await waitFor(() => expect(retry.hasAttribute("disabled")).toBe(false)); fireEvent.click(retry);
    await waitFor(() => expect(screen.getByTestId("handover-target").textContent).toBe("sale1:now:true"));
    expect(state.call.mock.calls.filter(([name]) => name === "confirmPosSaleOrder")[1]![1]).toEqual(original);
    expect(screen.queryByRole("button", { name: "Retry same payment confirmation" })).toBeNull();
  });

  it("does not consume another company, staff or branch's pending confirmation", async () => {
    sessionStorage.setItem("abr-pos-payment-confirmation:other-scope", JSON.stringify({ orderId: "foreign", choice: "now", idempotencyKey: crypto.randomUUID() }));
    const hook = renderHook(() => usePosPaymentConfirmation("current-scope"));
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    expect(hook.result.current.pending).toBeNull();
    await act(async () => { await hook.result.current.run("order1", "later"); });
    expect(sessionStorage.getItem("abr-pos-payment-confirmation:other-scope")).not.toBeNull();
  });
});

describe("confirmation navigation recovery", () => {
  it("keeps the new branch's saved confirmation when an old branch response finishes late", async () => {
    let finish!: (value: { saleId: string; orderNumber: string; receiptNumber: string }) => void;
    state.call.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const next = { orderId: "order-next", choice: "later", idempotencyKey: crypto.randomUUID() };
    sessionStorage.setItem("abr-pos-payment-confirmation:branch-next", JSON.stringify(next));
    const view = renderHook(({ scope }) => usePosPaymentConfirmation(scope), { initialProps: { scope: "branch-first" } });
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    let request!: ReturnType<typeof view.result.current.run>;
    act(() => { request = view.result.current.run("order-first", "now"); });
    view.rerender({ scope: "branch-next" });
    await waitFor(() => expect(view.result.current.pending?.orderId).toBe("order-next"));
    await act(async () => { finish({ saleId: "sale-first", orderNumber: "ORD-FIRST", receiptNumber: "RCT-FIRST" }); await request; });
    expect(view.result.current.pending).toEqual(next);
    expect(sessionStorage.getItem("abr-pos-payment-confirmation:branch-next")).toBe(JSON.stringify(next));
  });

  it("blocks confirmation when a saved recovery reference is malformed rather than discarding it", async () => {
    sessionStorage.setItem("abr-pos-payment-confirmation:broken", "not-json");
    const view = renderHook(() => usePosPaymentConfirmation("broken"));
    await waitFor(() => expect(view.result.current.error).toContain("could not be read"));
    expect(view.result.current.ready).toBe(false);
    await expect(view.result.current.run("order1", "now")).rejects.toThrow("pending payment confirmation check");
    expect(state.call).not.toHaveBeenCalled();
  });
});
