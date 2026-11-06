import { createHash } from "node:crypto";
import { FieldPath, FieldValue, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { db } from "../admin.js";
import { requirePermission, type AccessProfile } from "../auth/authorize.js";
import { requireAllLocations } from "../auth/view-scope.js";
import { requireSaleErrorAdministrator } from "./error-correction-authority.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { correlationId, parseInput } from "../utils/callable.js";
import { analyzeCustomerOwnership, ownershipCollections, type OwnershipRecord } from "./customer-ownership-analysis.js";

const id = z.string().trim().min(1).max(160).regex(/^[^/]+$/);
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ownership_list"), cursor: id.optional(), limit: z.number().int().min(1).max(25).default(10) }),
  z.object({ action: z.literal("ownership_detail"), customerId: id }),
  z.object({ action: z.literal("ownership_assign"), customerId: id, branchId: id, expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/), confirmedCustomerNumber: z.string().min(1).max(160), acknowledgeHistoryUnchanged: z.literal(true), reason: z.string().trim().min(5).max(1000), idempotencyKey: z.string().uuid() }),
]);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const ownershipActions = ["ownership_list", "ownership_detail", "ownership_assign"];

async function evidence(organizationId: string, customerId: string, tx?: Transaction) {
  const customerRef = db.doc(`customers/${customerId}`);
  const branchQuery = db.collection("branches").where("organizationId", "==", organizationId).limit(101);
  const customer = tx ? await tx.get(customerRef) : await customerRef.get();
  if (!customer.exists || customer.get("organizationId") !== organizationId) throw new HttpsError("not-found", "Customer not found in this organization.");
  const branchPage = tx ? await tx.get(branchQuery) : await branchQuery.get();
  if (branchPage.size > 100) throw new HttpsError("resource-exhausted", "This organization requires an accountant-assisted ownership review.");
  const pages = await Promise.all(ownershipCollections.map(collection => {
    const query = db.collection(collection).where("organizationId", "==", organizationId).where("customerId", "==", customerId).limit(501);
    return tx ? tx.get(query) : query.get();
  }));
  const records: OwnershipRecord[] = pages.flatMap((page, index) => page.docs.map(doc => ({ id: doc.id, collection: ownershipCollections[index]!, data: doc.data() })));
  const branches = branchPage.docs.map(branch => ({ id: branch.id, name: String(branch.get("name") ?? branch.id), status: String(branch.get("status")) }));
  const analysis = analyzeCustomerOwnership(customer.data()!, branches, records, pages.every(page => page.size <= 500));
  const fingerprint = hash([customer.updateTime?.valueOf(), customer.data(), branchPage.docs.map(branch => [branch.id, branch.updateTime?.valueOf()]), pages.map(page => page.docs.map(doc => [doc.id, doc.updateTime?.valueOf()]))]);
  return { customer, branches, analysis, fingerprint };
}
function projection(value: Awaited<ReturnType<typeof evidence>>) {
  return { customerId: value.customer.id, customerNumber: String(value.customer.get("customerNumber") ?? value.customer.id), name: String(value.customer.get("name") ?? "Customer"), ...value.analysis, branches: value.branches, fingerprint: value.fingerprint };
}

/** Administrator-only, All-locations review. Assignment never edits posted evidence. */
export async function customerOwnership(actor: AccessProfile, raw: unknown) {
  try { requireSaleErrorAdministrator(actor); } catch { throw new HttpsError("permission-denied", "Only a System Administrator may review or assign customer ownership.", { code: "CUSTOMER_OWNERSHIP_ADMIN_REQUIRED" }); }
  requirePermission(actor, "customers.manage");
  requireAllLocations(actor);
  const input = parseInput(schema, raw);
  if (input.action === "ownership_list") {
    let query = db.collection("customers").where("organizationId", "==", actor.organizationId).orderBy(FieldPath.documentId());
    if (input.cursor) query = query.startAfter(input.cursor);
    const page = await query.limit(input.limit + 1).get(), rows = [];
    // Bound simultaneous financial evidence reads on large registers.
    for (const customer of page.docs.slice(0, input.limit)) rows.push(projection(await evidence(actor.organizationId, customer.id)));
    return { rows, nextCursor: page.size > input.limit ? page.docs[input.limit - 1]!.id : null };
  }
  if (input.action === "ownership_detail") return projection(await evidence(actor.organizationId, input.customerId));
  const operation = db.doc(`idempotencyKeys/${actor.organizationId}_customerOwnership_${input.idempotencyKey}`);
  const review = db.collection("customerOwnershipReviews").doc(), cid = correlationId();
  const fingerprint = hash(input);
  return db.runTransaction(async tx => {
    const previous = await tx.get(operation);
    if (previous.exists) {
      if (previous.get("fingerprint") !== fingerprint || previous.get("actorUserId") !== actor.userId) throw new HttpsError("already-exists", "This retry reference belongs to different ownership instructions.");
      return previous.get("result");
    }
    const current = await evidence(actor.organizationId, input.customerId, tx);
    if (current.fingerprint !== input.expectedFingerprint) throw new HttpsError("failed-precondition", "Customer or financial activity changed. Refresh and review the evidence again.", { code: "CUSTOMER_OWNERSHIP_STALE" });
    if (input.confirmedCustomerNumber !== String(current.customer.get("customerNumber") ?? current.customer.id)) throw new HttpsError("invalid-argument", "Enter the exact customer number shown in this review.");
    if (current.analysis.currentBranchId === input.branchId) throw new HttpsError("failed-precondition", "This customer already belongs to that branch.");
    if (!current.analysis.allowedTargetBranchIds.includes(input.branchId)) throw new HttpsError("failed-precondition", "The recorded history or balances require accounting review. No ownership or posted record was changed.", { code: "CUSTOMER_OWNERSHIP_REVIEW_REQUIRED" });
    const now = FieldValue.serverTimestamp();
    const result = { customerId: input.customerId, branchId: input.branchId, reviewId: review.id, saved: true };
    tx.update(current.customer.ref, { branchId: input.branchId, ownershipVersion: Number(current.customer.get("ownershipVersion") ?? 0) + 1, ownershipReviewedBy: actor.userId, ownershipReviewedAt: now, ownershipReviewId: review.id, updatedAt: now, updatedBy: actor.userId });
    tx.create(review, { organizationId: actor.organizationId, customerId: input.customerId, customerNumber: input.confirmedCustomerNumber, fromBranchId: current.analysis.currentBranchId, toBranchId: input.branchId, reason: input.reason, evidence: current.analysis, evidenceFingerprint: current.fingerprint, reviewedBy: actor.userId, reviewedAt: now, postedHistoryChanged: false });
    tx.create(operation, { organizationId: actor.organizationId, actorUserId: actor.userId, fingerprint, result, createdAt: now });
    writeAuditLog(tx, actor, { action: "customer.branch_ownership_reviewed", entityType: "customer", entityId: input.customerId, sourceFunction: "getCustomerHistory", correlationId: cid, reason: input.reason, before: { branchId: current.analysis.currentBranchId }, after: { branchId: input.branchId, reviewId: review.id, postedHistoryChanged: false } });
    return result;
  });
}
