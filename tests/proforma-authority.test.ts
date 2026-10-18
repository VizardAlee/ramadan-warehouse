import { beforeEach, expect, it, vi } from "vitest";
import type { AccessProfile } from "../functions/src/auth/authorize";
import type { StoredRole } from "../functions/src/auth/custom-roles";

const memory = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  transaction: vi.fn(),
}));
vi.mock("../functions/src/admin", () => {
  function snapshot(path: string) {
    const data = memory.rows.get(path);
    return { id: path.split("/").at(-1), exists: Boolean(data), get: (field: string) => data?.[field], data: () => data };
  }
  const reference = (path: string) => ({ path, get: async () => snapshot(path) });
  return { db: {
    doc: reference,
    collection: (name: string) => ({ doc: (id: string) => reference(`${name}/${id}`) }),
    getAll: async (...refs: Array<{ path: string }>) => refs.map(ref => snapshot(ref.path)),
    runTransaction: memory.transaction,
  } };
});
import { buildRoleAssignment } from "../functions/src/auth/custom-roles";
import { proformaRequest } from "../functions/src/sales/proforma";

const reader: StoredRole = { id: "global-reader", organizationId: "org", name: "Sales reports", baseRoleId: "finance_officer", permissionIds: ["reports.sales.read"], status: "active" };
function actor(localCreator = true): AccessProfile {
  return { userId: "quoter", organizationId: "org", ...buildRoleAssignment(localCreator ? ["branch_manager"] : [], [reader]), branchIds: ["a"], warehouseIds: [], authorizationVersion: 1 };
}
function create(branchId: string) {
  return { action: "create_proforma", branchId, validUntil: new Date(Date.now() + 86400000).toISOString().slice(0, 10), lines: [{ productId: "product", quantity: 1 }], idempotencyKey: "b4f3e259-256d-4c77-9890-8024a8206430" };
}
beforeEach(() => {
  memory.rows.clear();
  memory.rows.set(`roles/${reader.id}`, { ...reader });
  memory.rows.set("proformaQuotes/quote-b", { organizationId: "org", branchId: "b", number: "PF-B" });
  memory.transaction.mockReset().mockRejectedValue(new Error("Authorized transaction boundary"));
});

it("allows a separately granted global quote read without broadening local creation authority", async () => {
  const scoped = actor();
  await expect(proformaRequest(scoped, { action: "get_proforma", proformaId: "quote-b" })).resolves.toMatchObject({ id: "quote-b", branchId: "b" });
  await expect(proformaRequest(scoped, create("b"))).rejects.toMatchObject({ code: "permission-denied" });
  expect(memory.transaction).not.toHaveBeenCalled();
});

it("lets the same creator reach the posting-free quote transaction only in an assigned store", async () => {
  // Stop at the transaction boundary: this checks real grant resolution and
  // proforma authorization, not the separate emulated quote persistence path.
  await expect(proformaRequest(actor(), create("a"))).rejects.toThrow("Authorized transaction boundary");
  expect(memory.transaction).toHaveBeenCalledTimes(1);
});

it("does not let global reporting permission create quotes in an assigned store", async () => {
  await expect(proformaRequest(actor(false), create("a"))).rejects.toMatchObject({ code: "permission-denied" });
  expect(memory.transaction).not.toHaveBeenCalled();
});

it("reloads current custom grants and rejects a revoked reader before creation", async () => {
  memory.rows.set(`roles/${reader.id}`, { ...reader, status: "inactive" });
  await expect(proformaRequest(actor(), create("b"))).rejects.toMatchObject({ code: "failed-precondition" });
  expect(memory.transaction).not.toHaveBeenCalled();
});
