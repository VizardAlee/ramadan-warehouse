import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callable: vi.fn(),
  getIdToken: vi.fn(),
  httpsCallable: vi.fn(),
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: mocks.httpsCallable,
}));

vi.mock("@/lib/firebase/client", () => ({
  getFirebaseServices: () => ({
    auth: { currentUser: { getIdToken: mocks.getIdToken } },
    functions: {},
  }),
}));

import { callAdministration } from "@/features/administration/api";

describe("callAdministration", () => {
  it("allows longer ledger reports and resumable counts without extending ordinary mutation timeouts", async () => {
    mocks.callable.mockResolvedValue({ data: {} });
    await callAdministration("generateFinancialStatement", {});
    await callAdministration("getTaxWorkspace", {});
    await callAdministration("createSaleReturn", {});
    await callAdministration("postStockCount", {});
    await callAdministration("startStockCount", {});
    expect(mocks.httpsCallable).toHaveBeenNthCalledWith(1, {}, "generateFinancialStatement", { timeout: 300_000 });
    expect(mocks.httpsCallable).toHaveBeenNthCalledWith(2, {}, "getTaxWorkspace", { timeout: 300_000 });
    expect(mocks.httpsCallable).toHaveBeenNthCalledWith(3, {}, "createSaleReturn", { timeout: 70_000 });
    expect(mocks.httpsCallable).toHaveBeenNthCalledWith(4, {}, "postStockCount", { timeout: 300_000 });
    expect(mocks.httpsCallable).toHaveBeenNthCalledWith(5, {}, "startStockCount", { timeout: 180_000 });
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.httpsCallable.mockReturnValue(mocks.callable);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("refreshes a stale authorization token once and retries the callable", async () => {
    mocks.callable
      .mockRejectedValueOnce({
        code: "functions/permission-denied",
        details: { code: "OUTDATED_VERSION", retryable: true },
      })
      .mockResolvedValueOnce({ data: { rows: [] } });

    await expect(
      callAdministration("generateStockPositionReport", {
        limit: 50,
        omitted: undefined,
      }),
    ).resolves.toEqual({ rows: [] });
    expect(mocks.getIdToken).toHaveBeenCalledWith(true);
    expect(mocks.callable).toHaveBeenCalledTimes(2);
    expect(mocks.callable).toHaveBeenNthCalledWith(1, { limit: 50 });
    expect(mocks.callable).toHaveBeenNthCalledWith(2, { limit: 50 });
  });

  it("does not retry ordinary permission failures", async () => {
    mocks.callable.mockRejectedValueOnce({
      code: "functions/permission-denied",
    });

    await expect(
      callAdministration("generateStockPositionReport", { limit: 50 }),
    ).rejects.toMatchObject({
      message: "You do not have permission to perform this action.",
      diagnosticCode: "functions/permission-denied",
    });
    expect(mocks.getIdToken).not.toHaveBeenCalled();
    expect(mocks.callable).toHaveBeenCalledTimes(1);
  });

  it("refreshes an existing session once after an unauthenticated callable response", async () => {
    mocks.callable
      .mockRejectedValueOnce({ code: "functions/unauthenticated" })
      .mockResolvedValueOnce({ data: { invitationLink: "https://example.test/invite" } });

    await expect(
      callAdministration("createOrganizationUser", {
        email: "invitee@example.test",
      }),
    ).resolves.toEqual({ invitationLink: "https://example.test/invite" });
    expect(mocks.getIdToken).toHaveBeenCalledWith(true);
    expect(mocks.callable).toHaveBeenCalledTimes(2);
  });

  it("includes the selected operating context in callable requests", async () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => JSON.stringify({ type: "branch", id: "branch-1" }),
      },
    });
    mocks.callable.mockResolvedValueOnce({ data: { rows: [] } });

    await callAdministration("listBranchRequests", { limit: 50 });

    expect(mocks.callable).toHaveBeenCalledWith({
      limit: 50,
      operatingContext: { type: "branch", id: "branch-1" },
    });
  });
});
