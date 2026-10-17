import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { buildRoleAssignment, type StoredRole } from "../functions/src/auth/custom-roles";
import { accessProfileFromRecord, type AccessProfile, type Permission, type RoleId } from "../functions/src/auth/authorize";
const state = vi.hoisted(() => ({ actor: {} as AccessProfile, read: vi.fn(), get: vi.fn(), transaction: vi.fn(), customRoles: [] as StoredRole[], loadRoles: vi.fn() }));
vi.mock("../functions/src/admin.js", () => ({ db: {
  doc: (path: string) => ({ id: path.split("/").at(-1), get: state.get }),
  collection: () => ({ where() { return this; }, get: state.read, doc: () => ({ id: "new-transfer" }) }),
  runTransaction: state.transaction,
} }));
vi.mock("../functions/src/auth/authorize.js", async importOriginal => ({
  ...await importOriginal<typeof import("../functions/src/auth/authorize")>(), requireAccess: async () => state.actor,
}));
vi.mock("../functions/src/auth/custom-roles.js", async importOriginal => ({
  ...await importOriginal<typeof import("../functions/src/auth/custom-roles")>(), loadCustomRoles: state.loadRoles,
}));
vi.mock("../functions/src/config.js", () => ({ enforceAppCheck: false }));
import { stockTransfers } from "../functions/src/callable/stock-transfers";
const invoke = (data: object) => stockTransfers.run({ data } as Parameters<typeof stockTransfers.run>[0]);
function custom(base: RoleId, permissions: Permission[] = []) {
  state.actor = { userId: "restricted", organizationId: "org", roleId: base, roleIds: [base],
    directRoleIds: [], effectivePermissions: permissions, branchIds: ["store"], warehouseIds: ["warehouse"], authorizationVersion: 1 };
}
beforeEach(() => { vi.clearAllMocks(); state.customRoles = []; state.loadRoles.mockImplementation(async () => state.customRoles); state.read.mockResolvedValue({ docs: [] }); });
describe("simple transfers honor effective permissions", () => {
  it.each(["branch_manager", "warehouse_manager", "operations_administrator", "auditor", "finance_officer"] as RoleId[])("denies every read route to restricted %s custom bases", async role => {
    custom(role);
    for (const data of [{ action: "options" }, { action: "stock", locationId: "location" }, { action: "list" }, { action: "get", transferId: "transfer" }])
      await expect(invoke(data)).rejects.toMatchObject({ code: "permission-denied" });
    expect(state.read).not.toHaveBeenCalled(); expect(state.transaction).not.toHaveBeenCalled();
  });
  const base = () => ({ transferId: "transfer", version: 0, idempotencyKey: crypto.randomUUID() });
  const line = { id: "line", quantity: 1, serialItemIds: [] };
  it("denies every omitted mutation permission even when transfer reading is allowed", async () => {
    custom("branch_manager", ["transfers.read.own_branch"]);
    const actions = [
      { action: "create", sourceLocationId: "source", destinationLocationId: "destination", items: [{ productId: "product", quantity: 1 }], idempotencyKey: crypto.randomUUID() },
      { action: "approve", ...base(), lines: [line] },
      { action: "receive", ...base(), lines: [{ id: "line", received: 1, damaged: 0 }] },
      { action: "report_problem", ...base(), note: "Missing delivery" },
      ...["never_left", "lost", "still_expected"].map(disposition => ({ action: "resolve", ...base(), disposition, note: "Verified result" })),
    ];
    for (const data of actions) await expect(invoke(data)).rejects.toMatchObject({ code: "permission-denied" });
    expect(state.transaction).not.toHaveBeenCalled();
  });
  it("permits an explicitly granted custom read without granting approval", async () => {
    custom("operations_administrator", ["transfers.read.all"]);
    await expect(invoke({ action: "options" })).resolves.toMatchObject({ locations: [], canApprove: false });
  });
  it.each(["operations_administrator", "auditor", "finance_officer"] as RoleId[])("does not widen branch reading through a restricted %s base in a multi-role profile", async role => {
    custom("branch_manager", ["transfers.read.own_branch"]);
    state.actor = { ...state.actor, roleIds: [role, "branch_manager"] };
    const values = { organizationId: "org", sourceBranchId: "other-store", destinationBranchId: "foreign-store" };
    state.get.mockResolvedValue({ exists: true, id: "transfer", get: (key: keyof typeof values) => values[key], data: () => values });
    await expect(invoke({ action: "get", transferId: "transfer" })).rejects.toMatchObject({ code: "not-found" });
  });
  it("preserves the existing direct branch-manager three-task creation capability", async () => {
    custom("branch_manager", ["transfers.read.own_branch"]); state.actor = { ...state.actor, directRoleIds: ["branch_manager"] };
    state.transaction.mockRejectedValue(new Error("Reached authorized transaction"));
    await expect(invoke({ action: "create", sourceLocationId: "source", destinationLocationId: "destination", items: [{ productId: "product", quantity: 1 }], idempotencyKey: crypto.randomUUID() }))
      .rejects.toThrow("Reached authorized transaction");
    expect(state.transaction).toHaveBeenCalledOnce();
  });
});

