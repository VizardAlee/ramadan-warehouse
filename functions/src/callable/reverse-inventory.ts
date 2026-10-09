import { onCall } from "firebase-functions/v2/https";
import { requireAccess, requirePermission } from "../auth/authorize.js";
import { enforceAppCheck } from "../config.js";
import { reverseInventoryPosting } from "../inventory/reverse-inventory-posting.js";
import { parseInput } from "../utils/callable.js";
import { reversalInput } from "../validation/inventory.js";

export const reverseInventoryTransaction = onCall({ enforceAppCheck, timeoutSeconds: 60 }, async request => {
  const actor = await requireAccess(request);
  requirePermission(actor, "inventory.reverse");
  return reverseInventoryPosting(actor, parseInput(reversalInput, request.data));
});
