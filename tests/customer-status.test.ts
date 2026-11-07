import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ row: {} as Record<string, unknown>, prior: null as Record<string, unknown> | null, update: vi.fn(), create: vi.fn(), audit: vi.fn() }));
vi.mock("../functions/src/admin.js", () => ({ db: { doc: (path: string) => ({ path }), runTransaction: (fn: (tx: unknown) => unknown) => fn({ getAll: async () => [
  { exists: true, data: () => mocks.row, get: (key: string) => mocks.row[key] },
  { exists: Boolean(mocks.prior), get: (key: string) => mocks.prior?.[key] },
], update: mocks.update, create: mocks.create }) } }));
vi.mock("../functions/src/audit/write-audit-log.js", () => ({ writeAuditLog: mocks.audit }));
import { setCustomerStatus } from "../functions/src/sales/customer-status";
import type { ScopedAccess } from "../functions/src/auth/permission-scope";
const actor = { userId: "staff", organizationId: "org", branchIds: ["a"], organizationPermissions: [], operatingContext: { type: "branch", id: "a" } } as unknown as ScopedAccess;
const input = { customerId: "c1", active: false, confirmedCustomerNumber: "CUS-1", idempotencyKey: "0ef4a688-727e-43d6-8331-11e550a0e961" };
beforeEach(() => { vi.clearAllMocks(); mocks.prior = null; mocks.row = { organizationId: "org", branchId: "a", customerNumber: "CUS-1", active: true, outstandingBalanceMinor: 0, advanceBalances: {}, name: "Keep name", history: ["invoice"] }; });
it("changes only customer availability and writes an audit event", async () => {
  await expect(setCustomerStatus(actor, input)).resolves.toEqual({ saved: true });
  const patch = mocks.update.mock.calls[0]![1];
  expect(Object.keys(patch).sort()).toEqual(["active", "updatedAt", "updatedBy"]);
  expect(patch.active).toBe(false);
  expect(mocks.audit.mock.calls[0]![2].action).toBe("customer.deactivated");
});
it.each([{ outstandingBalanceMinor: 1 }, { advanceBalances: { general: 1 } }])("blocks deactivation while money remains: %j", async balances => {
  Object.assign(mocks.row, balances);
  await expect(setCustomerStatus(actor, input)).rejects.toMatchObject({ code: "failed-precondition" });
  expect(mocks.update).not.toHaveBeenCalled();
});
it("rejects another branch even when customer ID is known", async () => {
  mocks.row.branchId = "b";
  await expect(setCustomerStatus(actor, input)).rejects.toMatchObject({ code: "permission-denied" });
  expect(mocks.update).not.toHaveBeenCalled();
});
it("rejects another organization", async () => {
  mocks.row.organizationId = "other";
  await expect(setCustomerStatus(actor, input)).rejects.toMatchObject({ code: "not-found" });
});
it("requires the matching customer number", async () => {
  await expect(setCustomerStatus(actor, { ...input, confirmedCustomerNumber: "wrong" })).rejects.toMatchObject({ code: "invalid-argument" });
});
it("restores inactive customers without rewriting their financial records", async () => {
  mocks.row.active = false;
  await setCustomerStatus(actor, { ...input, active: true });
  expect(mocks.update.mock.calls[0]![1].active).toBe(true);
  expect(mocks.audit.mock.calls[0]![2].action).toBe("customer.reactivated");
});
it("deduplicates retries and rejects reusing a retry key for a different action", async () => {
  await setCustomerStatus(actor, input);
  mocks.prior = mocks.create.mock.calls[0]![1];
  mocks.update.mockClear();
  await expect(setCustomerStatus(actor, input)).resolves.toEqual({ saved: false });
  expect(mocks.update).not.toHaveBeenCalled();
  await expect(setCustomerStatus(actor, { ...input, active: true })).rejects.toMatchObject({ code: "already-exists" });
});
