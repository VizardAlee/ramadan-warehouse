import { describe, expect, it, vi } from "vitest";
import { loadFinancialBranches, financialScopeLabel } from "@/features/accounting/financial-branches";
import type { Firestore } from "firebase/firestore";
import type { UserProfile } from "@/types/domain";
const db = {} as Firestore, profile = { organizationId: "org" } as UserProfile;
describe("existing authorized branch metadata paging", () => {
  it("loads every existing daily-close metadata page and intersects local financial access", async () => {
    const locations = vi.fn().mockResolvedValueOnce({ rows: [{ id: "remote", name: "Remote" }], nextCursor: "remote" })
      .mockResolvedValueOnce({ rows: [{ id: "own", name: "Own" }], nextCursor: null });
    await expect(loadFinancialBranches(db, profile, { branchIds: ["own"], permissions: ["daily.close.read"], organizationPermissions: [] }, locations)).resolves.toEqual([{ id: "own", name: "Own" }]);
    expect(locations.mock.calls).toEqual([[undefined], ["remote"]]);
  });
  it("fails visibly rather than returning a partial list when paging repeats", async () => {
    await expect(loadFinancialBranches(db, profile, { branchIds: [], permissions: ["daily.close.read"], organizationPermissions: ["finance.journal.read"] }, async () => ({ rows: [], nextCursor: "same" }))).rejects.toThrow(/paging/);
  });
  it("never calls branch-only scope an entire organization when the name is missing", () => {
    expect(financialScopeLabel("own", [])).toBe("Store own");
    expect(financialScopeLabel("", [])).toBe("Entire organization");
  });
});
