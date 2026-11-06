import { HttpsError } from "firebase-functions/v2/https";
import { accessRoleIds, type AccessProfile } from "../auth/authorize.js";
/** Mistaken-sale correction is separate from routine customer returns. */
export function requireSaleErrorAdministrator(actor: AccessProfile): void {
  const direct = actor.directRoleIds ?? (actor.customRoleIds?.length ? [] : accessRoleIds(actor));
  if (!direct.includes("system_administrator")) throw new HttpsError("permission-denied", "Only a system administrator may correct a sale entered in error.", { code: "SALE_ERROR_ADMIN_REQUIRED", retryable: false });
}
