// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IdleSessionBoundary } from "../src/features/auth/idle-session-boundary";
const key = "test-idle-session";
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1000000); localStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe("idle session boundary", () => {
  it("warns at nine minutes and removes protected content/signs out at ten", async () => {
    const expire = vi.fn().mockResolvedValue(undefined);
    render(<IdleSessionBoundary sessionKey={key} onExpire={expire}><div>Private sale</div></IdleSessionBoundary>);
    expect(screen.getByText("Private sale")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(540000); });
    expect(screen.getByRole("alert").textContent).toContain("60 seconds");
    await act(async () => { vi.advanceTimersByTime(60000); });
    expect(screen.queryByText("Private sale")).toBeNull(); expect(expire).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(60000); }); expect(expire).toHaveBeenCalledTimes(1);
  });
  it("does not let background synthetic events extend the deadline", async () => {
    const expire = vi.fn().mockResolvedValue(undefined);
    render(<IdleSessionBoundary sessionKey={key} onExpire={expire}>Private sale</IdleSessionBoundary>);
    act(() => { vi.advanceTimersByTime(540000); }); fireEvent.keyDown(window, { key: "a" });
    await act(async () => { vi.advanceTimersByTime(60000); }); expect(expire).toHaveBeenCalledOnce();
  });
  it("checks immediately on wake and does not expose expired stored content", async () => {
    localStorage.setItem(key, JSON.stringify({ lastActiveAt: Date.now() - 700000, expired: false }));
    const expire = vi.fn().mockResolvedValue(undefined);
    await act(async () => { render(<IdleSessionBoundary sessionKey={key} onExpire={expire}>Private sale</IdleSessionBoundary>); });
    expect(screen.queryByText("Private sale")).toBeNull(); expect(expire).toHaveBeenCalledOnce();
  });
  it("locks even when sign-out fails and allows retry", async () => {
    const expire = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    render(<IdleSessionBoundary sessionKey={key} onExpire={expire}>Private sale</IdleSessionBoundary>);
    await act(async () => { vi.advanceTimersByTime(600000); });
    expect(screen.queryByText("Private sale")).toBeNull();
    await act(async () => { fireEvent.click(screen.getByText("Retry sign out")); });
    expect(expire).toHaveBeenCalledTimes(2);
  });
  it("blocks the first click or submit after sleep before its transaction handler runs", async () => {
    const submit = vi.fn(); const click = vi.fn(); const expire = vi.fn().mockResolvedValue(undefined);
    render(<IdleSessionBoundary sessionKey={key} onExpire={expire}><form onSubmit={submit}><button onClick={click}>Save sale</button></form></IdleSessionBoundary>);
    vi.setSystemTime(Date.now() + 700000); // Sleeping tab: no timer callbacks have run.
    await act(async () => { fireEvent.click(screen.getByText("Save sale")); });
    expect(click).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled(); expect(expire).toHaveBeenCalledOnce();
  });
  it("shows retry after failed expiry under React StrictMode", async () => {
    localStorage.setItem(key, JSON.stringify({ lastActiveAt: Date.now() - 700000, expired: false }));
    await act(async () => { render(<React.StrictMode><IdleSessionBoundary sessionKey={key} onExpire={vi.fn().mockRejectedValue(new Error("offline"))}>Private sale</IdleSessionBoundary></React.StrictMode>); });
    expect(screen.getByText("Retry sign out")).toBeTruthy();
  });
  it("stay-signed-in renews before expiry, without changing the form", () => {
    render(<IdleSessionBoundary sessionKey={key} onExpire={vi.fn()}>Private sale</IdleSessionBoundary>);
    act(() => { vi.advanceTimersByTime(540000); }); fireEvent.click(screen.getByText("Stay signed in"));
    expect(screen.queryByRole("alert")).toBeNull(); expect(screen.getByText("Private sale")).toBeTruthy();
  });
});
