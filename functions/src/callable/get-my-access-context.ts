import { onCall } from "firebase-functions/v2/https";
import { enforceAppCheck } from "../config.js";
import { requireAccess } from "../auth/authorize.js";

export const getMyAccessContext = onCall({ enforceAppCheck }, async (request) => {
  const profile = await requireAccess(request);
  return {
    organizationId: profile.organizationId,
    roleIds: profile.roleIds,
    branchIds: profile.branchIds,
    warehouseIds: profile.warehouseIds,
  };
});
