import { releaseAcknowledgements } from "../releases/acknowledgements.js";
import { FieldValue } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import { enforceAppCheck } from "../config.js";
import { scopedAccess } from "../auth/permission-scope.js";
import { requireAccess } from "../auth/authorize.js";

export const getMyAccessContext = onCall({ enforceAppCheck }, async (request) => {
  const profile = await requireAccess(request);
  if (["release_notes", "acknowledge_release"].includes(request.data?.action)) return releaseAcknowledgements(profile, request.data);
  if (request.data?.action === "purchasing_access") {
    const current = await scopedAccess(profile);
    return { permissions: current.effectivePermissions?.filter(permission => permission.startsWith("procurement.") || permission.startsWith("payables.") || permission.startsWith("suppliers.")) ?? [] };
  }
  const userRef = db.collection("users").doc(profile.userId);
  await db.runTransaction(async (transaction) => {
    const current = await transaction.get(userRef);
    if (["pending", "expired"].includes(String(current.get("invitationStatus")))) transaction.update(userRef, { invitationStatus: "accepted", invitationAcceptedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), updatedBy: profile.userId });
  });
  return {
    organizationId: profile.organizationId,
    roleId: profile.roleId,
    roleIds: profile.roleIds ?? [profile.roleId],
    branchIds: profile.branchIds,
    warehouseIds: profile.warehouseIds,
    authorizationVersion: profile.authorizationVersion,
  };
});
