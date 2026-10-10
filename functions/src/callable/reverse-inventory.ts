import { onCall } from "firebase-functions/v2/https";
import { requireAccess, requirePermission } from "../auth/authorize.js";
import { enforceAppCheck } from "../config.js";
import { reverseInventoryPosting } from "../inventory/reverse-inventory-posting.js";
import { parseInput } from "../utils/callable.js";
import { reversalInput } from "../validation/inventory.js";
import { stockAccountingReversal } from "../accounting/stock-postings.js";
import { correlationId } from "../utils/callable.js";

export const reverseInventoryTransaction = onCall({ enforceAppCheck, timeoutSeconds: 60 }, async request => {
  const actor = await requireAccess(request);
  requirePermission(actor, "inventory.reverse");
  const input = parseInput(reversalInput, request.data);
  return reverseInventoryPosting(actor, input, await stockAccountingReversal(actor, input.transactionId, input.reason, correlationId()));
});
