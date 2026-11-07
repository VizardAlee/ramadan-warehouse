import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { db } from "../admin.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import type { ScopedAccess } from "../auth/permission-scope.js";
import { correlationId, parseInput } from "../utils/callable.js";
import { requireCustomerView } from "./customer-scope.js";

const statusInput = z.object({
  customerId: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/),
  active: z.boolean(),
  confirmedCustomerNumber: z.string().min(1).max(100),
  idempotencyKey: z.string().uuid(),
});
export function customerDeactivationBlocked(customer: Record<string, unknown>) {
  return Number(customer.outstandingBalanceMinor ?? 0) > 0 ||
    Object.values((customer.advanceBalances ?? {}) as Record<string, number>).some(amount => amount > 0);
}
/** Change only availability, never erase or rewrite customer financial history. */
export async function setCustomerStatus(actor: ScopedAccess, data: unknown) {
  const input = parseInput(statusInput, data);
  const customer = db.doc(`customers/${input.customerId}`);
  const operation = db.doc(`idempotencyKeys/${actor.organizationId}_customerStatus_${input.idempotencyKey}`);
  const fingerprint = createHash("sha256").update(JSON.stringify([actor.userId, input])).digest("hex");
  const cid = correlationId();
  return db.runTransaction(async transaction => {
    const [current, prior] = await transaction.getAll(customer, operation);
    if (!current!.exists || current!.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Customer not found.");
    requireCustomerView(actor, current!.data()!, "customers.manage");
    if (prior!.exists) {
      if (prior!.get("fingerprint") !== fingerprint) throw new HttpsError("already-exists", "This retry belongs to a different customer status change.");
      return { saved: false };
    }
    if (input.confirmedCustomerNumber !== current!.get("customerNumber")) throw new HttpsError("invalid-argument", "Enter the customer number exactly to confirm.");
    if (!input.active && customerDeactivationBlocked(current!.data()!)) throw new HttpsError("failed-precondition", "Settle outstanding debt and unused advances before deactivating this customer. History and balances will not be deleted.");
    const now = FieldValue.serverTimestamp();
    transaction.update(customer, { active: input.active, updatedAt: now, updatedBy: actor.userId });
    transaction.create(operation, { organizationId: actor.organizationId, action: "customerStatus", entityId: customer.id, fingerprint, createdAt: now, createdBy: actor.userId });
    writeAuditLog(transaction, actor, { action: input.active ? "customer.reactivated" : "customer.deactivated", entityType: "customer", entityId: customer.id, correlationId: cid, sourceFunction: "saveCustomer", before: { active: current!.get("active") }, after: { active: input.active } });
    return { saved: true };
  });
}
