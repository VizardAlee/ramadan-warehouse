import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import { db } from "../admin.js";
import { canSelfAuthorize, requireAccess, requireBranchScope, requirePermission } from "../auth/authorize.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { enforceAppCheck } from "../config.js";
import { uniquenessDocumentId } from "../inventory/calculations.js";
import { correlationId, parseInput } from "../utils/callable.js";

const id = z.string().trim().min(1).max(160).regex(/^[^/]+$/);
export const correctionProposal = z.object({
  customerId: id.nullable(),
  discountAmountMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  lines: z.array(z.object({ productId: id, quantity: z.number().int().positive().max(100000), unitPriceMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) })).min(1).max(50),
  details: z.string().trim().min(5).max(2000),
}).superRefine((value, context) => {
  if (new Set(value.lines.map(line => line.productId)).size !== value.lines.length)
    context.addIssue({ code: "custom", path: ["lines"], message: "Choose each proposed product once." });
  const subtotal = value.lines.reduce((sum, line) => sum + line.quantity * line.unitPriceMinor, 0);
  if (!Number.isSafeInteger(subtotal) || value.discountAmountMinor >= subtotal)
    context.addIssue({ code: "custom", path: ["discountAmountMinor"], message: "Use a valid subtotal and a discount smaller than that subtotal." });
});
const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), branchId: id, status: z.enum(["submitted", "approved", "rejected", "completed"]), limit: z.number().int().min(1).max(100).default(25), cursor: id.optional() }),
  z.object({ action: z.literal("request"), branchId: id, receiptNumber: id, reason: z.string().trim().min(5).max(1000), proposedValues: correctionProposal, idempotencyKey: z.string().uuid() }),
  z.object({ action: z.literal("review"), correctionId: id, decision: z.enum(["approved", "rejected"]), reason: z.string().trim().min(5).max(1000), idempotencyKey: z.string().uuid() }),
  z.object({ action: z.literal("complete"), correctionId: id, returnNumbers: z.array(id).min(1).max(20), replacementNumber: id, reason: z.string().trim().min(5).max(1000), idempotencyKey: z.string().uuid() }),
]);
export function canonicalCorrectionLines(lines: Array<{ productId: string; quantity: number; unitPriceMinor: number }>) {
  return JSON.stringify(lines.map(line => ({ productId: line.productId, quantity: line.quantity, unitPriceMinor: line.unitPriceMinor })).sort((a, b) => a.productId.localeCompare(b.productId)));
}
async function assertUnreversedItems(tx: FirebaseFirestore.Transaction, organizationId: string, items: FirebaseFirestore.QueryDocumentSnapshot[]) {
  if (!items.length || items.length > 50) throw new HttpsError("failed-precondition", "This sale requires an accountant-assisted correction.");
  const counters = await tx.getAll(...items.map(item => db.doc(`saleReturnItemCounters/${uniquenessDocumentId(organizationId, "saleReturnItem", item.id)}`)));
  if (items.some(item => Number(item.get("cancelledQuantity") ?? 0) > 0) || counters.some(counter => Number(counter.get("returnedQuantity") ?? 0) > 0 || Number(counter.get("reversedNetAmountMinor") ?? 0) > 0 || Number(counter.get("reversedVatAmountMinor") ?? 0) > 0)) throw new HttpsError("failed-precondition", "This order already has a posted return or cancellation. Use accountant-assisted correction rather than a new full reissue.");
}
export const salesCorrections = onCall({ enforceAppCheck, timeoutSeconds: 60 }, async request => {
  try {
  const actor = await requireAccess(request), input = parseInput(inputSchema, request.data);
  requirePermission(actor, input.action === "list" ? "sales.returns.read" : input.action === "request" ? "sales.returns.create" : "sales.returns.approve");
  if (input.action === "list") {
    requireBranchScope(actor, input.branchId);
    let query = db.collection("saleCorrectionRequests").where("organizationId", "==", actor.organizationId).where("branchId", "==", input.branchId).where("status", "==", input.status);
    if (input.cursor) {
      const cursor = await db.doc(`saleCorrectionRequests/${input.cursor}`).get();
      if (!cursor.exists || cursor.get("organizationId") !== actor.organizationId || cursor.get("branchId") !== input.branchId || cursor.get("status") !== input.status) throw new HttpsError("invalid-argument", "Start from the first corrections page.");
      query = query.startAfter(cursor);
    }
    const page = await query.limit(input.limit + 1).get(), visible = page.docs.slice(0, input.limit);
    return { records: visible.map(doc => ({ id: doc.id, ...doc.data() })), nextCursor: page.size > input.limit ? visible.at(-1)!.id : null };
  }
  const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const op = db.doc(`idempotencyKeys/${actor.organizationId}_salesCorrection_${input.idempotencyKey}`);
  const cid = correlationId(), generated = db.collection("saleCorrectionRequests").doc();
  return db.runTransaction(async tx => {
    const previous = await tx.get(op);
    if (previous.exists) {
      if (previous.get("fingerprint") !== fingerprint) throw new HttpsError("already-exists", "This retry reference belongs to different correction instructions.");
      requireBranchScope(actor, String(previous.get("branchId")));
      return previous.get("result");
    }
    const now = FieldValue.serverTimestamp();
    if (input.action === "request") {
      requireBranchScope(actor, input.branchId);
      let saleQuery = await tx.get(db.collection("sales").where("organizationId", "==", actor.organizationId).where("branchId", "==", input.branchId).where("receiptNumber", "==", input.receiptNumber).limit(1));
      if (saleQuery.empty) saleQuery = await tx.get(db.collection("sales").where("organizationId", "==", actor.organizationId).where("branchId", "==", input.branchId).where("saleNumber", "==", input.receiptNumber).limit(1));
      const sale = saleQuery.docs[0];
      if (!sale || sale.get("status") !== "completed") throw new HttpsError("failed-precondition", "Select an original completed sale.");
      const originalLock = db.doc(`saleCorrectionEvidence/${actor.organizationId}_original_${sale.id}`), lock = await tx.get(originalLock);
      if (lock.exists && lock.get("status") !== "released") throw new HttpsError("failed-precondition", "This sale already has an active or completed full-reissue correction. Continue that request instead.");
      const items = await tx.get(db.collection("saleItems").where("saleId", "==", sale.id).limit(51));
      await assertUnreversedItems(tx, actor.organizationId, items.docs);
      const products = await tx.getAll(...input.proposedValues.lines.map(line => db.doc(`products/${line.productId}`)));
      if (products.some(product => !product.exists || product.get("organizationId") !== actor.organizationId || product.get("active") !== true)) throw new HttpsError("failed-precondition", "Choose active products from this organization.");
      let customerName: string | null = null;
      if (input.proposedValues.customerId) {
        const customer = await tx.get(db.doc(`customers/${input.proposedValues.customerId}`));
        if (!customer.exists || customer.get("organizationId") !== actor.organizationId || !customer.get("active")) throw new HttpsError("failed-precondition", "Choose an active customer from this organization.");
        customerName = String(customer.get("name"));
      }
      const proposedValues = { ...input.proposedValues, customerName, lines: input.proposedValues.lines.map((line, index) => ({ ...line, productName: String(products[index]!.get("name")) })) };
      const result = { correctionId: generated.id, status: "submitted" };
      tx.set(originalLock, { organizationId: actor.organizationId, branchId: input.branchId, correctionId: generated.id, status: "active", createdAt: now });
      tx.create(generated, { organizationId: actor.organizationId, branchId: input.branchId, correctionNumber: `COR-${generated.id.slice(0, 10).toUpperCase()}`, saleId: sale.id, saleNumber: sale.get("saleNumber"), receiptNumber: sale.get("receiptNumber"), status: "submitted", kind: "return_and_reissue", reason: input.reason, originalValues: { customerId: sale.get("customerId") ?? null, customerName: sale.get("customerName") ?? null, grossAmountMinor: sale.get("grossAmountMinor"), journalEntryId: sale.get("journalEntryId") ?? null, lines: items.docs.map(item => ({ saleItemId: item.id, productId: item.get("productId"), productName: item.get("productName"), quantity: item.get("quantity"), unitPriceMinor: item.get("unitPriceMinor") })) }, proposedValues, requestedBy: actor.userId, requestedAt: now, createdAt: now, updatedAt: now });
      tx.create(op, { organizationId: actor.organizationId, branchId: input.branchId, fingerprint, result, createdAt: now });
      writeAuditLog(tx, actor, { action: "sale_correction.requested", entityType: "saleCorrection", entityId: generated.id, sourceFunction: "salesCorrections", correlationId: cid, reason: input.reason, after: { saleId: sale.id, proposedValues: input.proposedValues } });
      return result;
    }
    const reference = db.doc(`saleCorrectionRequests/${input.correctionId}`), correction = await tx.get(reference);
    if (!correction.exists || correction.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Correction request not found.");
    requireBranchScope(actor, String(correction.get("branchId")));
    const originalLock = db.doc(`saleCorrectionEvidence/${actor.organizationId}_original_${correction.get("saleId")}`), lock = await tx.get(originalLock);
    if (!lock.exists || lock.get("correctionId") !== correction.id || lock.get("status") !== "active") throw new HttpsError("failed-precondition", "The original sale's correction control is unavailable.");
    if (input.action === "review") {
      if (correction.get("status") !== "submitted") throw new HttpsError("failed-precondition", "Only a submitted correction can be reviewed.");
      if (correction.get("requestedBy") === actor.userId && !canSelfAuthorize(actor)) throw new HttpsError("permission-denied", "This role requires another authorized reviewer.");
      if (input.decision === "approved") {
        const items = await tx.get(db.collection("saleItems").where("saleId", "==", correction.get("saleId")).limit(51));
        await assertUnreversedItems(tx, actor.organizationId, items.docs);
      }
      tx.update(reference, { status: input.decision, reviewReason: input.reason, reviewedBy: actor.userId, reviewedAt: now, updatedAt: now });
      if (input.decision === "rejected") tx.update(originalLock, { status: "released", updatedAt: now });
    } else {
      if (correction.get("status") !== "approved" || new Set(input.returnNumbers).size !== input.returnNumbers.length) throw new HttpsError("failed-precondition", "Select an approved correction and distinct posted returns.");
      const returnPages = await Promise.all(input.returnNumbers.map(number => tx.get(db.collection("saleReturns").where("organizationId", "==", actor.organizationId).where("branchId", "==", correction.get("branchId")).where("returnNumber", "==", number).limit(1))));
      if (returnPages.some(page => page.empty)) throw new HttpsError("not-found", "A return number was not found in this store.");
      const returns = returnPages.map(page => page.docs[0]!);
      const approvedAt = correction.get("reviewedAt").toMillis();
      if (returns.some(record => !record.exists || record.get("organizationId") !== actor.organizationId || record.get("branchId") !== correction.get("branchId") || record.get("saleId") !== correction.get("saleId") || record.get("status") !== "approved" || (record.get("approvedAt")?.toMillis() ?? 0) < approvedAt)) throw new HttpsError("failed-precondition", "Use approved returns/cancellations posted for this original sale after correction approval.");
      const returnedItems = await Promise.all(returns.map(record => tx.get(db.collection("saleReturnItems").where("returnId", "==", record.id).limit(51))));
      if (returnedItems.some(page => page.empty || page.size > 50)) throw new HttpsError("failed-precondition", "Return evidence is incomplete or needs accountant-assisted review.");
      const quantities = new Map<string, number>();
      for (const page of returnedItems) for (const item of page.docs) {
        if (item.get("organizationId") !== actor.organizationId) throw new HttpsError("failed-precondition", "Return evidence scope mismatch.");
        quantities.set(String(item.get("saleItemId")), (quantities.get(String(item.get("saleItemId"))) ?? 0) + Number(item.get("quantity")));
      }
      const original = correction.get("originalValues") as { grossAmountMinor: number; lines: Array<{ saleItemId: string; quantity: number }> };
      if (quantities.size !== original.lines.length || original.lines.some(line => quantities.get(line.saleItemId) !== line.quantity) || returns.reduce((sum, record) => sum + Number(record.get("grossAmountMinor")), 0) !== original.grossAmountMinor) throw new HttpsError("failed-precondition", "Reverse the complete original order through the existing controlled return/cancellation workflow before linking a full reissue.");
      const replacementQuery = await tx.get(db.collection("sales").where("organizationId", "==", actor.organizationId).where("branchId", "==", correction.get("branchId")).where("saleNumber", "==", input.replacementNumber).limit(1));
      const replacement = replacementQuery.docs[0];
      if (!replacement || replacement.id === correction.get("saleId") || replacement.get("status") !== "completed" || (replacement.get("createdAt")?.toMillis() ?? 0) < approvedAt) throw new HttpsError("failed-precondition", "Select a completed replacement sale created after approval.");
      const replacementItems = await tx.get(db.collection("saleItems").where("saleId", "==", replacement.id).limit(51));
      const proposed = correction.get("proposedValues") as z.infer<typeof correctionProposal>;
      if ((replacement.get("customerId") ?? null) !== proposed.customerId || Number(replacement.get("discountAmountMinor") ?? 0) !== proposed.discountAmountMinor || canonicalCorrectionLines(replacementItems.docs.map(item => ({ productId: String(item.get("productId")), quantity: Number(item.get("quantity")), unitPriceMinor: Number(item.get("unitPriceMinor")) }))) !== canonicalCorrectionLines(proposed.lines)) throw new HttpsError("failed-precondition", "Replacement customer, products, quantities, unit prices and discount must match the approved proposal.");
      const replacementJournals = await tx.get(db.collection("journalEntries").where("organizationId", "==", actor.organizationId).where("referenceId", "==", replacement.id).limit(10));
      const replacementJournal = replacementJournals.docs.find(journal => journal.get("referenceType") === "sale");
      const journalIds = [...returns.map(record => record.get("journalEntryId")), replacementJournal?.id];
      if (journalIds.some(id => typeof id !== "string" || !id)) throw new HttpsError("failed-precondition", "Posted accounting evidence is incomplete.");
      const journals = await tx.getAll(...journalIds.map(id => db.doc(`journalEntries/${id}`)));
      if (journals.some(journal => !journal.exists || journal.get("organizationId") !== actor.organizationId || journal.get("branchId") !== correction.get("branchId") || journal.get("status") !== "posted" || journal.get("totalDebitMinor") !== journal.get("totalCreditMinor"))) throw new HttpsError("failed-precondition", "Every linked journal must be posted, balanced and in the correction's store.");
      if (journals.some((journal, index) => journal.get("referenceId") !== (index < returns.length ? returns[index]!.id : replacement.id) || journal.get("referenceType") !== (index < returns.length ? "saleReturn" : "sale"))) throw new HttpsError("failed-precondition", "Accounting evidence must reference the linked return or replacement itself.");
      const inventoryIds = returns.map(record => record.get("inventoryTransactionId")).filter((id): id is string => typeof id === "string" && Boolean(id));
      const movements = inventoryIds.length ? await tx.getAll(...inventoryIds.map(id => db.doc(`inventoryTransactions/${id}`))) : [];
      if (movements.some(movement => !movement.exists || movement.get("organizationId") !== actor.organizationId || movement.get("status") !== "posted" || !returns.some(record => record.id === movement.get("referenceId") && record.get("inventoryTransactionId") === movement.id))) throw new HttpsError("failed-precondition", "Linked stock movements must be posted for these returns.");
      const evidenceRefs = [...returns.map(record => `return_${record.id}`), `sale_${replacement.id}`].map(key => db.doc(`saleCorrectionEvidence/${actor.organizationId}_${key}`));
      const evidence = await tx.getAll(...evidenceRefs);
      if (evidence.some(record => record.exists)) throw new HttpsError("already-exists", "A linked transaction is already assigned to another correction.");
      evidenceRefs.forEach(ref => tx.create(ref, { organizationId: actor.organizationId, branchId: correction.get("branchId"), correctionId: correction.id, createdAt: now }));
      tx.update(originalLock, { status: "completed", updatedAt: now });
      tx.update(reference, { status: "completed", returnIds: returns.map(record => record.id), returnNumbers: input.returnNumbers, replacementSaleId: replacement.id, replacementSaleNumber: replacement.get("saleNumber"), journalEntryIds: journalIds, inventoryTransactionIds: returns.map(record => record.get("inventoryTransactionId")).filter(Boolean), completionReason: input.reason, completedBy: actor.userId, completedAt: now, updatedAt: now });
    }
    const status = input.action === "review" ? input.decision : "completed", result = { correctionId: correction.id, status };
    tx.create(op, { organizationId: actor.organizationId, branchId: correction.get("branchId"), fingerprint, result, createdAt: now });
    writeAuditLog(tx, actor, { action: `sale_correction.${status}`, entityType: "saleCorrection", entityId: correction.id, sourceFunction: "salesCorrections", correlationId: cid, reason: input.reason, before: { status: correction.get("status") }, after: { status, ...(input.action === "complete" ? { returnNumbers: input.returnNumbers, replacementNumber: input.replacementNumber } : {}) } });
    return result;
  });
  } catch (error) {
    if (error instanceof HttpsError && ["failed-precondition", "already-exists", "not-found"].includes(error.code)) throw new HttpsError(error.code, error.message, { code: "SALE_CORRECTION_ACTION_REQUIRED", userMessage: error.message });
    throw error;
  }
});
