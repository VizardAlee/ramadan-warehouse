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
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "yAm" } });
    await screen.findByText("2 matching customers.");
    expect(state.call).toHaveBeenCalledWith("getPosWorkspace", { branchId: "store", customerSearch: { query: "yam", limit: 25, cursor: undefined } });
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("option", { name: /Maryam Buyer.*CUS-001/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Maryam Buyer.*CUS-002/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: /Maryam Buyer.*CUS-002/ }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(rows[1]);
  });
  it("keeps the selected customer while searching or clearing, including an empty scan with continuation", async () => {
    const onSelect = vi.fn(); state.call.mockResolvedValueOnce(page([], "next-page")).mockResolvedValueOnce(page([customer("999", "Later target")]));
    render(<PosCustomerSelector {...props} customerId="002" onSelect={onSelect} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "target" } });
    await screen.findByRole("button", { name: "Continue customer search" });
    expect(screen.queryByText(/No matching active customers/)).toBeNull();
    expect(screen.getByRole("button", { name: "Use walk-in customer" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue customer search" }));
    await screen.findByRole("option", { name: /Later target.*CUS-999/ });
    expect(state.call.mock.calls[1]?.[1].customerSearch.cursor).toBe("next-page");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } });
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Use walk-in customer" })).toBeTruthy();
  });
  it("announces loading, no match and retryable errors without selecting or submitting", async () => {
    const onSelect = vi.fn(); state.call.mockRejectedValueOnce(Error("offline")).mockResolvedValueOnce(page());
    render(<form onSubmit={event => { event.preventDefault(); throw Error("Search must not submit checkout"); }}><PosCustomerSelector {...props} customerId="002" onSelect={onSelect} /></form>);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "missing" } });
    expect(screen.getByRole("status").textContent).toContain("Searching customer names");
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Retry customer search" }));
    await screen.findByText(/No matching active customers/);
    expect(fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" })).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
  });
  it("uses cached substring matches offline without claiming full-directory completion", () => {
    render(<PosCustomerSelector {...props} online={false} onSelect={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "YAM" } });
    expect(screen.getAllByRole("option", { name: /Maryam Buyer/ })).toHaveLength(2);
    expect(screen.queryByRole("option", { name: /Omar/ })).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("cached customers only");
    expect(state.call).not.toHaveBeenCalled();
  });
  it("discards a late previous-query response and remounts cleanly on account/store scope changes", async () => {
    let finish!: (value: ReturnType<typeof page>) => void;
    state.call.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(page([customer("z", "Zainab")]));
    const view = render(<PosCustomerSelector {...props} onSelect={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "old" } });
    await waitFor(() => expect(state.call).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "zain" } });
    await screen.findByRole("option", { name: /Zainab/ });
    finish(page([customer("old", "Old response")]));
    await waitFor(() => expect(screen.queryByRole("option", { name: /Old response/ })).toBeNull());
    view.rerender(<PosCustomerSelector key="other-account" {...props} scopeKey="other:user:1" customers={[]} onSelect={vi.fn()} />);
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("option", { name: /Zainab/ })).toBeNull();
  });
});

describe("autocomplete interaction boundaries", () => {
  it("navigates suggestions without selecting until Enter, then focuses Change", () => {
    const onSelect = vi.fn();
    render(<PosCustomerSelector {...props} online={false} onSelect={onSelect} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(document.getElementById(input.getAttribute("aria-activedescendant")!)?.textContent).toContain("CUS-001");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(rows[1]);
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Change customer" }));
    fireEvent.click(screen.getByRole("button", { name: "Change customer" }));
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("aria-expanded")).toBe("true");
  });
  it("dismisses suggestions on Escape/outside focus without changing the customer or swallowing a second Escape", () => {
    const onSelect = vi.fn(), escape = vi.fn();
    render(<div onKeyDown={escape}><PosCustomerSelector {...props} customerId="002" online={false} onSelect={onSelect} /><button>Outside</button></div>);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input); fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.getAttribute("aria-activedescendant")).toBeNull();
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(escape).toHaveBeenCalledTimes(1); // ArrowUp only; first Escape stays in the picker.
    fireEvent.keyDown(input, { key: "Escape" });
    expect(escape).toHaveBeenCalledTimes(2);
    fireEvent.click(input); expect(input.getAttribute("aria-expanded")).toBe("true");
    fireEvent.focusIn(screen.getByRole("button", { name: "Outside" }));
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(onSelect).not.toHaveBeenCalled();
  });
  it("keeps the committed customer when clearing a query and only clears it with the explicit walk-in action", () => {
    const onSelect = vi.fn(); render(<PosCustomerSelector {...props} customerId="002" online={false} onSelect={onSelect} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "Mary" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear customer search" }));
    expect((input as HTMLInputElement).value).toBe(""); expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Use walk-in customer" }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(null);
  });
  it("does not commit an IME composition or allow searching/selection while busy", () => {
    const onSelect = vi.fn(); const view = render(<PosCustomerSelector {...props} online={false} onSelect={onSelect} />);
    const input = screen.getByRole("combobox"); fireEvent.focus(input); fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true }); expect(onSelect).not.toHaveBeenCalled();
    view.rerender(<PosCustomerSelector {...props} disabled onSelect={onSelect} />);
    expect((input as HTMLInputElement).disabled).toBe(true); expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("paused"); expect(state.call).not.toHaveBeenCalled();
  });
});
