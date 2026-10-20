// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FastMovingControls, usePosFastMoving, type PosFastMoving } from "@/features/pos/fast-moving";
const call = vi.hoisted(() => vi.fn());
vi.mock("@/features/administration/api", () => ({ callAdministration: call }));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });
const result: PosFastMoving = { version: 1, branchId: "store", status: "ready", productIds: ["a"], asOf: new Date().toISOString(), expiresAt: new Date(Date.now() + 900000).toISOString() };
function Harness({ scope = "one", branch = "store", online = true }: { scope?: string; branch?: string; online?: boolean }) { const value = usePosFastMoving(scope, branch, online, "refreshed"); return <output>{JSON.stringify(value)}</output>; }
describe("POS safe fast-moving states", () => {
  it("has touch/keyboard native filters and explains the actual rule", () => {
    const select = vi.fn(); render(<FastMovingControls result={result} online selected={false} onSelect={select} />);
    fireEvent.click(screen.getByRole("button", { name: "Fast-moving", exact: true })); expect(select).toHaveBeenCalledWith(true);
    expect(screen.getByText(/at least 5 separate receipts/)).toBeTruthy();
  });
  it.each(["insufficient_history", "unavailable", "refreshing"] as const)("explains %s without pretending products have qualified", status => {
    render(<FastMovingControls result={{ ...result, status, productIds: [] }} online selected onSelect={vi.fn()} />);
    expect(screen.queryByText(/Frequently bought at this branch/)).toBeNull(); expect(screen.getByRole("status").textContent).toBeTruthy();
  });
  it("suppresses cached badges offline and describes the limitation", () => {
    render(<FastMovingControls result={result} online={false} selected onSelect={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toContain("need a connection");
  });
  it("rejects an expired server response instead of showing stale labels", async () => {
    call.mockResolvedValue({ ...result, expiresAt: new Date(Date.now() - 1000).toISOString() });
    render(<Harness />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain('"unavailable"'));
    expect(screen.getByRole("status").textContent).toContain('"productIds":[]');
  });
  it("clears saved suggestions offline before reconnecting after their expiry", async () => {
    vi.useFakeTimers(); const started = Date.now();
    call.mockResolvedValue({ ...result, expiresAt: new Date(started + 900000).toISOString() });
    const view = render(<Harness />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByRole("status").textContent).toContain('"a"');
    view.rerender(<Harness online={false} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    vi.setSystemTime(started + 900001);
    view.rerender(<Harness />);
    expect(screen.getByRole("status").textContent).toBe("null");
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByRole("status").textContent).toContain('"unavailable"');
    expect(screen.getByRole("status").textContent).toContain('"productIds":[]');
  });
  it("ignores an old branch response after a scope switch", async () => {
    let resolve!: (value: PosFastMoving) => void;
    call.mockImplementationOnce(() => new Promise<PosFastMoving>(r => { resolve = r; })).mockResolvedValue({ ...result, branchId: "second", productIds: ["b"] });
    const view = render(<Harness />); await waitFor(() => expect(call).toHaveBeenCalledOnce());
    view.rerender(<Harness scope="two" branch="second" />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain('"b"'));
    resolve(result); await Promise.resolve();
    expect(screen.getByRole("status").textContent).not.toContain('"a"');
    view.rerender(<Harness scope="two" branch="second" online={false} />);
    expect(screen.getByRole("status").textContent).toBe("null");
  });
});
