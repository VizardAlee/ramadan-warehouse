import { describe, expect, it } from "vitest";
import { z } from "zod";
import { applyOperatingContext, requireBranchViewScope, type AccessProfile } from "../functions/src/auth/authorize";
import { matchesView, requireAllLocations, requireView } from "../functions/src/auth/view-scope";
import { parseInput } from "../functions/src/utils/callable";
import { activityFingerprint, activityInput } from "../functions/src/audit/activity-query";

const owner: AccessProfile = { userId: "owner", organizationId: "org", roleId: "system_administrator", branchIds: ["a", "b"], warehouseIds: [], authorizationVersion: 1 };
const selected = applyOperatingContext(owner, { type: "branch", id: "a" });

describe("selected branch view and authority", () => {
  it("retains all authority while scoping administrator records and single-branch actions", () => {
    expect(selected.roleId).toBe(owner.roleId);
    expect(selected.branchIds).toEqual(["a", "b"]);
    expect(matchesView(selected, { branchId: "a" })).toBe(true);
    expect(matchesView(selected, { branchId: "b" })).toBe(false);
    expect(() => requireBranchViewScope(selected, "b")).toThrow(/branch/);
    expect(() => requireBranchViewScope(selected, "a")).not.toThrow();
    expect(() => requireAllLocations(selected)).toThrow(/All locations/);
  });
  it("recognizes both participating branches without attributing unrelated transfers", () => {
    const fields = { branch: ["sourceBranchId", "destinationBranchId"] };
    expect(matchesView(selected, { sourceBranchId: "b", destinationBranchId: "a" }, fields)).toBe(true);
    expect(matchesView(selected, { sourceBranchId: "a", destinationBranchId: "b" }, fields)).toBe(true);
    expect(() => requireView(selected, { sourceBranchId: "b", destinationBranchId: "c" }, fields)).toThrow();
    expect(matchesView(selected, {})).toBe(false);
  });
  it("All preserves assigned authority and never fabricates an organization-wide role", () => {
    const manager = { ...owner, roleId: "branch_manager" as const };
    const all = applyOperatingContext(manager, { type: "all" });
    expect(all).toEqual(manager);
    expect(() => requireBranchViewScope(all, "c")).toThrow();
    expect(() => applyOperatingContext(manager, { type: "branch", id: "c" })).toThrow();
  });
  it("fills declared branch filters and rejects conflicting filters including warehouses", () => {
    const schema = z.object({ branchId: z.string().optional(), warehouseId: z.string().optional() }).strict();
    const context = { type: "branch", id: "a" };
    expect(parseInput(schema, { operatingContext: context })).toEqual({ branchId: "a" });
    expect(() => parseInput(schema, { branchId: "b", operatingContext: context })).toThrow(/another operating/);
    expect(() => parseInput(schema, { warehouseId: "w", operatingContext: context })).toThrow();
    expect(parseInput(schema, { operatingContext: { type: "all" } })).toEqual({});
  });
  it("handles multiplex endpoints and leaves shared data and transfer counterparties intact", () => {
    const schema = z.discriminatedUnion("action", [z.object({ action: z.literal("read"), branchId: z.string().optional() }).strict(), z.object({ action: z.literal("create"), destinationBranchId: z.string() }).strict()]);
    const operatingContext = { type: "branch", id: "a" };
    expect(parseInput(schema, { action: "read", operatingContext })).toEqual({ action: "read", branchId: "a" });
    expect(parseInput(schema.transform(value => value), { action: "read", operatingContext })).toEqual({ action: "read", branchId: "a" });
    expect(parseInput(schema, { action: "create", destinationBranchId: "b", operatingContext })).toEqual({ action: "create", destinationBranchId: "b" });
    expect(parseInput(z.object({ name: z.string() }).strict(), { name: "Shared category", operatingContext })).toEqual({ name: "Shared category" });
  });
  it("binds audit cursors to view scope as well as identity and filters", () => {
    const input = activityInput.parse({ fromDate: "2026-10-01", toDate: "2026-10-02" });
    expect(activityFingerprint(selected, input)).not.toBe(activityFingerprint(owner, input));
    expect(activityFingerprint(selected, input)).not.toBe(activityFingerprint({ ...selected, operatingContext: { type: "branch", id: "b" } }, input));
  });
});
