import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import { hasServerPermission, requireAccess, requirePermission } from "../auth/authorize.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { enforceAppCheck } from "../config.js";
import { uniquenessDocumentId } from "../inventory/calculations.js";
import { calculateReviewedTax, definitionFromRecord, periodsOverlap, taxRuleAdministrationInput } from "../tax/rules.js";
import { correlationId, parseInput } from "../utils/callable.js";

const fail = (message: string): never => { throw new HttpsError("failed-precondition", message); };
export const taxRuleAdministration = onCall({ enforceAppCheck }, async request => {
  const actor = await requireAccess(request);
  const input = parseInput(taxRuleAdministrationInput, request.data);
  requirePermission(actor, input.action === "preview" ? "finance.journal.read" : "finance.tax.manage");
  if (!hasServerPermission(actor, "sales.read.all")) throw new HttpsError("permission-denied", "Tax configuration requires organization-wide finance access.");
  if (input.action === "preview") {
    const record = await db.doc(`taxRules/${input.ruleId}`).get();
    if (!record.exists || record.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Tax rule not found.");
    if (record.get("status") !== "approved" || record.get("sourceVerified") !== true) fail("Only a reviewed, approved rule can calculate tax.");
    try { return { ruleId: record.id, previewOnly: true, ...calculateReviewedTax(definitionFromRecord(record.data()!), input.transactionDate, input.baseMinor) }; }
    catch { return fail("The rule or date is invalid. Review the rule and the accountant-confirmed tax base; no tax was posted."); }
  }
  const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const operation = db.doc(`idempotencyOperations/${uniquenessDocumentId(actor.organizationId, "taxRuleAdministration", input.idempotencyKey)}`);
  return db.runTransaction(async transaction => {
    const previous = await transaction.get(operation);
    if (previous.exists) {
      if (previous.get("organizationId") !== actor.organizationId || previous.get("fingerprint") !== fingerprint) fail("This retry key belongs to different tax instructions.");
      return previous.get("result");
    }
    const ref = db.doc(`taxRules/${input.action === "propose" ? uniquenessDocumentId(actor.organizationId, input.definition.taxType, input.definition.scopeKey, input.definition.version) : input.ruleId}`);
    const current = await transaction.get(ref);
    let result: { ruleId: string; status: string };
    if (input.action === "propose") {
      if (current.exists) fail("This rule version already exists. Propose a new version instead of changing its history.");
      transaction.create(ref, { organizationId: actor.organizationId, ...input.definition, status: "draft", sourceVerified: false,
        createdBy: actor.userId, createdAt: FieldValue.serverTimestamp(), proposalReason: input.reason });
      result = { ruleId: ref.id, status: "draft" };
      writeAuditLog(transaction, actor, { action: "tax.rule_proposed", entityType: "taxRule", entityId: ref.id, reason: input.reason,
        correlationId: correlationId(), sourceFunction: "taxRuleAdministration", after: { ...input.definition, status: "draft" } });
    } else {
      if (!current.exists || current.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Tax rule not found.");
      if (current.get("status") !== "draft") fail("A reviewed rule cannot be edited or reviewed again. Propose a new version.");
      let definition;
      try { definition = definitionFromRecord(current.data()!); } catch { return fail("This legacy rule requires a new structured version before review."); }
      if (input.decision === "approved") {
        if (!input.sourceVerified) fail("Confirm the statutory source, applicability, exemptions and calculation basis before approving.");
        const lock = db.doc(`taxRuleLocks/${uniquenessDocumentId(actor.organizationId, definition.taxType, definition.scopeKey)}`);
        await transaction.get(lock);
        const family = await transaction.get(db.collection("taxRules").where("organizationId", "==", actor.organizationId)
          .where("taxType", "==", definition.taxType).where("scopeKey", "==", definition.scopeKey).limit(201));
        if (family.size > 200) fail("This tax-rule family needs archival-aware paging before further approvals. No rules were silently omitted.");
        for (const other of family.docs) {
          if (other.id === ref.id || !["approved", "active"].includes(other.get("status"))) continue;
          const data = other.data();
          if (typeof data.effectiveFrom !== "string" || typeof data.effectiveTo !== "string" || periodsOverlap(definition, data as typeof definition))
            fail("An approved rule already covers this scope and period, or lacks a bounded end date. Reconcile its coverage before approving another version.");
        }
        transaction.set(lock, { organizationId: actor.organizationId, taxType: definition.taxType, scopeKey: definition.scopeKey, updatedAt: FieldValue.serverTimestamp(), lastApprovedRuleId: ref.id });
      }
      transaction.update(ref, { status: input.decision, sourceVerified: input.sourceVerified, reviewedBy: actor.userId, reviewedAt: FieldValue.serverTimestamp(), reviewReason: input.reason });
      result = { ruleId: ref.id, status: input.decision };
      writeAuditLog(transaction, actor, { action: `tax.rule_${input.decision}`, entityType: "taxRule", entityId: ref.id, reason: input.reason,
        correlationId: correlationId(), sourceFunction: "taxRuleAdministration", before: { status: "draft" }, after: { status: input.decision, definition, sourceVerified: input.sourceVerified } });
    }
    transaction.create(operation, { organizationId: actor.organizationId, fingerprint, result, createdAt: FieldValue.serverTimestamp() });
    return result;
  });
});
