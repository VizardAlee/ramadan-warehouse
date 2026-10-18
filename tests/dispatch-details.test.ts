import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectSaleInput } from "../functions/src/validation/sales";
import { updateDispatchDetailsInput } from "../functions/src/validation/dispatch-details";
import { updateDispatchDetails } from "../functions/src/sales/dispatch-details";
import type { AccessProfile } from "../functions/src/auth/authorize";

const state = vi.hoisted(() => ({ docs: new Map<string, Record<string, unknown>>(), writes: [] as string[], permitted: true, branch: "b", audit: vi.fn() }));
vi.mock("../functions/src/admin", () => ({ db: {
  doc: (path: string) => ({ path, id: path.split("/").at(-1) }),
  runTransaction: async (work: (tx: unknown) => unknown) => {
    const writes: Array<() => void> = [];
    const tx = {
      getAll: async (...refs: Array<{ path: string; id: string }>) => refs.map(ref => ({ ...ref, exists: state.docs.has(ref.path), get: (key: string) => state.docs.get(ref.path)?.[key] })),
      update: (ref: { path: string }, value: Record<string, unknown>) => writes.push(() => { state.writes.push(ref.path); state.docs.set(ref.path, { ...state.docs.get(ref.path), ...value }); }),
      create: (ref: { path: string }, value: Record<string, unknown>) => writes.push(() => { state.writes.push(ref.path); state.docs.set(ref.path, value); }),
    };
    const result = await work(tx); writes.forEach(write => write()); return result;
  },
} }));
vi.mock("../functions/src/audit/write-audit-log", () => ({ writeAuditLog: (...args: unknown[]) => state.audit(...args) }));
const key = "00000000-0000-4000-8000-000000000001";
const input = { action: "update_dispatch_details" as const, saleId: "sale", collectionId: "handover", expectedVersion: 0, dispatcherPhone: "+234 (0) 803 123 4567 ext 2", vehiclePlate: "Kano ABC-123 XY", deliveryRecipientName: "Amina <Receiver>", idempotencyKey: key };
function actor(): AccessProfile {
  const role = state.permitted ? "branch_manager" : "branch_requester";
  return { organizationId: "org", userId: "staff", roleId: role, directRoleIds: [role], branchIds: [state.branch], warehouseIds: [], authorizationVersion: 1 };
}
beforeEach(() => {
  state.docs.clear(); state.writes = []; state.permitted = true; state.branch = "b"; state.audit.mockReset();
  state.docs.set("sales/sale", { organizationId: "org", branchId: "b", status: "completed" });
  state.docs.set("saleCollections/handover", { organizationId: "org", branchId: "b", saleId: "sale", totalQuantity: 2, inventoryTransactionId: "original-stock", lines: [{ quantity: 2 }] });
});
describe("dispatch details", () => {
  it("accepts free-form international details, old requests, and bounded single-line text", () => {
    expect(updateDispatchDetailsInput.parse(input).dispatcherPhone).toBe(input.dispatcherPhone);
    const collection = { action: "collect", saleId: "sale", collector: "Musa", lines: [{ saleItemId: "item", quantity: 1 }], idempotencyKey: key };
    expect(collectSaleInput.parse(collection)).not.toHaveProperty("dispatcherPhone");
    expect(collectSaleInput.parse({ ...collection, dispatcherPhone: " +44 20 1234 5678 ", vehiclePlate: "T 123 ABC" }).dispatcherPhone).toBe("+44 20 1234 5678");
    for (const fields of [{ dispatcherPhone: "x".repeat(61) }, { vehiclePlate: "x".repeat(41) }, { deliveryRecipientName: "x".repeat(121) }, { vehiclePlate: "A\nB" }]) expect(updateDispatchDetailsInput.safeParse({ ...input, ...fields }).success).toBe(false);
  });
  it("updates only one handover with audit and idempotent retries, never stock or journals", async () => {
    const original = structuredClone(state.docs.get("saleCollections/handover"));
    const result = await updateDispatchDetails(actor(), input);
    expect(result).toMatchObject({ collectionId: "handover", dispatchDetailsVersion: 1, vehiclePlate: input.vehiclePlate });
    const after = state.docs.get("saleCollections/handover")!;
    expect(after.inventoryTransactionId).toBe(original!.inventoryTransactionId); expect(after.lines).toEqual(original!.lines);
    expect(state.writes.filter(path => !path.startsWith("idempotencyOperations/"))).toEqual(["saleCollections/handover"]);
    expect(state.audit.mock.calls[0]![2]).toMatchObject({ action: "sale.dispatch_details_updated", before: { dispatchDetailsVersion: 0 }, after: { dispatchDetailsVersion: 1 } });
    const count = state.writes.length;
    expect(await updateDispatchDetails(actor(), input)).toEqual(result); expect(state.writes).toHaveLength(count);
    await expect(updateDispatchDetails(actor(), { ...input, vehiclePlate: "Other" })).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(updateDispatchDetails(actor(), { ...input, idempotencyKey: "00000000-0000-4000-8000-000000000002" })).rejects.toMatchObject({ code: "failed-precondition" });
  });
  it("rejects missing permission, another branch, tenant or invoice, and unposted sales without writes", async () => {
    state.permitted = false; await expect(updateDispatchDetails(actor(), input)).rejects.toMatchObject({ code: "permission-denied" }); state.permitted = true;
    state.branch = "other"; await expect(updateDispatchDetails(actor(), input)).rejects.toMatchObject({ code: "permission-denied" }); state.branch = "b";
    for (const change of [{ organizationId: "other" }, { saleId: "other" }, { branchId: "other" }]) {
      const before = state.docs.get("saleCollections/handover")!; state.docs.set("saleCollections/handover", { ...before, ...change });
      await expect(updateDispatchDetails(actor(), input)).rejects.toMatchObject({ code: "not-found" }); state.docs.set("saleCollections/handover", before);
    }
    state.docs.set("sales/sale", { ...state.docs.get("sales/sale"), status: "pending" });
    await expect(updateDispatchDetails(actor(), input)).rejects.toMatchObject({ code: "failed-precondition" }); expect(state.writes).toEqual([]);
  });
});
