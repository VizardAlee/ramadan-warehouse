import { createHash } from "node:crypto";
import { FieldPath, FieldValue, Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import { requireAccess, requirePermission } from "../auth/authorize.js";
import { scopedAccess, hasOrganizationPermission, requirePermissionScope } from "../auth/permission-scope.js";
import { accountingPeriodReference, assertAccountingPeriodOpen } from "../accounting/period-lock.js";
import { resolveSettlementAccount } from "../accounting/settlement-account.js";
import { writeJournal } from "../accounting/write-journal.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { enforceAppCheck } from "../config.js";
import { uniquenessDocumentId } from "../inventory/calculations.js";
import { advanceAsset, advanceJournalLines, applyAdvanceSettlement, outstandingAdvance, type AdvanceBalance } from "../reconciliation/staff-advances.js";
import { staffAdvanceInput } from "../validation/staff-advances.js";
import { correlationId, parseInput } from "../utils/callable.js";

const fail = (message: string): never => { throw new HttpsError("failed-precondition", message); };
const iso = (value: unknown) => value instanceof Timestamp ? value.toDate().toISOString() : null;
function balanceOf(document: DocumentSnapshot): AdvanceBalance {
  const balance = { issuedMinor: document.get("issuedMinor"), retiredMinor: document.get("retiredMinor"), returnedMinor: document.get("returnedMinor") };
  try { outstandingAdvance(balance); } catch { fail("The advance balance needs reconciliation before another entry can post."); }
  return balance;
}
function advanceRow(document: DocumentSnapshot) {
  const balance = balanceOf(document), outstandingMinor = outstandingAdvance(balance);
  return { id: document.id, branchId: document.get("branchId"), recipientName: document.get("recipientName"), recipientType: document.get("recipientType"), purpose: document.get("purpose"), ...balance, outstandingMinor, status: outstandingMinor ? "open" : "closed", issuedAt: iso(document.get("issuedAt")), createdBy: document.get("createdBy") };
}

/** Records completed cash movements. Never initiates a bank transfer or manufactures a receipt. */
export const staffAdvances = onCall({ enforceAppCheck, timeoutSeconds: 120 }, async request => {
  const actor = await scopedAccess(await requireAccess(request));
  const input = parseInput(staffAdvanceInput, request.data);
  const permission = input.action === "issue" ? "cash.advances.issue" : input.action === "retire" ? "cash.advances.retire" : input.action === "return" ? "cash.advances.return" : "cash.advances.read";
  requirePermission(actor, permission);
  const checkAdvance = (document: DocumentSnapshot) => {
    if (!document.exists || document.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Advance not found.");
    requirePermissionScope(actor, { branchId: String(document.get("branchId")) }, permission);
  };
  const checkBranch = (document: DocumentSnapshot) => {
    if (!document.exists || document.get("organizationId") !== actor.organizationId || document.get("status") !== "active") throw new HttpsError("failed-precondition", "Select an active store.");
    requirePermissionScope(actor, { branchId: document.id }, permission);
  };
  if (input.action === "locations") {
    let query = db.collection("branches").where("organizationId", "==", actor.organizationId).orderBy(FieldPath.documentId());
    if (input.cursorId) query = query.startAfter(input.cursorId);
    const page = await query.limit(101).get(), selected = page.docs.slice(0, 100);
    return { branches: selected.filter(row => row.get("status") === "active" && (hasOrganizationPermission(actor, "cash.advances.read") || actor.branchIds.includes(row.id)) && (!actor.operatingContext || actor.operatingContext.type === "branch" && actor.operatingContext.id === row.id)).map(row => ({ id: row.id, name: String(row.get("name") ?? row.id) })), nextCursorId: page.size > 100 ? selected.at(-1)!.id : null };
  }
  if (input.action === "workspace" || input.action === "accounts") {
    checkBranch(await db.doc(`branches/${input.branchId}`).get());
    if (input.action === "accounts") {
      let query = db.collection("bankAccounts").where("organizationId", "==", actor.organizationId).orderBy(FieldPath.documentId());
      if (input.cursorId) query = query.startAfter(input.cursorId);
      const page = await query.limit(101).get(), selected = page.docs.slice(0, 100);
      return { accounts: selected.filter(row => row.get("active") === true && (!row.get("branchId") || row.get("branchId") === input.branchId)).map(row => ({ id: row.id, bankName: String(row.get("bankName") ?? "Bank"), accountName: String(row.get("accountName") ?? "Company account"), accountNumberLast4: String(row.get("accountNumberLast4") ?? "") })), nextCursorId: page.size > 100 ? selected.at(-1)!.id : null };
    }
    let query = db.collection("staffAdvances").where("organizationId", "==", actor.organizationId).where("branchId", "==", input.branchId).orderBy(FieldPath.documentId());
    if (input.cursorId) query = query.startAfter(input.cursorId);
    const page = await query.limit(51).get(), selected = page.docs.slice(0, 50);
    return { advances: selected.map(advanceRow), nextCursorId: page.size > 50 ? selected.at(-1)!.id : null };
  }
  if (input.action === "detail") {
    const advance = await db.doc(`staffAdvances/${input.advanceId}`).get(); checkAdvance(advance);
    let query = advance.ref.collection("events").orderBy(FieldPath.documentId());
    if (input.cursorId) query = query.startAfter(input.cursorId);
    const page = await query.limit(51).get(), selected = page.docs.slice(0, 50);
    return { advance: advanceRow(advance), events: selected.map(row => ({ id: row.id, advanceId: advance.id, kind: row.get("kind"), amountMinor: row.get("amountMinor"), reference: row.get("reference"), reason: row.get("reason"), method: row.get("method"), bankAccountId: row.get("bankAccountId"), journalEntryId: row.get("journalEntryId"), journalNumber: row.get("journalNumber"), createdAt: iso(row.get("effectiveAt")), createdBy: row.get("createdBy") })), nextCursorId: page.size > 50 ? selected.at(-1)!.id : null };
  }
  const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const operation = db.doc(`idempotencyOperations/${uniquenessDocumentId(actor.organizationId, actor.userId, "staffAdvances", input.idempotencyKey)}`);
  const advance = input.action === "issue" ? db.collection("staffAdvances").doc() : db.doc(`staffAdvances/${input.advanceId}`);
  const effectiveAt = Timestamp.now(), event = advance.collection("events").doc(), journal = db.collection("journalEntries").doc();
  const counter = db.doc(`journalCounters/${uniquenessDocumentId(actor.organizationId, "general")}`);
  return db.runTransaction(async transaction => {
    const previous = await transaction.get(operation);
    if (previous.exists) {
      if (previous.get("organizationId") !== actor.organizationId || previous.get("fingerprint") !== fingerprint) fail("This retry key was already used for different advance instructions.");
      const saved = await transaction.get(db.doc(`staffAdvances/${String(previous.get("advanceId"))}`)); checkAdvance(saved);
      return previous.get("result");
    }
    const current = await transaction.get(advance);
    if (input.action !== "issue") checkAdvance(current);
    const branchId = input.action === "issue" ? input.branchId : String(current.get("branchId"));
    const branch = await transaction.get(db.doc(`branches/${branchId}`)); checkBranch(branch);
    const bankId = input.action === "retire" ? undefined : input.bankAccountId;
    const assetRef = db.doc(`chartOfAccounts/${uniquenessDocumentId(actor.organizationId, advanceAsset.accountCode)}`);
    const expenseRef = db.doc(`chartOfAccounts/${uniquenessDocumentId(actor.organizationId, "6000")}`);
    const [sequence, period, bank, asset, expense] = await transaction.getAll(counter, accountingPeriodReference(actor.organizationId, effectiveAt), db.doc(`bankAccounts/${bankId ?? "no-bank-account"}`), assetRef, expenseRef);
    assertAccountingPeriodOpen(period!);
    const assetMatches = await transaction.get(db.collection("chartOfAccounts").where("organizationId", "==", actor.organizationId).where("code", "==", advanceAsset.accountCode).limit(2));
    if (assetMatches.size > 1 || assetMatches.docs.some(row => row.id !== assetRef.id)) fail("Account 1260 has a duplicate or nonstandard control-account reference. An administrator must reconcile it before recording advances.");
    if (asset!.exists && (asset!.get("organizationId") !== actor.organizationId || asset!.get("code") !== advanceAsset.accountCode || asset!.get("name") !== advanceAsset.accountName || asset!.get("active") !== true || asset!.get("currency") !== "NGN")) fail("Account 1260 is already configured differently or inactive. An administrator must review the advance control account.");
    if (input.action === "retire" && expense!.exists && (expense!.get("organizationId") !== actor.organizationId || expense!.get("code") !== "6000" || expense!.get("active") !== true || expense!.get("currency") !== "NGN")) fail("The operating expense account is unavailable.");
    const reference = input.action === "retire" ? input.receiptReference : input.reference;
    // One piece of retirement evidence may only be posted once in this module.
    // This does not authorize or replace approving the underlying physical receipt.
    const normalizedReference = reference.toLocaleLowerCase("en").replace(/\s+/g, " ");
    const evidenceRef = db.doc(`staffAdvanceEvidence/${input.action === "retire" ? uniquenessDocumentId(actor.organizationId, "retire", normalizedReference) : input.action === "return" ? uniquenessDocumentId(actor.organizationId, "return", advance.id, normalizedReference) : uniquenessDocumentId(actor.organizationId, "issue", branchId, input.recipientName.toLocaleLowerCase("en").replace(/\s+/g, " "), normalizedReference)}`);
    if (evidenceRef && (await transaction.get(evidenceRef)).exists) fail("This receipt reference has already been recorded. Review the existing entry instead of posting it twice.");
    const settlement = input.action === "retire" ? undefined : resolveSettlementAccount(actor.organizationId, input.method, bankId, bank!, { branchId });
    if (settlement?.accountCode === advanceAsset.accountCode || settlement?.accountCode === "6000") fail("The selected bank account has an invalid settlement ledger mapping.");
    let balance: AdvanceBalance & { outstandingMinor: number; status: "open" | "closed" };
    if (input.action === "issue") balance = { issuedMinor: input.amountMinor, retiredMinor: 0, returnedMinor: 0, outstandingMinor: input.amountMinor, status: "open" };
    else {
      try { balance = applyAdvanceSettlement(balanceOf(current), input.action, input.amountMinor); }
      catch { return fail("The amount exceeds this advance's outstanding balance, or its balance needs reconciliation."); }
    }
    if (!asset!.exists) transaction.create(assetRef, { organizationId: actor.organizationId, code: advanceAsset.accountCode, name: advanceAsset.accountName, currency: "NGN", active: true, systemManaged: true, updatedAt: FieldValue.serverTimestamp() });
    if (input.action === "retire" && !expense!.exists) transaction.create(expenseRef, { organizationId: actor.organizationId, code: "6000", name: "Operating expenses", currency: "NGN", active: true, systemManaged: true, updatedAt: FieldValue.serverTimestamp() });
    const journalNumber = writeJournal(transaction, actor, { journal, journalCounter: counter, journalCounterValue: Number(sequence!.get("value") ?? 0) + 1, journalType: `staff_advance_${input.action}`, referenceType: "staffAdvance", referenceId: advance.id, referenceNumber: reference, description: input.reason, branchId, effectiveAt, manageAccounts: false, lines: advanceJournalLines(input.action, input.amountMinor, settlement) });
    if (input.action === "issue") transaction.create(advance, { organizationId: actor.organizationId, branchId, recipientName: input.recipientName, recipientType: input.recipientType, purpose: input.purpose, ...balance, currency: "NGN", issuedAt: effectiveAt, createdAt: FieldValue.serverTimestamp(), createdBy: actor.userId });
    else transaction.update(advance, { ...balance, updatedAt: FieldValue.serverTimestamp() });
    transaction.create(event, { organizationId: actor.organizationId, branchId, advanceId: advance.id, kind: input.action, amountMinor: input.amountMinor, reference, reason: input.reason, method: input.action === "retire" ? null : input.method, bankAccountId: settlement?.bankAccountId ?? null, journalEntryId: journal.id, journalNumber, effectiveAt, createdAt: FieldValue.serverTimestamp(), createdBy: actor.userId });
    if (evidenceRef) transaction.create(evidenceRef, { organizationId: actor.organizationId, advanceId: advance.id, eventId: event.id, reference, createdAt: FieldValue.serverTimestamp() });
    const result = { advanceId: advance.id, eventId: event.id, journalEntryId: journal.id, recorded: true };
    transaction.create(operation, { organizationId: actor.organizationId, advanceId: advance.id, fingerprint, result, createdAt: FieldValue.serverTimestamp() });
    writeAuditLog(transaction, actor, { action: `staff_advance.${input.action}`, entityType: "staffAdvance", entityId: advance.id, sourceFunction: "staffAdvances", correlationId: correlationId(), reason: input.reason, after: { branchId, amountMinor: input.amountMinor, outstandingMinor: balance.outstandingMinor, journalEntryId: journal.id } });
    return result;
  });
});
