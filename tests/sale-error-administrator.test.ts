import { expect, it } from "vitest";
import { requireSaleErrorAdministrator } from "../functions/src/sales/error-correction-authority";
import { canCorrectSaleErrors } from "@/lib/permissions/roles";
import type { AccessProfile, RoleId } from "../functions/src/auth/authorize";
const actor: AccessProfile = { userId:"user", organizationId:"org", roleId:"system_administrator", branchIds:["a"], warehouseIds:[], authorizationVersion:1 };
it("requires the real System Administrator assignment independently of broad returns permissions", () => {
  expect(() => requireSaleErrorAdministrator(actor)).not.toThrow();
  expect(canCorrectSaleErrors({ roleId:"system_administrator", status:"active" })).toBe(true);
  for (const role of ["branch_manager","finance_officer","operations_administrator","sales_cashier"] as RoleId[]) {
    expect(() => requireSaleErrorAdministrator({ ...actor, roleId:role, roleIds:[role] })).toThrow();
    expect(canCorrectSaleErrors({ roleId:role, roleIds:[role], status:"active" })).toBe(false);
  }
  const custom = { ...actor, directRoleIds:[], customRoleIds:["fabricated-admin-base"] };
  expect(() => requireSaleErrorAdministrator(custom)).toThrow();
  expect(canCorrectSaleErrors({ roleId:"system_administrator", directRoleIds:[], customRoleIds:["fabricated-admin-base"], status:"active" })).toBe(false);
});
