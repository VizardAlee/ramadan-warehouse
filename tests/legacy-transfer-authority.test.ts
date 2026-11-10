import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AccessProfile, Permission, RoleId } from "../functions/src/auth/authorize";
import type { StoredRole } from "../functions/src/auth/custom-roles";
const state = vi.hoisted(() => ({ actor: {} as AccessProfile, roles: [] as StoredRole[], transaction: vi.fn() }));
vi.mock("../functions/src/admin.js", () => ({ db: { doc: (path:string) => ({path}), runTransaction:state.transaction } }));
vi.mock("../functions/src/config.js", () => ({enforceAppCheck:false}));
vi.mock("../functions/src/auth/authorize.js", async original => ({...await original<typeof import("../functions/src/auth/authorize")>(), requireAccess:async () => state.actor}));
vi.mock("../functions/src/auth/custom-roles.js", async original => ({...await original<typeof import("../functions/src/auth/custom-roles")>(), loadCustomRoles:async () => state.roles}));
import { securedTransferCallable } from "../functions/src/transfers/command-security";
const restricted: Permission[] = ["transfers.create.direct", "transfers.create.from_request", "transfers.approve"];
function actor(role:RoleId) {
  state.actor = {userId:"actor",organizationId:"org",roleId:role,roleIds:[role],directRoleIds:[role],branchIds:["branch"],warehouseIds:["warehouse"],authorizationVersion:1};
}
function invoke(permission:Permission) {
  const callable = securedTransferCallable("testLegacy", z.object({idempotencyKey:z.string()}), permission,"source",async () => ({done:true}));
  return callable.run({data:{idempotencyKey:crypto.randomUUID()}} as Parameters<typeof callable.run>[0]);
}
beforeEach(() => {vi.clearAllMocks();state.roles=[];state.transaction.mockRejectedValue(new Error("Authorized command boundary reached"));});
describe("legacy transfer initiation and approval authority", () => {
  it.each(["branch_manager","warehouse_manager","purchasing_manager"] as RoleId[])("rejects %s even with stale restricted grants", async role => {
    actor(role);state.actor={...state.actor,effectivePermissions:[...restricted,"transfers.read.all"]};
    for (const permission of restricted) await expect(invoke(permission)).rejects.toMatchObject({code:"permission-denied"});
    expect(state.transaction).not.toHaveBeenCalled();
  });
  it("does not borrow administrator provenance from a read-only custom role", async () => {
    actor("purchasing_manager");
    state.actor={...state.actor,roleIds:["purchasing_manager","operations_administrator"],customRoleIds:["reader"],effectivePermissions:[...restricted,"transfers.read.all"]};
    state.roles=[{id:"reader",organizationId:"org",name:"Reader",baseRoleId:"operations_administrator",permissionIds:["transfers.read.all"],status:"active"}];
    for (const permission of restricted) await expect(invoke(permission)).rejects.toMatchObject({code:"permission-denied"});
    expect(state.transaction).not.toHaveBeenCalled();
  });
  it("rejects a removed custom administrator approval grant", async () => {
    actor("operations_administrator");state.actor={...state.actor,directRoleIds:[],customRoleIds:["reader"],effectivePermissions:["transfers.read.all","transfers.approve"]};
    state.roles=[{id:"reader",organizationId:"org",name:"Reader",baseRoleId:"operations_administrator",permissionIds:["transfers.read.all"],status:"active"}];
    await expect(invoke("transfers.approve")).rejects.toMatchObject({code:"permission-denied"});
    expect(state.transaction).not.toHaveBeenCalled();
  });
  it.each(["system_administrator","operations_administrator"] as RoleId[])("retains %s current authority", async role => {
    actor(role);
    for (const permission of restricted) await expect(invoke(permission)).rejects.toThrow("Authorized command boundary reached");
    expect(state.transaction).toHaveBeenCalledTimes(3);
  });
  it("retains a branch manager's existing receipt permission", async () => {
    actor("branch_manager");await expect(invoke("transfers.receive")).rejects.toThrow("Authorized command boundary reached");
  });
});
