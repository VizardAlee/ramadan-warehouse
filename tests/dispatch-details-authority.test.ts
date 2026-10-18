import { beforeEach, expect, it, vi } from "vitest";
import type { AccessProfile } from "../functions/src/auth/authorize";
import { buildRoleAssignment, type StoredRole } from "../functions/src/auth/custom-roles";

const state = vi.hoisted(() => ({ docs: new Map<string, Record<string, unknown>>(), writes: [] as string[] }));
vi.mock("../functions/src/admin", () => {
  const ref = (path: string) => ({ path, id: path.split("/").at(-1) });
  const snapshot = (reference: ReturnType<typeof ref>) => ({ ...reference, exists: state.docs.has(reference.path), get: (field: string) => state.docs.get(reference.path)?.[field], data: () => state.docs.get(reference.path) });
  return { db: {
    doc: ref,
    collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    getAll: async (...refs: Array<ReturnType<typeof ref>>) => refs.map(snapshot),
    runTransaction: async (work: (tx: unknown) => unknown) => {
      const pending: Array<() => void> = [];
      const tx = {
        getAll: async (...refs: Array<ReturnType<typeof ref>>) => refs.map(snapshot),
        update: (reference: ReturnType<typeof ref>, value: Record<string, unknown>) => pending.push(() => { state.writes.push(reference.path); state.docs.set(reference.path, { ...state.docs.get(reference.path), ...value }); }),
        create: (reference: ReturnType<typeof ref>, value: Record<string, unknown>) => pending.push(() => { state.writes.push(reference.path); state.docs.set(reference.path, value); }),
      };
      const result = await work(tx); pending.forEach(write => write()); return result;
    },
  } };
});
vi.mock("../functions/src/audit/write-audit-log", () => ({ writeAuditLog: vi.fn() }));
import { updateDispatchDetails } from "../functions/src/sales/dispatch-details";

const reader: StoredRole = { id: "global-reader", organizationId: "org", name: "Global reports only", baseRoleId: "finance_officer", permissionIds: ["reports.sales.read"], status: "active" };
const actor = (mixed: boolean): AccessProfile => ({ userId: "staff", organizationId: "org", ...buildRoleAssignment(["branch_manager"], mixed ? [reader] : []), branchIds: ["a"], warehouseIds: [], authorizationVersion: 1 });
const input = { action: "update_dispatch_details" as const, saleId: "sale", collectionId: "handover", expectedVersion: 0, dispatcherPhone: "08031234567", idempotencyKey: "1e02b6c7-ef59-45f0-a63b-80624da4bd60" };
function handover(branchId: string) {
  state.docs.set("sales/sale", { organizationId: "org", branchId, status: "completed" });
  state.docs.set("saleCollections/handover", { organizationId: "org", branchId, saleId: "sale", totalQuantity: 2 });
}
beforeEach(() => { state.docs.clear(); state.writes = []; state.docs.set(`roles/${reader.id}`, { ...reader }); handover("b"); });

it("allows direct release authority in its assigned store", async () => {
  handover("a");
  await expect(updateDispatchDetails(actor(false), input)).resolves.toMatchObject({ dispatchDetailsVersion: 1 });
  expect(state.writes).toContain("saleCollections/handover");
});

it("rejects another store for a directly assigned local manager", async () => {
  await expect(updateDispatchDetails(actor(false), input)).rejects.toMatchObject({ code: "permission-denied" });
  expect(state.writes).toEqual([]);
});

it("does not let an unrelated global read role broaden local dispatch-edit authority", async () => {
  await expect(updateDispatchDetails(actor(true), input)).rejects.toMatchObject({ code: "permission-denied" });
  expect(state.writes).toEqual([]);
});

it("retains directly assigned organization-wide release authority", async () => {
  const global: AccessProfile = { ...actor(false), ...buildRoleAssignment(["system_administrator"], []), branchIds: [] };
  await expect(updateDispatchDetails(global, input)).resolves.toMatchObject({ dispatchDetailsVersion: 1 });
});

const releaseGrant: StoredRole = { ...reader, id: "global-release", name: "Explicit global release", baseRoleId: "operations_administrator", permissionIds: ["sales.stock.release"] };
function globalReleaser(): AccessProfile {
  state.docs.set(`roles/${releaseGrant.id}`, { ...releaseGrant });
  return { ...actor(false), ...buildRoleAssignment(["branch_manager"], [releaseGrant]) };
}
it("retains an explicit organization-wide custom release grant", async () => {
  await expect(updateDispatchDetails(globalReleaser(), input)).resolves.toMatchObject({ dispatchDetailsVersion: 1 });
});

it("checks current action scope before returning an earlier successful replay", async () => {
  const global = globalReleaser();
  await updateDispatchDetails(global, input);
  const writes = state.writes.length;
  state.docs.set(`roles/${releaseGrant.id}`, { ...releaseGrant, permissionIds: [] });
  await expect(updateDispatchDetails(global, input)).rejects.toMatchObject({ code: "permission-denied" });
  expect(state.writes).toHaveLength(writes);
});
