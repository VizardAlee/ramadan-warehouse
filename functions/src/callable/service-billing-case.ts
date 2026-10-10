import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import { db } from "../admin.js";
import { hasServerPermission, requireAccess, requireBranchScope, requirePermission } from "../auth/authorize.js";
import { enforceAppCheck } from "../config.js";
import { parseInput } from "../utils/callable.js";
const caseSchema = z.object({ caseId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), branchId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), serviceItemId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), customerId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional() });
export const getServiceBillingCase = onCall({ enforceAppCheck }, async request => {
  const actor = await requireAccess(request);
  if (request.data?.action === "providers") {
    if (!hasServerPermission(actor, "sales.order.create")) requirePermission(actor, "expenses.read");
    const input = parseInput(z.object({ action: z.literal("providers"), cursorId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional() }), request.data);
    let query = db.collection("suppliers").where("organizationId", "==", actor.organizationId).where("active", "==", true).orderBy("__name__");
    if (input.cursorId) {
      const cursor = await db.doc(`suppliers/${input.cursorId}`).get();
      if (!cursor.exists || cursor.get("organizationId") !== actor.organizationId || cursor.get("active") !== true) throw new HttpsError("invalid-argument", "Provider page changed. Reload the selector.");
      query = query.startAfter(cursor);
    }
    const page = await query.limit(101).get(), selected = page.docs.slice(0, 100);
    return { providers: selected.map(doc => ({ id: doc.id, name: doc.get("name"), supplierType: doc.get("supplierType") ?? "goods" })), nextCursorId: page.size > 100 ? selected.at(-1)!.id : null };
  }
  requirePermission(actor, "sales.order.create");
  const input = parseInput(caseSchema, request.data); requireBranchScope(actor, input.branchId);
  const doc = await db.doc(`aftersalesCases/${input.caseId}`).get();
  if (!doc.exists || doc.get("organizationId") !== actor.organizationId || doc.get("branchId") !== input.branchId || doc.get("serviceCatalog.itemId") !== input.serviceItemId || (doc.get("customerId") && doc.get("customerId") !== input.customerId)) throw new HttpsError("not-found", "A matching service case was not found for this store, service and customer.");
  if (doc.get("billingSaleId") || doc.get("serviceBillingVersion") !== 2 || !["due", "partially_paid", "paid"].includes(doc.get("chargeStatus")) || ["cancelled", "rejected"].includes(doc.get("status"))) throw new HttpsError("failed-precondition", "This case is already billed or needs reconciliation before linking.");
  return { id: doc.id, caseNumber: doc.get("caseNumber") ?? doc.id, grossMinor: doc.get("chargeAmountMinor"), vatMinor: doc.get("chargeVatMinor"), paidMinor: doc.get("amountPaidMinor") ?? 0 };
});
