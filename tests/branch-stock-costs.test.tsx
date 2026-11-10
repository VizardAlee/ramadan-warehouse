// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aggregateBranchStockCosts, useBranchStockCosts, type StockCostPosition } from "@/features/products/use-branch-stock-costs";
const state = vi.hoisted(() => ({ allowed: true, context: null as { type: string; id: string } | null, version: 1, call: vi.fn() }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({ profile: { uid: "u", organizationId: "o", authorizationVersion: state.version }, operatingContext: state.context }) }));
vi.mock("@/lib/permissions/roles", () => ({ hasPermission: () => state.allowed }));
vi.mock("@/features/administration/api", () => ({ callAdministration: state.call }));
const row = (id: string, quantity: number, value: number | undefined, branchId = "a"): StockCostPosition => ({ id, productId: "p", branchId, onHandQuantity: quantity, totalValueMinor: value });
const page = (rows: StockCostPosition[], nextCursor: string | null = null, includeCosts = true) => ({ rows, nextCursor, includeCosts });
beforeEach(() => { state.allowed = true; state.context = null; state.version = 1; state.call.mockReset(); });
afterEach(cleanup);
describe("branch stock cost aggregation", () => {
  it("weights all location/lot values by on-hand including reserved goods, not average averages", () => {
    const costs = aggregateBranchStockCosts([row("1", 1, 100), row("2", 9, 1800), row("3", 2, 1000, "b"), row("4", 0, 0)]);
    expect(costs.a.p.unitCostMinor).toBe(190);
    expect(costs.b.p.unitCostMinor).toBe(500);
    expect(aggregateBranchStockCosts([row("1", 3, 100)]).a.p.unitCostMinor).toBe(100 / 3);
  });
  it("distinguishes no stock, zero valuation, missing and malformed values", () => {
    expect(aggregateBranchStockCosts([row("1", 0, 0)]).a.p).toMatchObject({ quantity: 0, invalid: false });
    expect(aggregateBranchStockCosts([row("1", 1, 0)]).a.p.unitCostMinor).toBe(0);
    for (const position of [row("1", 1, undefined), row("1", -1, 10), row("1", 0.5, 10), row("1", Infinity, 10), row("1", 0, 10), row("1", 1, -1), row("1", 1, NaN), row("1", Number.MAX_SAFE_INTEGER + 1, 10)]) {
      expect(aggregateBranchStockCosts([position]).a.p).toMatchObject({ invalid: true });
      expect(aggregateBranchStockCosts([position]).a.p.unitCostMinor).toBeUndefined();
    }
    expect(aggregateBranchStockCosts([row("1", 1, Number.MAX_SAFE_INTEGER), row("2", 1, 1)]).a.p.invalid).toBe(true);
  });
  it("rejects duplicate balance rows and excludes warehouse-only stock", () => {
    expect(() => aggregateBranchStockCosts([row("1", 1, 100), row("1", 1, 100)])).toThrow();
    expect(aggregateBranchStockCosts([{ ...row("1", 1, 100), branchId: undefined }])).toEqual({});
  });
});
describe("branch stock cost loading", () => {
  it("loads every positions page with cost authorization and never publishes partial totals", async () => {
    let finish!: (value: ReturnType<typeof page>) => void;
    state.call.mockResolvedValueOnce(page([row("1", 1, 100)], "1")).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { result } = renderHook(useBranchStockCosts);
    await waitFor(() => expect(state.call).toHaveBeenCalledTimes(2));
    expect(result.current.status).toBe("loading"); expect(result.current.costs).toEqual({});
    await act(async () => finish(page([row("2", 9, 1800)])));
    expect(result.current.costs.a.p.unitCostMinor).toBe(190);
    expect(state.call).toHaveBeenLastCalledWith("generateStockPositionReport", { cursor: "1", limit: 100, includeCosts: true, withSummary: false, view: "positions" });
  });
  it.each(["failure", "redacted", "loop"])("discards all partial totals on %s", async failure => {
    state.call.mockResolvedValueOnce(page([row("1", 1, 100)], "1"));
    if (failure === "failure") state.call.mockRejectedValueOnce(new Error("denied"));
    else state.call.mockResolvedValueOnce(page([row("2", 1, 200)], failure === "loop" ? "1" : null, failure !== "redacted"));
    const { result } = renderHook(useBranchStockCosts);
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.costs).toEqual({});
  });
  it("clears immediately on branch change, ignores late responses, and refreshes explicitly", async () => {
    let old!: (value: ReturnType<typeof page>) => void;
    state.call.mockImplementationOnce(() => new Promise(resolve => { old = resolve; })).mockResolvedValueOnce(page([row("2", 1, 200, "b")]));
    const { result, rerender } = renderHook(useBranchStockCosts);
    state.context = { type: "branch", id: "b" }; rerender();
    expect(result.current.costs).toEqual({});
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(async () => old(page([row("1", 1, 100)])));
    expect(result.current.costs.a).toBeUndefined();
    state.call.mockResolvedValueOnce(page([row("3", 1, 300, "b")]));
    act(() => result.current.refresh());
    expect(result.current.costs).toEqual({});
    await waitFor(() => expect(result.current.costs.b.p.unitCostMinor).toBe(300));
    expect(result.current.loadedAt).toBeTypeOf("number");
  });
  it("removes ready values on authority change and never fetches with revoked permissions or warehouse context", async () => {
    state.call.mockResolvedValue(page([row("1", 1, 100)]));
    const { result, rerender } = renderHook(useBranchStockCosts);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    state.allowed = false; rerender();
    expect(result.current.status).toBe("restricted"); expect(result.current.costs).toEqual({});
    expect(state.call).toHaveBeenCalledTimes(1);
    state.allowed = true; state.context = { type: "warehouse", id: "w" }; rerender();
    expect(result.current.status).toBe("choose-branch"); expect(state.call).toHaveBeenCalledTimes(1);
  });
});