const operationLine = { id: "line", quantity: 1, serialItemIds: [] };
function combined(manager: "branch_manager" | "warehouse_manager", grants: Permission[] = ["transfers.read.all"]) {
  custom(manager);
  state.customRoles = [{ id: "ops-reader", organizationId: "org", name: "Operations reader", baseRoleId: "operations_administrator", permissionIds: grants, status: "active" }];
  state.actor = accessProfileFromRecord("restricted", { ...state.actor, status: "active", ...buildRoleAssignment([manager], state.customRoles) });
}
function transferSnapshot(fields: Record<string, unknown> = {}) {
  const values = { organizationId: "org", version: 0, status: "awaiting_receipt", sourceBranchId: "foreign-source", destinationBranchId: "foreign-destination", ...fields };
  return { exists: true, id: "transfer", get: (key: string) => values[key as keyof typeof values], data: () => values };
}
function instruction(action: "approve" | "receive" | "resolve" | "report_problem" | "create", disposition = "lost") {
  const common = { transferId: "transfer", version: 0, idempotencyKey: crypto.randomUUID() };
  if (action === "create") return { action, sourceLocationId: "source", destinationLocationId: "destination", note: "", items: [{ productId: "product", quantity: 1 }], idempotencyKey: common.idempotencyKey };
  if (action === "approve") return { action, ...common, lines: [operationLine] };
  if (action === "receive") return { action, ...common, lines: [{ id: "line", received: 1, damaged: 0, serialItemIds: [], damagedSerialItemIds: [] }], note: "" };
  if (action === "resolve") return { action, ...common, disposition, note: "Verified remainder" };
  return { action, ...common, note: "Missing delivery" };
}
describe("combined custom global reading and scoped transfer actions", () => {
  it.each(["branch_manager", "warehouse_manager"] as const)("does not promote a direct %s through read-only operations membership", async role => {
    combined(role);
    state.get.mockResolvedValue(transferSnapshot());
    await expect(invoke({ action: "get", transferId: "transfer" })).resolves.toMatchObject({ canApprove: false, canReceive: false });
    expect(state.loadRoles).toHaveBeenCalledWith("org", ["ops-reader"]);
  });
  it.each(["branch_manager", "warehouse_manager"] as const)("rejects fresh unassigned actions for a combined %s", async role => {
    combined(role);
    const tx = { get: vi.fn(async (ref: { id: string }) => ref.id === "transfer" ? transferSnapshot() : { exists: false }), getAll: vi.fn(), create: vi.fn(), update: vi.fn() };
    state.transaction.mockImplementation(async handler => handler(tx));
    for (const input of [instruction("approve"), instruction("receive"), instruction("resolve"), instruction("resolve", "never_left"), instruction("report_problem")])
      await expect(invoke(input)).rejects.toMatchObject({ code: "permission-denied" });
    expect(tx.getAll).not.toHaveBeenCalled(); expect(tx.update).not.toHaveBeenCalled(); expect(tx.create).not.toHaveBeenCalled();
  });
  it.each(["branch_manager", "warehouse_manager"] as const)("rechecks unassigned location scope on every replay for a combined %s", async role => {
    combined(role);
    for (const input of [instruction("create"), instruction("approve"), instruction("receive"), instruction("resolve"), instruction("resolve", "never_left"), instruction("report_problem")]) {
      const previous = { actorId: state.actor.userId, action: input.action, transferId: "transfer", fingerprint: createHash("sha256").update(JSON.stringify(input)).digest("hex") };
      state.transaction.mockImplementation(async handler => handler({ get: async (ref: { id: string }) => ref.id === "transfer" ? transferSnapshot() : { exists: true, get: (key: keyof typeof previous) => previous[key] } }));
      await expect(invoke(input)).rejects.toMatchObject({ code: "permission-denied" });
    }
  });
  it.each(["branch_manager", "warehouse_manager"] as const)("rejects unassigned creation for a combined %s", async role => {
    combined(role);
    const location = (id: string, fields: object) => {
      const values = { organizationId: "org", status: "active", ...fields };
      return { exists: true, id, get: (key: keyof typeof values) => values[key], data: () => values };
    };
    const tx = { get: vi.fn(async () => ({ exists: false })), getAll: vi.fn(async () => [
      location("source", { type: "warehouse", warehouseId: "foreign-warehouse" }),
      location("destination", { type: "branch", branchId: "foreign-destination" }), { exists: true },
    ]), create: vi.fn(), update: vi.fn() };
    state.transaction.mockImplementation(async handler => handler(tx));
    await expect(invoke(instruction("create"))).rejects.toMatchObject({ code: "permission-denied" });
    expect(tx.getAll).toHaveBeenCalledOnce(); expect(tx.create).not.toHaveBeenCalled(); expect(tx.update).not.toHaveBeenCalled();
  });
  it("retains assigned manager authority while read-only operations remains read-only", async () => {
    combined("branch_manager"); state.get.mockResolvedValue(transferSnapshot({ sourceBranchId: "store", destinationBranchId: "store" }));
    await expect(invoke({ action: "get", transferId: "transfer" })).resolves.toMatchObject({ canApprove: true, canReceive: true });
  });
  it("honors only the explicitly granted global action from a custom operations role", async () => {
    combined("branch_manager", ["transfers.read.all", "transfers.approve"]); state.get.mockResolvedValue(transferSnapshot());
    await expect(invoke({ action: "get", transferId: "transfer" })).resolves.toMatchObject({ canApprove: true, canReceive: false });
    state.customRoles[0]!.permissionIds = ["transfers.read.all"];
    await expect(invoke({ action: "get", transferId: "transfer" })).resolves.toMatchObject({ canApprove: false, canReceive: false });
  });
  it("keeps remote serial selection available to an explicitly granted global approver", async () => {
    for (const granted of [false, true]) {
      combined("branch_manager", granted ? ["transfers.read.all", "transfers.approve"] : ["transfers.read.all"]);
      state.get.mockResolvedValue(transferSnapshot({ type: "warehouse", status: "active", warehouseId: "foreign-warehouse" }));
      state.read.mockClear();
      await expect(invoke({ action: "stock", locationId: "remote" })).resolves.toEqual({ stock: [] });
      expect(state.read).toHaveBeenCalledTimes(granted ? 3 : 2);
    }
  });
  it("preserves direct operations-administrator global actions", async () => {
    custom("operations_administrator", ["transfers.read.all"]); state.actor = { ...state.actor, directRoleIds: ["operations_administrator"] }; state.get.mockResolvedValue(transferSnapshot());
    await expect(invoke({ action: "get", transferId: "transfer" })).resolves.toMatchObject({ canApprove: true, canReceive: true });
    expect(state.loadRoles).not.toHaveBeenCalled();
  });
});
