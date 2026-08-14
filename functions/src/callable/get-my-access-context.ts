import { onCall } from "firebase-functions/v2/https";
import { enforceAppCheck } from "../config.js";
import { requireAccess } from "../auth/authorize.js";

export const getMyAccessContext = onCall({ enforceAppCheck }, async (request) => {
  const profile = await requireAccess(request);
  return {
    organizationId: profile.organizationId,
    roleId: profile.roleId,
    roleIds: profile.roleIds ?? [profile.roleId],
    branchIds: profile.branchIds,
    warehouseIds: profile.warehouseIds,
    authorizationVersion: profile.authorizationVersion,
  };
});
