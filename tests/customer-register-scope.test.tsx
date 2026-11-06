// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useCustomerRegister } from "@/features/customers/use-customer-register";
const state = vi.hoisted(() => ({ branch: "a", account: "user-a", call: vi.fn() }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({ profile: { uid: state.account, organizationId: "org", authorizationVersion: 1, branchIds: ["a", "b"], effectivePermissions: ["customers.read"] }, operatingContext: { type: "branch", id: state.branch } }) }));
vi.mock("@/features/administration/api", () => ({ callAdministration: state.call }));
afterEach(() => { cleanup(); state.call.mockReset(); state.branch = "a"; state.account = "user-a"; });
it("clears prior branch customers immediately and discards an old branch response after switching", async () => {
  let oldResolve!: (page: unknown) => void;
  state.call.mockResolvedValueOnce({ rows: [{ id: "a-first" }], nextCursor: "a-next" });
  state.call.mockImplementationOnce(() => new Promise(resolve => { oldResolve = resolve; }));
  state.call.mockResolvedValueOnce({ rows: [{ id: "b-only" }], nextCursor: null });
  const { result, rerender } = renderHook(useCustomerRegister);
  await waitFor(() => expect(result.current.data.map(row => row.id)).toEqual(["a-first"]));
  act(() => result.current.nextPage());
  await waitFor(() => expect(state.call).toHaveBeenCalledTimes(2));
  state.branch = "b";
  rerender();
  expect(result.current.data).toEqual([]);
  expect(result.current.page).toBe(1);
  await waitFor(() => expect(result.current.data.map(row => row.id)).toEqual(["b-only"]));
  await act(async () => oldResolve({ rows: [{ id: "a-stale" }], nextCursor: null }));
  expect(result.current.data.map(row => row.id)).toEqual(["b-only"]);
  expect(state.call.mock.calls[2]?.[1]).not.toHaveProperty("cursor", "a-next");
});
it("clears customer rows when the signed-in account changes even within the same branch", async () => {
  state.call.mockResolvedValueOnce({ rows: [{ id: "previous-account" }], nextCursor: null });
  state.call.mockImplementationOnce(() => new Promise(() => {}));
  const { result, rerender } = renderHook(useCustomerRegister);
  await waitFor(() => expect(result.current.data).toHaveLength(1));
  state.account = "user-b";
  rerender();
  expect(result.current.data).toEqual([]);
  expect(result.current.loading).toBe(true);
});
