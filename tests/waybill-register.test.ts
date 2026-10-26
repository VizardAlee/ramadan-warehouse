import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
const { Timestamp } = createRequire(new URL("../functions/package.json", import.meta.url))("firebase-admin/firestore") as typeof import("firebase-admin/firestore");
import type { AccessProfile } from "../functions/src/auth/authorize";
import { saleDocumentInput } from "../functions/src/validation/sales";

const state = vi.hoisted(() => ({ docs: new Map<string, Record<string, unknown>>(), query: [] as unknown[][], returned: [] as string[] }));
vi.mock("../functions/src/admin", () => {
  const snapshot = (path: string) => ({ id: path.split("/").at(-1)!, exists: state.docs.has(path), get: (key: string) => state.docs.get(path)?.[key] });
  const query = {
    where: (...args: unknown[]) => { state.query.push(["where", ...args]); return query; },
    orderBy: (...args: unknown[]) => { state.query.push(["orderBy", ...args]); return query; },
    startAfter: (...args: unknown[]) => { state.query.push(["startAfter", ...args]); return query; },
    limit: (size: number) => { state.query.push(["limit", size]); return query; },
    get: async () => ({ size: state.returned.length, docs: state.returned.map(snapshot) }),
  };
  return { db: { doc: (path: string) => ({ path, get: async () => snapshot(path) }), collection: (name: string) => { state.query.push(["collection", name]); return query; }, getAll: async (...refs: Array<{ path: string }>) => refs.map(ref => snapshot(ref.path)) } };
});
import { readWaybillRegister } from "../functions/src/sales/waybill-register";
const actor: AccessProfile = { userId: "staff", organizationId: "org", roleId: "branch_manager", directRoleIds: ["branch_manager"], branchIds: ["b"], warehouseIds: [], authorizationVersion: 1 };
const input = { action: "list_waybills", branchId: "b", limit: 1 };
beforeEach(() => {
  state.docs.clear(); state.query = []; state.returned = ["saleCollections/c1"];
  state.docs.set("branches/b", { organizationId: "org" });
  state.docs.set("sales/s1", { organizationId: "org", branchId: "b", status: "completed", saleNumber: "SAL-1", grossAmountMinor: 1000000, customerPhone: "private" });
  state.docs.set("saleCollections/c1", { organizationId: "org", branchId: "b", saleId: "s1", referenceNumber: "SAL-1", totalQuantity: 2, collectedAt: Timestamp.fromMillis(1000), inventoryTransactionId: "m1", costAmountMinor: 400000, collector: "Private name" });
  state.docs.set("inventoryTransactions/m1", { organizationId: "org", referenceType: "saleCollection", referenceId: "c1", transactionNumber: "INV-1" });
});
describe("waybill register authority and projection", () => {
  it("reads only the selected tenant/store, projects handover metadata, and uses bounded stable paging", async () => {
    state.returned.push("saleCollections/c2");
    const result = await readWaybillRegister(actor, input);
    expect(state.query).toContainEqual(["where", "organizationId", "==", "org"]);
    expect(state.query).toContainEqual(["where", "branchId", "==", "b"]);
    expect(state.query).toContainEqual(["limit", 2]);
    expect(result.nextCursor).toBe("c1");
    expect(result.rows).toEqual([expect.objectContaining({ id: "c1", waybillNumber: "WB-INV-1", saleId: "s1", totalQuantity: 2 })]);
    expect(JSON.stringify(result)).not.toMatch(/costAmount|grossAmount|customerPhone|collector/);
  });
  it("rejects absent read permission, another branch and tenant before querying handovers", async () => {
    await expect(readWaybillRegister({ ...actor, roleId: "branch_requester", directRoleIds: ["branch_requester"] }, input)).rejects.toMatchObject({ code: "permission-denied" });
    await expect(readWaybillRegister({ ...actor, branchIds: [] }, input)).rejects.toMatchObject({ code: "permission-denied" });
    state.docs.set("branches/b", { organizationId: "other" });
    await expect(readWaybillRegister(actor, input)).rejects.toMatchObject({ code: "not-found" });
    expect(state.query).toEqual([]);
  });
  it("binds invoice lookup and page cursors to the chosen scope and filter", async () => {
    await readWaybillRegister(actor, { ...input, invoiceNumber: " SAL-1 ", cursor: "c1" });
    expect(state.query).toContainEqual(["where", "referenceNumber", "==", "SAL-1"]);
    expect(state.query.some(call => call[0] === "startAfter")).toBe(true);
    for (const fields of [{ branchId: "other" }, { organizationId: "other" }, { referenceNumber: "OTHER" }]) {
      const prior = state.docs.get("saleCollections/c1")!;
      state.docs.set("saleCollections/c1", { ...prior, ...fields });
      await expect(readWaybillRegister(actor, { ...input, invoiceNumber: "SAL-1", cursor: "c1" })).rejects.toMatchObject({ code: "invalid-argument" });
      state.docs.set("saleCollections/c1", prior);
    }
  });
  it("rejects inconsistent or unposted handover evidence", async () => {
    state.docs.set("sales/s1", { ...state.docs.get("sales/s1"), organizationId: "other" });
    await expect(readWaybillRegister(actor, input)).rejects.toMatchObject({ code: "data-loss" });
    state.docs.set("sales/s1", { organizationId: "org", branchId: "b", status: "pending" });
    await expect(readWaybillRegister(actor, input)).rejects.toMatchObject({ code: "data-loss" });
  });
  it("validates direct handover identifiers and prevents mixing selection with a history cursor", () => {
    expect(saleDocumentInput.parse({ saleId: "s1", collectionId: "c1" }).collectionId).toBe("c1");
    expect(saleDocumentInput.safeParse({ saleId: "s1", collectionId: "../bad" }).success).toBe(false);
    expect(saleDocumentInput.safeParse({ saleId: "s1", collectionId: "c1", collectionCursorId: "c2" }).success).toBe(false);
  });
});
