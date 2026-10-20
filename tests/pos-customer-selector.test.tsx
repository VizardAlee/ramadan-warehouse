// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PosCustomerSelector } from "@/features/pos/customer-selector";
import type { PosCustomer } from "@/features/pos/types";
const state = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/features/administration/api", () => ({ callAdministration: state.call }));
const customer = (id: string, name = "Maryam Buyer"): PosCustomer => ({ id, name, customerNumber: `CUS-${id}`, phone: null, creditStatus: "pending", creditLimitMinor: 0, outstandingBalanceMinor: 0, availableCreditMinor: 0 });
const rows = [customer("001"), customer("002"), customer("003", "Omar Buyer")];
const page = (customers: PosCustomer[] = [], nextCursor: string | null = null) => ({ customers, nextCursor, scanned: 1000, scanLimited: Boolean(nextCursor), complete: !nextCursor });
const props = { customers: rows, customerId: "", branchId: "store", scopeKey: "org:user:1", online: true };
beforeEach(() => { state.call.mockReset(); state.call.mockResolvedValue(page()); });
afterEach(cleanup);
describe("POS customer-name selector", () => {
  it("finds middle-name fragments and selects duplicate names by customer ID, never by name", async () => {
    const onSelect = vi.fn(); state.call.mockResolvedValue(page(rows.slice(0, 2)));
    render(<PosCustomerSelector {...props} onSelect={onSelect} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "yAm" } });
    await screen.findByText("2 matching customers.");
    expect(state.call).toHaveBeenCalledWith("getPosWorkspace", { branchId: "store", customerSearch: { query: "yam", limit: 25, cursor: undefined } });
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("option", { name: /Maryam Buyer.*CUS-001/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Maryam Buyer.*CUS-002/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Customer", { exact: true }), { target: { value: "002" } });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(rows[1]);
  });
  it("keeps the selected customer while searching or clearing, including an empty scan with continuation", async () => {
    const onSelect = vi.fn(); state.call.mockResolvedValueOnce(page([], "next-page")).mockResolvedValueOnce(page([customer("999", "Later target")]));
    render(<PosCustomerSelector {...props} customerId="002" onSelect={onSelect} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "target" } });
    await screen.findByRole("button", { name: "Continue customer search" });
    expect(screen.queryByText(/No matching active customers/)).toBeNull();
    expect((screen.getByLabelText("Customer", { exact: true }) as HTMLSelectElement).value).toBe("002");
    fireEvent.click(screen.getByRole("button", { name: "Continue customer search" }));
    await screen.findByRole("option", { name: /Later target.*CUS-999/ });
    expect(state.call.mock.calls[1]?.[1].customerSearch.cursor).toBe("next-page");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    expect(onSelect).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Customer", { exact: true }) as HTMLSelectElement).value).toBe("002");
  });
  it("announces loading, no match and retryable errors without selecting or submitting", async () => {
    const onSelect = vi.fn(); state.call.mockRejectedValueOnce(Error("offline")).mockResolvedValueOnce(page());
    render(<form onSubmit={event => { event.preventDefault(); throw Error("Search must not submit checkout"); }}><PosCustomerSelector {...props} customerId="002" onSelect={onSelect} /></form>);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "missing" } });
    expect(screen.getByRole("status").textContent).toContain("Searching customer names");
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Retry customer search" }));
    await screen.findByText(/No matching active customers/);
    expect(fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" })).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
  });
  it("uses cached substring matches offline without claiming full-directory completion", () => {
    render(<PosCustomerSelector {...props} online={false} onSelect={vi.fn()} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "YAM" } });
    expect(screen.getAllByRole("option", { name: /Maryam Buyer/ })).toHaveLength(2);
    expect(screen.queryByRole("option", { name: /Omar/ })).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("cached customers only");
    expect(state.call).not.toHaveBeenCalled();
  });
  it("discards a late previous-query response and remounts cleanly on account/store scope changes", async () => {
    let finish!: (value: ReturnType<typeof page>) => void;
    state.call.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(page([customer("z", "Zainab")]));
    const view = render(<PosCustomerSelector {...props} onSelect={vi.fn()} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "old" } });
    await waitFor(() => expect(state.call).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zain" } });
    await screen.findByRole("option", { name: /Zainab/ });
    finish(page([customer("old", "Old response")]));
    await waitFor(() => expect(screen.queryByRole("option", { name: /Old response/ })).toBeNull());
    view.rerender(<PosCustomerSelector key="other-account" {...props} scopeKey="other:user:1" customers={[]} onSelect={vi.fn()} />);
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("option", { name: /Zainab/ })).toBeNull();
  });
});
