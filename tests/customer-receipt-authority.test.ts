import { beforeEach, expect, it, vi } from "vitest";
import type { AccessProfile } from "../functions/src/auth/authorize";
import { buildRoleAssignment, type StoredRole } from "../functions/src/auth/custom-roles";

const state = vi.hoisted(() => ({ actor: undefined as AccessProfile | undefined, docs: new Map<string, Record<string, unknown>>() }));
vi.mock("../functions/src/admin", () => {
  const reference = (path: string) => ({ path, id: path.split("/").at(-1)!, get: async () => snapshot(path) });
  function snapshot(path: string) { const value = state.docs.get(path); return { id: path.split("/").at(-1)!, exists: Boolean(value), get: (field: string) => value?.[field], data: () => value }; }
  return { db: { doc: reference, collection: (name: string) => ({ doc: (id: string) => reference(`${name}/${id}`) }), getAll: async (...refs: Array<{ path: string }>) => refs.map(row => snapshot(row.path)) } };
});
vi.mock("../functions/src/auth/authorize", async importOriginal => ({ ...await importOriginal<typeof import("../functions/src/auth/authorize")>(), requireAccess: async () => state.actor! }));
import { getCustomerHistory } from "../functions/src/callable/customers";

const reader: StoredRole = { id: "global-reader", organizationId: "org", name: "Global sales reports", baseRoleId: "finance_officer", permissionIds: ["reports.sales.read"], status: "active" };
function actor(mixed: boolean): AccessProfile { return { userId: "staff", organizationId: "org", ...buildRoleAssignment(["branch_manager"], mixed ? [reader] : []), branchIds: ["a"], warehouseIds: [], authorizationVersion: 1 }; }
function request(branchId: string) { return { data: { view: "payment_receipt", customerId: "customer", paymentId: "payment", branchId } } as Parameters<typeof getCustomerHistory.run>[0]; }
beforeEach(() => {
  state.actor = actor(false); state.docs.clear();
  state.docs.set(`roles/${reader.id}`, { ...reader });
  state.docs.set("customers/customer", { organizationId: "org", name: "Customer" });
  state.docs.set("organizations/org", { tradingName: "Company" });
  state.docs.set("customerPayments/payment", { organizationId: "org", customerId: "customer", branchId: "b", status: "recorded", method: "cash", amountMinor: 100, outstandingAfterMinor: 5000, advanceBalancesAfter: { general: 1200 } });
});
it("denies an unassigned receipt store to a direct local reader", async () => {
  await expect(getCustomerHistory.run(request("b"))).rejects.toMatchObject({ code: "permission-denied" });
});
it("returns a permitted local receipt", async () => {
  state.docs.set("customerPayments/payment", { ...state.docs.get("customerPayments/payment"), branchId: "a" });
  await expect(getCustomerHistory.run(request("a"))).resolves.toMatchObject({ id: "payment", party: "customer", outstandingAfterMinor: 5000, advanceAfterMinor: 1200 });
});
it("does not broaden local receipt reading through an unrelated global report grant", async () => {
  state.actor = actor(true);
  await expect(getCustomerHistory.run(request("b"))).rejects.toMatchObject({ code: "permission-denied" });
});

it("retains directly assigned organization-wide customer receipt access", async () => {
  state.actor = { ...actor(false), ...buildRoleAssignment(["system_administrator"], []), branchIds: [] };
  await expect(getCustomerHistory.run(request("b"))).resolves.toMatchObject({ id: "payment", outstandingAfterMinor: 5000, advanceAfterMinor: 1200 });
});

const customerGrant: StoredRole = { ...reader, id: "global-customers", name: "Explicit global customer read", baseRoleId: "operations_administrator", permissionIds: ["customers.read"] };
function globalCustomerReader() {
  state.docs.set(`roles/${customerGrant.id}`, { ...customerGrant });
  state.actor = { ...actor(false), ...buildRoleAssignment(["branch_manager"], [customerGrant]) };
}
it("retains an explicit global customer-read grant and reloads its current authority", async () => {
  globalCustomerReader();
  await expect(getCustomerHistory.run(request("b"))).resolves.toMatchObject({ id: "payment", outstandingAfterMinor: 5000 });
  state.docs.set(`roles/${customerGrant.id}`, { ...customerGrant, permissionIds: [] });
  await expect(getCustomerHistory.run(request("b"))).rejects.toMatchObject({ code: "permission-denied" });
});

it("retains receipt organization, customer and recorded-status checks for global readers", async () => {
  globalCustomerReader();
  const original = state.docs.get("customerPayments/payment")!;
  for (const change of [{ organizationId: "other" }, { customerId: "other" }, { status: "draft" }]) {
    state.docs.set("customerPayments/payment", { ...original, ...change });
    await expect(getCustomerHistory.run(request("b"))).rejects.toMatchObject({ code: "not-found" });
  }
});
