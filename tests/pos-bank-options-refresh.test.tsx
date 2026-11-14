// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { retainAvailableBank, useBankOptionsRefresh } from "@/features/pos/use-bank-options-refresh";
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("clears removed or out-of-scope selections without choosing another account", () => {
  expect(retainAvailableBank("old", [{ id: "new" }])).toBe("");
  expect(retainAvailableBank("new", [{ id: "new" }])).toBe("new");
  expect(retainAvailableBank("", [])).toBe("");
});
it("refreshes on a visible timer, throttles focus, and stops offline", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValue([{ id: "active" }]); const apply = vi.fn();
  const view = renderHook(({ enabled }) => useBankOptionsRefresh(enabled, fetch, apply), { initialProps: { enabled: true } });
  await act(async () => {});
  expect(apply).toHaveBeenCalledOnce();
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  expect(fetch).toHaveBeenCalledOnce();
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(fetch).toHaveBeenCalledTimes(2);
  view.rerender({ enabled: false });
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); window.dispatchEvent(new Event("focus")); });
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("ignores old-scope responses and does not clear accounts on failure", async () => {
  let resolve!: (value: string[]) => void;
  const fetch = vi.fn(() => new Promise<string[]>(done => { resolve = done; })); const apply = vi.fn();
  const view = renderHook(() => useBankOptionsRefresh(true, fetch, apply));
  view.unmount();
  await act(async () => { resolve(["stale"]); });
  expect(apply).not.toHaveBeenCalled();
  const failed = vi.fn().mockRejectedValue(new Error("offline"));
  renderHook(() => useBankOptionsRefresh(true, failed, apply));
  await act(async () => {});
  expect(apply).not.toHaveBeenCalled();
});
it("does not poll hidden screens, resumes when visible, and coalesces requests", async () => {
  vi.useFakeTimers();
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  const fetch = vi.fn(() => new Promise<string[]>(() => {})); const apply = vi.fn();
  renderHook(() => useBankOptionsRefresh(true, fetch, apply));
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(fetch).not.toHaveBeenCalled();
  visibility.mockReturnValue("visible");
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await vi.advanceTimersByTimeAsync(60000); });
  expect(fetch).toHaveBeenCalledOnce();
  visibility.mockRestore();
});
