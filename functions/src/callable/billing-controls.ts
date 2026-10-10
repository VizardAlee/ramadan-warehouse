import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import { db } from "../admin.js";
import { hasServerPermission, requireAccess, requirePermission } from "../auth/authorize.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { billingAccountSnapshot } from "../billing/mappings.js";
import { enforceAppCheck } from "../config.js";
import { uniquenessDocumentId } from "../inventory/calculations.js";
import { correlationId, parseInput } from "../utils/callable.js";
import { canConfigureManualAccount } from "../validation/manual-journals.js";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,180}$/);
const schema = z.discriminatedUnion("action", [z.object({ action: z.literal("workspace") }), z.object({ action: z.literal("save"), deferredServiceAccountId: id, providerPayableAccountId: id, expectedVersion: z.number().int().nonnegative().safe(), reason: z.string().trim().min(5).max(500), idempotencyKey: z.string().uuid() })]);
const fail = (message: string): never => { throw new HttpsError("failed-precondition", message); };
export const billingControls = onCall({ enforceAppCheck }, async request => {
  const actor = await requireAccess(request); requirePermission(actor, "finance.accounts.manage");
  if (!hasServerPermission(actor, "sales.read.all")) throw new HttpsError("permission-denied", "Company billing controls require organization-wide accounting access.");
  const input = parseInput(schema, request.data), ref = db.doc(`billingConfigurations/${actor.organizationId}`);
  if (input.action === "workspace") {
    const [config, accounts] = await Promise.all([ref.get(), db.collection("chartOfAccounts").where("organizationId", "==", actor.organizationId).limit(501).get()]);
    if (accounts.size > 500) fail("A paged account selector is required. No accounts were silently omitted.");
    return { mapping: config.get("mapping") ?? null, accounts: accounts.docs.filter(doc => /^2\d{3}$/.test(String(doc.get("code"))) && canConfigureManualAccount(String(doc.get("code"))) && doc.get("active") === true && doc.get("currency") === "NGN").map(doc => ({ ...billingAccountSnapshot(doc), purpose: doc.get("billingControlPurpose") ?? null })) };
  }
  const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex"), op = db.doc(`idempotencyOperations/${uniquenessDocumentId(actor.organizationId, "billingControls", input.idempotencyKey)}`);
  return db.runTransaction(async transaction => {
    const previous = await transaction.get(op);
    if (previous.exists) { if (previous.get("fingerprint") !== fingerprint || previous.get("organizationId") !== actor.organizationId) fail("This retry key belongs to different billing configuration."); return previous.get("result"); }
    const config = await transaction.get(ref), currentVersion = config.get("mapping.version") ?? 0;
    if (currentVersion !== input.expectedVersion) fail("Billing controls changed. Refresh and review the current mappings.");
    if (input.deferredServiceAccountId === input.providerPayableAccountId) fail("Service deferral and provider funds need distinct liability accounts.");
    const docs = await Promise.all([input.deferredServiceAccountId, input.providerPayableAccountId].map(accountId => transaction.get(db.doc(`chartOfAccounts/${accountId}`))));
    for (const [i, doc] of docs.entries()) {
      const purpose = i === 0 ? "deferred_service" : "provider_payable", code = String(doc.get("code"));
      if (!doc.exists || doc.get("organizationId") !== actor.organizationId || doc.get("active") !== true || doc.get("currency") !== "NGN" || !/^2\d{3}$/.test(code) || !canConfigureManualAccount(code) || !String(doc.get("name") ?? "").trim() || (doc.get("billingControlPurpose") && doc.get("billingControlPurpose") !== purpose)) fail("Select reviewed, active NGN liability accounts dedicated to these two purposes.");
      const duplicate = await transaction.get(db.collection("chartOfAccounts").where("organizationId", "==", actor.organizationId).where("code", "==", code).limit(2));
      if (duplicate.size !== 1 || duplicate.docs[0]!.id !== doc.id) fail("Duplicate ledger codes require reconciliation before control mapping.");
      if (!doc.get("billingControlPurpose")) {
        const existingLines = await transaction.get(db.collection("journalLines").where("organizationId", "==", actor.organizationId).where("accountId", "==", doc.id).limit(1));
        if (!existingLines.empty) fail("An account with existing postings cannot be repurposed as a billing control. Use a dedicated reviewed account.");
      }
    }
    if (docs[0]!.get("code") === docs[1]!.get("code")) fail("The two controls must have distinct ledger codes.");
    const mapping = { version: currentVersion + 1, deferredService: billingAccountSnapshot(docs[0]!), providerPayable: billingAccountSnapshot(docs[1]!) };
    docs.forEach((doc, i) => transaction.update(doc.ref, { billingControlPurpose: i === 0 ? "deferred_service" : "provider_payable", updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.userId }));
    const values = { organizationId: actor.organizationId, mapping, reason: input.reason, updatedBy: actor.userId, updatedAt: FieldValue.serverTimestamp() };
    transaction.set(ref, values); transaction.create(db.collection("billingConfigurationRevisions").doc(uniquenessDocumentId(actor.organizationId, String(mapping.version))), values);
    const result = { mapping }; transaction.create(op, { organizationId: actor.organizationId, fingerprint, result, createdAt: FieldValue.serverTimestamp() });
    writeAuditLog(transaction, actor, { action: "billing.controls_configured", entityType: "billingConfigurations", entityId: ref.id, sourceFunction: "billingControls", correlationId: correlationId(), reason: input.reason, before: { mapping: config.get("mapping") ?? null }, after: { mapping } });
    return result;
  });
});
